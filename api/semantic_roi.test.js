import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recipientNameLabel,
  recipientIbanLabel,
  senderIbanLabel,
} from '../api/semantic_roi.js';

test('recipient name aliases include common Turkish and English bank labels', () => {
  for (const label of [
    'ALICI', 'ALICI ADI', 'ALICI ADI SOYADI', 'ALICI ÜNVANI', 'ALACAKLI ADI', 'ALACAKLI ÜNVANI',
    'BENEFICIARY NAME', 'PAYEE NAME', 'RECEIVER NAME', 'LEHDAR',
  ]) assert.equal(recipientNameLabel(label), 'recipientName', label);
});

test('customer and sender names are never resolved as recipientName', () => {
  for (const label of ['MÜŞTERİ ÜNVANI', 'MÜŞTERİ ADI', 'GÖNDEREN ADI', 'GÖNDERİCİ ÜNVANI']) {
    assert.equal(recipientNameLabel(label), null, label);
  }
});

test('only explicitly recipient-labelled IBAN/account labels resolve to recipientIban', () => {
  for (const label of ['ALICI IBAN', 'ALICI IBAN NO', 'ALACAKLI IBAN', 'ALICI HESAP', 'LEHDAR HESAP NO', 'BENEFICIARY ACCOUNT IBAN', 'PAYEE ACCOUNT']) {
    assert.equal(recipientIbanLabel(label), true, label);
  }
  for (const label of ['IBAN', 'IBAN/KART NO', 'MÜŞTERİ IBAN', 'GÖNDEREN IBAN', 'SENDER ACCOUNT IBAN']) {
    assert.equal(recipientIbanLabel(label), false, label);
  }
});

test('sender IBAN labels remain distinct from recipient IBAN labels', () => {
  for (const label of ['GÖNDEREN IBAN', 'GÖNDERİCİ HESAP IBAN', 'SENDER ACCOUNT IBAN']) {
    assert.equal(senderIbanLabel(label), true, label);
    assert.equal(recipientIbanLabel(label), false, label);
  }
});
