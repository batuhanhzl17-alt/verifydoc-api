import hashlib
import os
import re
import subprocess
import tempfile
from pathlib import Path

import fitz

MAX_PAGES = 40
MAX_REVISIONS = 8
MAX_BYTES = 16 * 1024 * 1024
PDF_END = re.compile(rb"startxref\s+(\d+)\s+%%EOF(?:\r\n|\r|\n)?")
AMOUNT = re.compile(r"^[+−-]?\d[\d.,]*[.,]\d{2}$")


def compare_revision(previous, final, final_text, final_pixels):
    changes = []
    for index in range(min(len(previous), len(final), MAX_PAGES)):
        page = previous[index]
        text_changed = page.get_text() != final_text[index]
        image_changed = page_fingerprint(page) != final_pixels[index]
        if text_changed or image_changed:
            changes.append({
                "page": index + 1,
                "textChanged": text_changed,
                "appearanceChanged": image_changed,
            })
    return {
        "pageCount": len(previous),
        "pageCountChanged": len(previous) != len(final),
        "changedPages": changes,
        "comparedPages": min(len(previous), len(final), MAX_PAGES),
    }


def page_fingerprint(page):
    bounds = page.rect
    scale = min(1, 1200 / max(bounds.width, bounds.height, 1))
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csRGB)
    return pixmap.width, pixmap.height, hashlib.sha256(pixmap.samples).digest()


def revisions(data, final):
    endings = {int(match[1]): match.end() for match in PDF_END.finditer(data)}
    previous_type, previous_offset = final.xref_get_key(-1, "Prev")
    if previous_type != "int":
        return [], "complete"
    final_text = [final[i].get_text() for i in range(min(len(final), MAX_PAGES))]
    final_pixels = [page_fingerprint(final[i]) for i in range(len(final_text))]
    results = []
    seen = set()
    status = "complete"
    while previous_type == "int":
        offset = int(previous_offset)
        if offset in seen or offset not in endings:
            status = "unresolved"
            break
        if len(results) == MAX_REVISIONS:
            status = "limited"
            break
        seen.add(offset)
        end = endings[offset]
        with fitz.open(stream=data[:end], filetype="pdf") as older:
            if older.is_repaired or older.needs_pass:
                status = "unresolved"
                break
            results.append({"byteEnd": end, **compare_revision(older, final, final_text, final_pixels)})
            previous_type, previous_offset = older.xref_get_key(-1, "Prev")
    return list(reversed(results)), status


def overlay_candidates(page):
    operations = page.get_bboxlog()
    covers = [
        (index, kind, fitz.Rect(box))
        for index, (kind, box) in enumerate(operations)
        if kind == "fill-image"
    ]
    covers.extend(
        (drawing["seqno"], "white-fill", drawing["rect"])
        for drawing in page.get_drawings()
        if drawing.get("fill") and min(drawing["fill"]) >= 0.97
        and drawing.get("fill_opacity") == 1
    )
    if not covers or len(covers) > 200:
        return []
    words = [fitz.Rect(word[:4]) for word in page.get_text("words") if AMOUNT.fullmatch(word[4])]
    candidates = []
    for index, (kind, box) in enumerate(operations):
        if kind != "fill-text":
            continue
        ink = fitz.Rect(box)
        for cover_index, cover_kind, cover in covers:
            if cover_index <= index or not cover.intersects(ink):
                continue
            for word in words:
                if not word.intersects(ink):
                    continue
                overlap = (word & cover).get_area() / word.get_area()
                if overlap >= 0.5:
                    candidates.append({"box": list(word), "coverType": cover_kind})
                    if len(candidates) == 20:
                        return candidates
    return candidates


