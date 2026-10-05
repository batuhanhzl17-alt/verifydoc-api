import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recipientNameLabel,
  recipientIbanLabel,
  senderIbanLabel,
  resolveSplitRecipientName,
  resolveSplitTurkishIban,
} from '../api/semantic_roi.js';

import { recipientNameLabel, recipientIbanLabel, resolveSplitTurkishIban } from './api/semantic_roi.js';
const regions=[
 {text:'ALICI',region:{x1:100,y1:200,x2:150,y2:220}},
 {text:'BATUHAN HIZLI',region:{x1:160,y1:200,x2:300,y2:220}},
 {text:'ALICI IBAN',region:{x1:100,y1:240,x2:180,y2:260}},
 {text:'TR12 3456 7890 1234 5678',region:{x1:190,y1:240,x2:420,y2:260}},
];
console.log(JSON.stringify({nameLabel:recipientNameLabel('ALICI'),ibanLabel:recipientIbanLabel('ALICI IBAN'),joined:resolveSplitTurkishIban(regions,regions[2])},null,2));

test('recipient name aliases include common Turkish and English bank labels', () => {
  for (const label of [
    'ALICI', 'ALICI ADI', 'ALICI ADI SOYADI', 'ALICI ÜNVANI', 'ALICI ADI / ÜNVANI', 'ALICI İSİM / ÜNVAN', 'ALACAKLI ADI', 'ALACAKLI ÜNVANI', 'ALACAKLI İSİM / ÜNVANI',
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

test('recipient name resolver joins a wrapped company/person value next to an explicit recipient label', () => {
  const label = { text: 'ALICI ÜNVANI', region: { x1: 10, y1: 10, x2: 80, y2: 24 } };
  const rows = [
    label,
    { text: 'ÖZ FASHION HAZIR GİYİM TEKSTİL', region: { x1: 90, y1: 10, x2: 290, y2: 24 } },
    { text: 'ÜRÜNLERİ SANAYİ VE TİCARET LTD ŞTİ', region: { x1: 90, y1: 26, x2: 300, y2: 40 } },
  ];
  const resolved = resolveSplitRecipientName(rows, label);
  assert.equal(resolved?.resolver, 'semantic-recipient-line-join-v1');
  assert.match(resolved.text, /ÖZ FASHION/);
  assert.match(resolved.text, /ÜRÜNLERİ SANAYİ/);
  assert.equal(resolved.region.y1, 10);
  assert.equal(resolved.region.y2, 40);
});

test('recipient IBAN resolver joins a line-wrapped Turkish IBAN and returns the union ROI', () => {
  const label = { text: 'ALICI IBAN', region: { x1: 10, y1: 10, x2: 80, y2: 24 } };
  const rows = [
    label,
    { text: 'TR34 0006 2000', region: { x1: 90, y1: 10, x2: 180, y2: 24 } },
    { text: '3270 0006 2897 00', region: { x1: 90, y1: 26, x2: 200, y2: 40 } },
  ];
  const resolved = resolveSplitTurkishIban(rows, label);
  assert.equal(resolved?.text, 'TR340006200032700006289700');
  assert.equal(resolved?.resolver, 'semantic-iban-line-join-v1');
  assert.equal(resolved.region.y1, 10);
  assert.equal(resolved.region.y2, 40);
});


