# KYN — Meta Pixel + Conversions API

Same architecture as Heavelyn, separate everything: separate repo, separate
Vercel project, separate dataset, separate access token. A KYN deploy cannot
take down Heavelyn's tracking, and the two tokens rotate independently.

```
kynlabs.fr + checkout                  Vercel (kyn-meta-capi)          Meta
─────────────────────                  ──────────────────────          ────
custom web pixel  ── fbq ─────────────────────────────────────────────▶ Pixel
       │  same event_id                                                   │
       └── POST /api/collect ──▶ hash + enrich ──▶ CAPI ─────────────────▶ CAPI
                                                                          │
order paid ──▶ Shopify webhook ──▶ /api/orders-paid ──▶ CAPI Purchase ──▶ dedupe
                                                        (purchase_<id>)
```

KYN dataset: **1627686942360128**

---

## Order of operations

### 1. GitHub (you)
New repository, `kyn-meta-capi`. Upload this whole folder — `api/`,
`package.json`, `shopify-web-pixel.js`. `.env.example` is a reference only;
its real values go into Vercel, never into git.

A separate repo rather than a second Vercel project on the Heavelyn repo: it
means a change made for KYN can't ship to Heavelyn's deployment by accident.

### 2. Vercel (you)
Add New → Project → import `kyn-meta-capi` → Deploy. Then Settings →
Environment Variables, using `.env.example`:

| Variable | Value |
|---|---|
| `META_PIXEL_ID` | `1627686942360128` |
| `META_ACCESS_TOKEN` | from Events Manager (secret) |
| `META_API_VERSION` | `v25.0` |
| `META_TEST_EVENT_CODE` | while testing only — remove for production |
| `SHOPIFY_WEBHOOK_SECRET` | leave blank until step 4 |

**Redeploy** after adding them — env vars are read at build time.

Note: the code defaults to `v21.0` if `META_API_VERSION` is unset. That version
is around two years old and near Meta's retirement window, which is why it is
pinned explicitly here. Heavelyn's deployment has the same default and should be
checked.

Send me the deployment URL.

### 3. Custom pixel (you — 2 min, no API for this)
Open `shopify-web-pixel.js`, replace the `COLLECT` constant with your Vercel
URL + `/api/collect`. Then Shopify admin → Settings → Customer events → Add
custom pixel → paste the whole file → Save → Permission = **Required** →
Connect.

### 4. Orders webhook (me)
I create the `orders/paid` webhook against `.../api/orders-paid` through the
Shopify connection once the URL exists. Shopify then shows a signing secret —
paste it into Vercel as `SHOPIFY_WEBHOOK_SECRET` and redeploy. Until it is set,
the endpoint returns 401 on every call by design.

### 5. Verify (you)
Requires the theme published and the storefront password lifted — custom pixels
do not run behind the password page, and Test Events will sit empty.

- Test Events open, walk the funnel. Each event should appear from **both**
  Browser and Server.
- **Check the pack value.** Add a 3-pack: AddToCart must report ~92 EUR, not
  ~36 EUR. If it reports one unit, tell me.
- Test order → **one** Purchase, deduplicated, not two.
- Remove `META_TEST_EVENT_CODE` and redeploy.

---

## Known gap: fbp/fbc on the server Purchase

`api/orders-paid.js` reads `_fbp` / `_fbc` from the order's note attributes, but
nothing currently writes them there — no theme code sets those cart attributes.
So the server Purchase goes out without the Meta click identifiers and leans on
email, phone, name, IP and user-agent for matching.

That is workable but weaker than it should be, on the one event that ad blockers
can't stop. The fix is a small theme snippet that copies the `_fbp` / `_fbc`
cookies into cart attributes before checkout, gated on consent. Worth doing once
the basics are verified.

## Compliance (EU / France)
- Permission = Required, so the pixel only fires for consenting visitors.
- Expect the same LPV/click gap seen on Heavelyn: that was consent accept-rate,
  not a broken pixel. Do not debug the pixel over it.
- Never send Meta health, financial account or government ID data — it can get
  the dataset restricted.
- `fbp`/`fbc` are never hashed; email, phone and name always are, server-side.
