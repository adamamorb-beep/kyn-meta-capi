/* =====================================================================
   KYN — SHOPIFY CUSTOM WEB PIXEL  (browser layer)
   Paste into: Shopify admin > Settings > Customer events > Add custom pixel.
   Set Permission = Required so it only fires for consenting visitors.
   ---------------------------------------------------------------------
   This is the ONE piece that must live in Shopify's sandbox, because it's
   the only code that runs on the checkout pages. It:
     - loads the Meta Pixel (fbq)
     - generates one event_id per event
     - fires the browser Pixel AND forwards the same id to /api/collect
     - for Purchase, uses purchase_<orderId> so it dedupes with the webhook

   BEFORE PASTING: set COLLECT to your own KYN Vercel URL (line below).
   ===================================================================== */

/* KYN's Meta dataset. This is NOT Heavelyn's (1341069530921816) — sending
   KYN traffic into that dataset would corrupt both brands' attribution and
   optimisation, and it cannot be unmixed afterwards. */
const META_PIXEL_ID = '1627686942360128';

/* <-- REPLACE with your KYN Vercel deployment, e.g.
   'https://kyn-meta-capi.vercel.app/api/collect'
   It must be the KYN project, not Heavelyn's: that deployment holds
   Heavelyn's access token and would report these events to Heavelyn's
   dataset no matter what this file says. */
const COLLECT = 'https://REPLACE-ME.vercel.app/api/collect';

!(function (f, b, e, v, n, t, s) {
  if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
  if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
  t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
})(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', META_PIXEL_ID);

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
const norm = (id) => String(id).replace(/^.*\/(\d+)$/, '$1'); // gid -> numeric

async function fbp() {
  let v = await browser.cookie.get('_fbp');
  if (!v) { v = `fb.1.${Date.now()}.${Math.floor(Math.random() * 1e16)}`; await browser.cookie.set(`_fbp=${v}; path=/; max-age=7776000`); }
  return v;
}
async function fbc(url) {
  let v = await browser.cookie.get('_fbc');
  const m = /[?&]fbclid=([^&]+)/.exec(url || '');
  if (!v && m) { v = `fb.1.${Date.now()}.${decodeURIComponent(m[1])}`; await browser.cookie.set(`_fbc=${v}; path=/; max-age=7776000`); }
  return v || undefined;
}
function send(p) { try { fetch(COLLECT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p), keepalive: true }); } catch (e) {} }

function user(event) {
  const c = init?.data?.customer || {};
  const ck = event?.data?.checkout || {};
  const a = ck.shippingAddress || ck.billingAddress || {};
  return {
    email: ck.email || c.email, phone: ck.phone || a.phone || c.phone,
    firstName: a.firstName || c.firstName, lastName: a.lastName || c.lastName,
    city: a.city, zip: a.zip, province: a.provinceCode, country: a.countryCode,
    externalId: c.id ? String(c.id) : event?.clientId,
  };
}

async function track(name, eventId, data, event, serverToo) {
  const url = event?.context?.document?.location?.href;
  const _fbp = await fbp(); const _fbc = await fbc(url);
  fbq('track', name, data || {}, { eventID: eventId });
  if (serverToo !== false) {
    send({ event_name: name, event_id: eventId, event_source_url: url, custom_data: data || {},
      user: user(event), fbp: _fbp, fbc: _fbc, user_agent: event?.context?.navigator?.userAgent });
  }
}

analytics.subscribe('page_viewed', (e) => track('PageView', uuid(), {}, e));

analytics.subscribe('product_viewed', (e) => {
  const v = e.data.productVariant;
  track('ViewContent', uuid(), { content_ids: [norm(v.product?.id)], content_type: 'product',
    content_name: v.product?.title, value: Number(v.price?.amount) || 0, currency: v.price?.currencyCode }, e);
});

/* KYN's pack selector adds ONE cart line with quantity 2 or 3 (single-variant
   product), so this standard event already fires once with the full pack value
   in cartLine.cost.totalAmount. Heavelyn needed an extra 'custom_bundle_added'
   event because its bundle adds several different variants; replicating that
   here would double-count every AddToCart. Verify in Test Events that a 3-pack
   reports ~92 EUR and not ~36 EUR. */
analytics.subscribe('product_added_to_cart', (e) => {
  const l = e.data.cartLine, v = l?.merchandise;
  track('AddToCart', uuid(), { content_ids: [norm(v?.product?.id)], content_type: 'product',
    num_items: l?.quantity || 1,
    value: Number(l?.cost?.totalAmount?.amount) || 0, currency: l?.cost?.totalAmount?.currencyCode }, e);
});

analytics.subscribe('checkout_contact_info_submitted', (e) => {
  const c = e.data.checkout;
  track('InitiateCheckout', uuid(), { num_items: (c.lineItems || []).reduce((n, li) => n + (li.quantity || 0), 0),
    value: Number(c.totalPrice?.amount) || 0, currency: c.currencyCode }, e);
});

analytics.subscribe('payment_info_submitted', (e) => {
  const c = e.data.checkout;
  track('AddPaymentInfo', uuid(), { value: Number(c.totalPrice?.amount) || 0, currency: c.currencyCode }, e);
});

/* Purchase: browser Pixel only (deterministic id). The Vercel orders/paid
   webhook sends the server Purchase with the SAME id -> Meta dedupes.
   serverToo = false here so /collect doesn't send a third copy. */
analytics.subscribe('checkout_completed', (e) => {
  const c = e.data.checkout;
  track('Purchase', `purchase_${norm(c.order?.id || c.token)}`, {
    content_ids: (c.lineItems || []).map((li) => norm(li.variant?.product?.id)), content_type: 'product',
    num_items: (c.lineItems || []).reduce((n, li) => n + (li.quantity || 0), 0),
    value: Number(c.totalPrice?.amount) || 0, currency: c.currencyCode,
  }, e, false);
});
