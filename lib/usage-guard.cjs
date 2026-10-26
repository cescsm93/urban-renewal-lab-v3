// A conservative backstop for warm instances. The Vercel firewall provides the
// cross-instance per-IP limit; a durable store is needed for a hard daily budget.
const counters = new Map();

function clientId(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  // Vercel overwrites this header with the client address. Do not trust it on
  // arbitrary self-hosted proxies unless they apply the same rule.
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function take(req, kind, now = Date.now()) {
  const ip = clientId(req);
  const limits = kind === 'walk'
    ? [[`walk:hour:${ip}`, 4, 3600000], [`walk:day:${ip}`, 12, 86400000], ['walk:day:all', 30, 86400000]]
    : [[`roads:hour:${ip}`, 20, 3600000], [`roads:day:${ip}`, 60, 86400000], ['roads:day:all', 200, 86400000]];
  if (counters.size > 2000) for (const [key, entry] of counters) if (entry.until <= now) counters.delete(key);
  let retryAfter = 0;
  for (const [key, max, window] of limits) {
    const entry = counters.get(key);
    if (entry && entry.until > now && entry.count >= max) retryAfter = Math.max(retryAfter, Math.ceil((entry.until - now) / 1000));
  }
  if (retryAfter) return {allowed: false, retryAfter};
  for (const [key, , window] of limits) {
    const entry = counters.get(key);
    if (entry && entry.until > now) entry.count++;
    else counters.set(key, {count: 1, until: now + window});
  }
  return {allowed: true};
}

module.exports = {take, clientId};
