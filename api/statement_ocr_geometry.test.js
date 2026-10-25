import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStatementPaddleOcrRow, normalizeStatementRowCounts } from './statement_ocr_geometry.js';

const regions = [
  { pageIndex: 0, text: '15.10.2026', score: 0.99, region: { x1: 20, y1: 100, x2: 100, y2: 120 } },
  { pageIndex: 0, text: 'FAST transfer', score: 0.98, region: { x1: 120, y1: 100, x2: 260, y2: 120 } },
  { pageIndex: 0, text: '-1.000,00', score: 0.98, region: { x1: 600, y1: 100, x2: 690, y2: 120 } },
  { pageIndex: 0, text: '9.000,00', score: 0.98, region: { x1: 800, y1: 100, x2: 880, y2: 120 } },
];

const row = {
  pageNumber: 1,
  date: '15.10.2026',
  description: 'FAST transfer',
  debitAmount: '1000.00',
  balanceAfter: '9000.00',
};

test('matches a raster statement row from date, amount, balance and OCR geometry', () => {
  const result = resolveStatementPaddleOcrRow(row, regions, 1, { width: 1000, height: 1400 });
  assert.equal(result.status, 'matched');
  assert.equal(result.source, 'paddle-ocr-geometry');
  assert.equal(result.geometryMappedToPdf, true);
  assert.deepEqual(result.amountBox, { x: 0.6, y: 100 / 1400, width: 0.09, height: 20 / 1400 });
  assert.deepEqual(result.balanceBox, { x: 0.8, y: 100 / 1400, width: 0.08, height: 20 / 1400 });
});

test('does not match when multiple OCR rows have the same exact financial tuple', () => {
  const duplicate = regions.map(region => ({ ...region, region: { ...region.region, y1: region.region.y1 + 60, y2: region.region.y2 + 60 } }));
  const result = resolveStatementPaddleOcrRow(row, [...regions, ...duplicate], 1, { width: 1000, height: 1400 });
  assert.equal(result.status, 'unresolved');
  assert.match(result.reason, /2 PaddleOCR satır adayı/);
});

test('keeps the match visible but reports when OCR-to-PDF dimensions are unavailable', () => {
  const result = resolveStatementPaddleOcrRow(row, regions, 1, null);
  assert.equal(result.status, 'matched');
  assert.equal(result.geometryMappedToPdf, false);
  assert.equal(result.amountBox, null);
});


test('uses a unique description match to resolve repeated date and amount candidates', () => {
  const duplicate = regions.map(region => ({ ...region, region: { ...region.region, y1: region.region.y1 + 60, y2: region.region.y2 + 60 } }));
  duplicate[1] = { ...duplicate[1], text: 'GROCERY TRANSFER' };
  const result = resolveStatementPaddleOcrRow({ ...row, description: 'GROCERY TRANSFER' }, [...regions, ...duplicate], 1, { width: 1000, height: 1400 });
  assert.equal(result.status, 'matched');
  assert.equal(result.descriptionMatched, true);
  assert.equal(result.amountBox.y, 160 / 1400);
});

test('does not use a full-row OCR region as a localized amount ROI', () => {
  const broad = [
    { pageIndex: 0, text: '15.10.2026 FAST transfer -1.000,00', score: 0.99, region: { x1: 0, y1: 100, x2: 700, y2: 120 } },
    { pageIndex: 0, text: '9.000,00', score: 0.98, region: { x1: 800, y1: 100, x2: 880, y2: 120 } },
  ];
  const result = resolveStatementPaddleOcrRow(row, broad, 1, { width: 1000, height: 1400 });
  assert.equal(result.status, 'matched');
  assert.equal(result.geometryMappedToPdf, false);
  assert.equal(result.amountBox, null);
});

test('preserves model count while normalizing displayed transaction count to extracted rows', () => {
  const analysis = { transactionCount: 97, rows: Array.from({ length: 101 }, (_, i) => ({
    pageNumber: 1, rowNumber: i + 1, debitAmount: '1.00', balanceAfter: '9.00',
  })) };
  const result = normalizeStatementRowCounts(analysis);
  assert.deepEqual(result, { reportedCount: 97, extractedRowCount: 101, mismatch: true });
  assert.equal(analysis.modelReportedTransactionCount, 97);
  assert.equal(analysis.transactionCount, 101);
  assert.equal(analysis.extractedRowCount, 101);
});


test('does not reuse an OCR line already assigned to another transaction', () => {
  const result = resolveStatementPaddleOcrRow(row, regions, 1, { width: 1000, height: 1400 }, [{ y: 110, tolerance: 8 }]);
  assert.equal(result.status, 'unresolved');
  assert.equal(result.distinctCandidateLineCount, 0);
});


test('collapses overlapping date-anchor bands that point to the same OCR financial boxes', () => {
  const overlapping = [
    { pageIndex: 0, text: '15.10.2026', score: 0.99, region: { x1: 20, y1: 90, x2: 100, y2: 110 } },
    { pageIndex: 0, text: '15.10.2026 FAST transfer -1.000,00', score: 0.99, region: { x1: 120, y1: 100, x2: 690, y2: 120 } },
    { pageIndex: 0, text: '15.10.2026', score: 0.99, region: { x1: 20, y1: 110, x2: 100, y2: 130 } },
    { pageIndex: 0, text: '9.000,00', score: 0.98, region: { x1: 800, y1: 100, x2: 880, y2: 120 } },
  ];
  const result = resolveStatementPaddleOcrRow(row, overlapping, 1, { width: 1000, height: 1400 });
  assert.equal(result.status, 'matched');
  assert.equal(result.distinctCandidateLineCount, 1);
  assert.equal(result.geometryMappedToPdf, false);
});
