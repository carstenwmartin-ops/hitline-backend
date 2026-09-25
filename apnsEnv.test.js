import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apnsOrder, isBadDeviceToken, APNS_HOSTS } from './apnsEnv.js';

test('Reihenfolge: Produktion zuerst, nur "sandbox" dreht um', () => {
  assert.deepEqual(apnsOrder(undefined), ['production', 'sandbox']);
  assert.deepEqual(apnsOrder(''), ['production', 'sandbox']);
  assert.deepEqual(apnsOrder('production'), ['production', 'sandbox']);
  assert.deepEqual(apnsOrder('sandbox'), ['sandbox', 'production']);
});

test('BadDeviceToken wird erkannt (400 mit passendem Grund)', () => {
  assert.equal(isBadDeviceToken({ success: false, status: 400, error: '{"reason":"BadDeviceToken"}' }), true);
  assert.equal(isBadDeviceToken({ success: false, status: 400, error: 'BadDeviceToken' }), true);
});

test('Andere Fehler und Erfolge lösen keinen Rückfall aus', () => {
  assert.equal(isBadDeviceToken({ success: true }), false);
  assert.equal(isBadDeviceToken({ success: false, status: 410, error: '{"reason":"Unregistered"}' }), false);
  assert.equal(isBadDeviceToken({ success: false, status: 400, error: '{"reason":"PayloadEmpty"}' }), false);
  assert.equal(isBadDeviceToken(null), false);
});

test('Hosts zeigen auf die beiden APNs-Server', () => {
  assert.match(APNS_HOSTS.production, /api\.push\.apple\.com$/);
  assert.match(APNS_HOSTS.sandbox, /api\.sandbox\.push\.apple\.com$/);
});