def signature_info(path):
    result = subprocess.run(["pdfsig", str(path)], capture_output=True, text=True,
                            timeout=12, env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
    signatures = []
    for section in re.split(r"(?m)^Signature #", result.stdout)[1:]:
        def field(label):
            match = re.search(r"(?m)^  - " + re.escape(label) + r": (.+)$", section)
            return match[1] if match else None

        signatures.append({
            "field": field("Signature Field Name"),
            "format": field("Signature Type"),
            "integrity": field("Signature Validation"),
            "certificateTrust": field("Certificate Validation"),
            "coversFinalFile": "  - Total document signed" in section,
        })
    status = "found" if signatures else (
        "absent" if "does not contain any signatures" in result.stdout + result.stderr else "unavailable"
    )
    return {"status": status, "entries": signatures}


def verify_timestamp(data, ranges):
    if len(ranges) != 4:
        return {"status": "invalid-byte-range"}
    start, left_end, right_start, right_length = ranges
    end = right_start + right_length
    if not (start == 0 and 0 < left_end < right_start <= end <= len(data)):
        return {"status": "invalid-byte-range"}
    gap = data[left_end:right_start].strip()
    if not (gap.startswith(b"<") and gap.endswith(b">")):
        return {"status": "invalid-token"}
    try:
        token = bytes.fromhex(gap[1:-1].decode("ascii"))
        if len(token) < 2 or token[0] != 0x30:
            return {"status": "invalid-token"}
        size = token[1]
        if size < 128:
            token = token[:2 + size]
        else:
            width = size & 127
            if not 1 <= width <= 4 or len(token) < 2 + width:
                return {"status": "invalid-token"}
            header_end = 2 + width
            token = token[:header_end + int.from_bytes(token[2:header_end], "big")]
        with tempfile.NamedTemporaryFile() as token_file:
            token_file.write(token)
            token_file.flush()
            parsed = subprocess.run(
                ["openssl", "ts", "-reply", "-token_in", "-in", token_file.name, "-text"],
                capture_output=True, timeout=3,
            )
        description = parsed.stdout.decode(errors="replace")
        algorithm = re.search(r"Hash Algorithm: (sha(?:1|224|256|384|512))\b", description)
        if parsed.returncode or not algorithm:
            return {"status": "unrecognized-token"}
        expected = b"".join(
            bytes.fromhex(line.split("   ")[0].replace("-", " "))
            for line in re.findall(r"(?m)^\s*[0-9a-f]+ - (.+)$", description)
        )
        digest = hashlib.new(algorithm[1])
        digest.update(data[:left_end])
        digest.update(data[right_start:end])
        cms = subprocess.run(
            ["openssl", "cms", "-verify", "-inform", "DER", "-noverify", "-out", os.devnull],
            input=token, capture_output=True, timeout=3,
        )
    except (ValueError, OSError, subprocess.TimeoutExpired):
        return {"status": "verification-unavailable"}
    timestamp = re.search(r"(?m)^Time stamp: (.+)$", description)
    matches = expected == digest.digest()
    return {
        "status": "integrity-matched" if matches and cms.returncode == 0 else "integrity-check-failed",
        "messageImprintMatches": matches,
        "tokenSignatureValid": cms.returncode == 0,
        "timestamp": timestamp[1] if timestamp else None,
        "certificateTrust": "not-verified",
    }


def timestamps(document, data):
    stamps = []
    for index in range(1, min(document.xref_length(), 30000)):
        try:
            if document.xref_get_key(index, "SubFilter")[1] != "/ETSI.RFC3161":
                continue
            ranges = [int(value) for value in re.findall(r"\d+", document.xref_get_key(index, "ByteRange")[1])]
            verification = verify_timestamp(data, ranges) if len(stamps) < 8 else {"status": "verification-limit"}
            stamps.append({"object": index, "byteRange": ranges, **verification})
        except (RuntimeError, fitz.mupdf.FzErrorFormat):
            continue
    return {"entries": stamps, "scanLimited": document.xref_length() > 30000,
            "scope": "document-timestamps"}


def inspect(data):
    with fitz.open(stream=data, filetype="pdf") as document:
        if document.needs_pass:
            return {"available": False, "status": "encrypted"}
        if document.is_repaired:
            return {"available": False, "status": "repaired-pdf"}
        history, history_status = revisions(data, document)
        pages = []
        for index in range(min(len(document), MAX_PAGES)):
            page = document[index]
            pages.append({
                "page": index + 1,
                "hasText": bool(page.get_text().strip()),
                "imageCount": len(page.get_image_info()),
                "possibleAmountOverlays": overlay_candidates(page),
            })
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.pdf"
            path.write_bytes(data)
            try:
                signatures = signature_info(path)
            except (OSError, subprocess.TimeoutExpired):
                signatures = {"status": "unavailable", "entries": []}
        return {
            "available": True, "status": "completed", "pageCount": len(document),
            "pageLimit": MAX_PAGES, "pages": pages,
            "revisions": history, "revisionStatus": history_status,
            "signatures": signatures, "timestamps": timestamps(document, data),
        }
