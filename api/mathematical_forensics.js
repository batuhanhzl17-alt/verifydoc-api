# VerifyDoc Mathematical Forensics V1

## Baseline
- Reference population: 60 image/raster samples derived from the current `references/` set, including the supplied JPG references and first-page rasterizations of reference PDFs.
- Negative population: 10 known-negative samples from `negative_samples/`.
- Baseline file: `mathematical_forensics_baseline.json`.

## Features
The fingerprint contains:
- luminance mean/std and entropy
- edge density and mean gradient
- Laplacian variance
- dark/bright pixel ratios
- 8x8 DCT low/mid/high frequency energy and high-frequency ratio
- JPEG quantization-table statistics and estimated JPEG quality when native JPEG data is available
- horizontal/vertical 8x8 blockiness
- 4x4 regional raster statistics

## Runtime flow
1. `analyze.js` loads the baseline once and caches it.
2. The target is fingerprinted after the existing PDF-to-raster step when needed.
3. The target is compared against the selected bank's reference and known-negative populations.
4. Comparisons use robust median/MAD-style distances with a relative floor, so tiny populations do not create artificial extreme z-scores.
5. Mathematical evidence is returned as `result.mathematicalForensics` and is advisory.
6. Only sufficiently populated mathematical signals can provide a controlled corroborating risk floor; the existing OCR, amount, reference, visual, layout, paint-over and font engines remain active.

## Rebuilding the baseline
Run after updating `references/` or `negative_samples/`:

```bash
node build_mathematical_baseline.mjs
```

The builder renders the first page of PDFs and fingerprints the resulting raster alongside native image samples.

## Validation note
Known negative samples were checked with leave-one-out comparisons where the population contained enough samples. Enpara negatives separated strongly from the reference population, and the two Ziraat negatives also showed a clear negative-population affinity. Banks with only one known-negative sample are deliberately treated as low-reliability rather than as a strong population claim.


## V1.1 — 16×16 semantic ROI extension

This update keeps the V1 global mathematical fingerprint but changes the raster tile grid from 4×4 to **16×16**. It also adds optional semantic ROI analysis for:
- `amount` / TUTAR
- `recipientName` / ALICI ÜNVANI / ALICI ADI
- `recipientIban` / ALICI IBAN

Each semantic ROI is normalized to a fixed canvas and then split into 16×16 cells. Per-cell Laplacian variance, edge density and local standard deviation are compared between target and reference. The runtime exposes `roi16x16` and `roiSummary` under `result.mathematicalForensics`.

The ROI engine is corroborating evidence only. It does not independently declare a document authentic/fake. Missing or unreliable semantic boxes cause that ROI to be reported as unavailable rather than inventing coordinates.
