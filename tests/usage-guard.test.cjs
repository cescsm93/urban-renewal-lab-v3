const assert = require('node:assert/strict');
const {take} = require('../lib/usage-guard.cjs');

const request = ip => ({headers: {'x-forwarded-for': ip}, socket: {remoteAddress: 'ignored'}});
const a = request('198.51.100.1');
const b = request('198.51.100.2');
for (let i = 0; i < 4; i++) assert.equal(take(a, 'walk', 1000).allowed, true);
const denied = take(a, 'walk', 1000);
assert.equal(denied.allowed, false);
assert.ok(denied.retryAfter > 0);
assert.equal(take(b, 'walk', 1000).allowed, true);
assert.equal(take(a, 'walk', 3601001).allowed, true);
for (let i = 0; i < 19; i++) assert.equal(take(request('203.0.113.10'), 'roads', 1000).allowed, true);
assert.equal(take(request('203.0.113.10'), 'roads', 1000).allowed, true);
assert.equal(take(request('203.0.113.10'), 'roads', 1000).allowed, false);
console.log('PASS Amap per-IP windows, reset, and independent road/walk limits');
