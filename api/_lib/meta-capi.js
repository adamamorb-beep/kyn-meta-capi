/* api/_lib/meta-capi.js — the only file that talks to Meta.
   Hashes PII (SHA-256), passes fbp/fbc through unhashed, keeps event_id for dedup. */
const crypto = require('crypto');

const API_VERSION = process.env.META_API_VERSION || 'v21.0';
const PIXEL_ID = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || undefined;

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

function hash(value, kind) {
  if (value === undefined || value === null || value === '') return undefined;
  let v = String(value).trim().toLowerCase();
  if (kind === 'phone') v = v.replace(/[^0-9]/g, '');
  if (kind === 'zip') v = v.split('-')[0];
  if (kind === 'country') v = v.slice(0, 2);
  return v ? sha256(v) : undefined;
}

// Normalize any Shopify id (numeric or gid://shopify/Order/123) to a stable key.
const orderKey = (id) => `purchase_${String(id).replace(/^.*\/(\d+)$/, '$1')}`;

function buildUserData(u = {}) {
  const ud = {
    em: hash(u.email),
    ph: hash(u.phone, 'phone'),
    fn: hash(u.firstName),
    ln: hash(u.lastName),
    ct: hash(u.city),
    st: hash(u.province || u.state),
    zp: hash(u.zip, 'zip'),
    country: hash(u.country, 'country'),
    external_id: u.externalId ? sha256(String(u.externalId).trim()) : undefined,
    fbp: u.fbp || undefined,
    fbc: u.fbc || undefined,
    client_ip_address: u.clientIp || undefined,
    client_user_agent: u.clientUserAgent || undefined,
  };
  Object.keys(ud).forEach((k) => ud[k] === undefined && delete ud[k]);
  return ud;
}

async function sendEvent(e) {
  if (!PIXEL_ID || !ACCESS_TOKEN) throw new Error('META_PIXEL_ID / META_ACCESS_TOKEN not set');
  const payload = {
    data: [{
      event_name: e.eventName,
      event_time: e.eventTime || Math.floor(Date.now() / 1000),
      event_id: e.eventId,
      event_source_url: e.eventSourceUrl,
      action_source: e.actionSource || 'website',
      user_data: buildUserData(e.user || {}),
      custom_data: e.customData || {},
    }],
  };
  if (TEST_EVENT_CODE) payload.test_event_code = TEST_EVENT_CODE;

  const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  // Bound the request so we never exceed Shopify's ~5s webhook timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CAPI_TIMEOUT_MS || 4500));
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const json = await res.json().catch(() => ({}));
  // Temporary diagnostic: set CAPI_DEBUG=1 in Vercel to log Meta's exact reply.
  // Success looks like {events_received:1,...}; problems show the error here.
  if (process.env.CAPI_DEBUG) console.log('[capi]', res.status, JSON.stringify(json));
  if (!res.ok) throw new Error(`CAPI ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

module.exports = { sendEvent, buildUserData, hash, orderKey };
