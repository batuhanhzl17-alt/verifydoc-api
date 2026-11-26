import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

from inspect_pdf import MAX_BYTES, inspect


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def reply(self, code, payload):
        content = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        if self.path != "/inspect":
            return self.reply(404, {"status": "not-found"})
        expected = "Bearer " + os.environ["VERIFYDOC_PDF_FORENSICS_TOKEN"]
        if not hmac.compare_digest(self.headers.get("Authorization", "").encode(), expected.encode()):
            return self.reply(401, {"status": "unauthorized"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.reply(400, {"status": "invalid-length"})
        if length < 1 or length > MAX_BYTES:
            return self.reply(413, {"status": "size-limit"})
        try:
            data = self.rfile.read(length)
            if len(data) != length:
                return self.reply(400, {"status": "incomplete-body"})
            result = inspect(data)
        except Exception:
            return self.reply(422, {"status": "inspection-failed"})
        return self.reply(200, result)


if __name__ == "__main__":
    if not os.environ.get("VERIFYDOC_PDF_FORENSICS_TOKEN"):
        raise SystemExit("VERIFYDOC_PDF_FORENSICS_TOKEN is required")
    HTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()
