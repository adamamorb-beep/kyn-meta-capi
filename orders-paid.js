/* api/orders-paid.js — Shopify "orders/paid" webhook -> authoritative Purchase.
   This is the unblockable source of truth. It dedupes against the browser
   Pixel Purchase via the shared id: purchase_<orderId>.

   Vercel needs the RAW body to verify Shopify's HMAC signature. */
const crypto = require('crypto');
const capi = require('./_lib/meta-capi');

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const raw = await readRaw(req);

  // Verify the request really came from Shopify.
  const digest = crypto
    .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET || '')
    .update(raw, 'utf8')
    .digest('base64');
  const sig = req.headers['x-shopify-hmac-sha256'] || '';
  const ok = sig.length === digest.length &&
    crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(sig));
  if (!ok) return res.status(401).json({ error: 'bad hmac' });

  // Do NOT ack before the Meta call — on Vercel the function freezes right after
  // the response and the fetch never fires. Send to Meta first, then respond.
  try {
    const o = JSON.parse(raw);
    const ship = o.shipping_address || o.billing_address || {};
    const clientDetails = o.client_details || {};

    await capi.sendEvent({
      eventName: 'Purchase',
      eventId: capi.orderKey(o.id),                 // matches the browser Pixel
      eventSourceUrl: o.order_status_url,
      customData: {
        value: Number(o.total_price) || 0,
        currency: o.currency,
        content_ids: (o.line_items || []).map((li) => String(li.product_id)),
        content_type: 'product',
        num_items: (o.line_items || []).reduce((n, li) => n + (li.quantity || 0), 0),
      },
      user: {
        email: o.email || o.contact_email,
        phone: o.phone || ship.phone,
        firstName: ship.first_name,
        lastName: ship.last_name,
        city: ship.city,
        province: ship.province_code,
        zip: ship.zip,
        country: ship.country_code,
        externalId: o.customer && o.customer.id,
        // fbp/fbc captured at checkout arrive as order note attributes (see README).
        fbp: attr(o, '_fbp'),
        fbc: attr(o, '_fbc'),
        clientIp: clientDetails.browser_ip,
        clientUserAgent: clientDetails.user_agent,
      },
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[orders-paid]', err.message);
    // Non-2xx makes Shopify retry later; the shared event_id means a retry
    // can't double-count, so this recovers transient failures safely.
    return res.status(500).json({ ok: false });
  }
};

// Pull a value the pixel stored on the cart/order as a note attribute.
function attr(order, key) {
  const a = (order.note_attributes || []).find((x) => x.name === key);
  return a ? a.value : undefined;
}

// Tell Vercel NOT to pre-parse the body, so readRaw() gets the exact bytes
// Shopify signed. (Set after the handler export so it isn't overwritten.)
module.exports.config = { api: { bodyParser: false } };
