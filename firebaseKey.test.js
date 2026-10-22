import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fbKey } from './firebaseKey.js';
import { applyRefundToProfile } from './storeRefund.js';

test('fbKey ersetzt die in Firebase-Schlüsseln verbotenen Zeichen', () => {
  assert.equal(fbKey('GPA.3364-9528-3263-65051'), 'GPA_3364-9528-3263-65051');
  assert.equal(fbKey('a#b$c[d]e/f'), 'a_b_c_d_e_f');
});

test('fbKey lässt Apple- und Stripe-IDs unverändert', () => {
  assert.equal(fbKey('2000000123456789'), '2000000123456789');
  assert.equal(fbKey('cs_live_a1B2c3'), 'cs_live_a1B2c3');
});

test('fbKey liefert bei fehlender ID einen leeren Text', () => {
  assert.equal(fbKey(undefined), '');
  assert.equal(fbKey(null), '');
});

test('Erstattung findet die gutgeschriebene Google-Transaktion trotz Punkt in der Order-ID', () => {
  const profile = { coins: 50, processedRevenueCatTransactions: { [fbKey('GPA.1111-2222')]: true } };
  const r = applyRefundToProfile(profile, { transactionId: 'GPA.1111-2222', coins: 40 });
  assert.equal(r.status, 'refunded');
  assert.equal(r.deducted, 40);
  assert.deepEqual(Object.keys(r.profile.processedRevenueCatRefunds), ['GPA_1111-2222']);
});
