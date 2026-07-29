# CartBloom — App Store listing copy

Written against the review playbook: no superlatives, no fabricated statistics,
no pricing outside the pricing section, no competitor names, and search terms
that are complete words carrying one concept each.

Everything below is copy-paste ready except the five items marked **YOU** —
those need a decision or an asset only you can produce.

---

## 1. Basic app information

**App category:** Marketing and conversion
**Subcategory:** Upselling and cross-selling

> Chosen over "Discounts and offers" because a reviewer categorises by what the
> merchant is buying, and merchants install this to raise cart value. The
> discount is the mechanism, not the product.

---

## 2. App store listing content

### App introduction
*(one sentence, shown under the app name — no superlatives)*

```
Show a cart progress bar with tiered rewards, and let shoppers pick their own free gift.
```

### App details

```
CartBloom adds a progress bar to your cart that fills as shoppers add items, with a reward at each milestone you set — free shipping, a discount, or a gift.

Set as many tiers as your plan allows, each with its own reward. When a tier offers gifts, shoppers choose from the products you selected rather than receiving one at random.

You decide how rewards combine: shoppers can keep a gift from every tier they reach, or only one. When it is only one, you choose whether that is the most valuable tier, a specific tier, or the shopper's own pick.

Everything is styled in the app — colours, fonts, spacing and wording — with a live preview and a cart-value slider, so you can see what shoppers see before publishing.

CartBloom requests no access to customers or orders and stores no personal data about your shoppers.
```

### Features
*(each starts with a noun phrase, no adjectives doing the work)*

```
Tiered rewards — free shipping, a percentage or amount off, or a free or discounted gift
Shopper-chosen gifts, picked from the products you select for each tier
Rules for combining rewards across tiers, including highest-value and pinned-tier
Live preview with a cart-value slider, so you check a ladder without a test order
Full styling control — colours, font size and weight, spacing, wording and corner radius
```

### Feature media
**YOU** — a short video or image of the wizard's **cart-value slider** being dragged
from £0 past the top tier while markers unlock and the gift card appears.

> This is the strongest asset you have. It shows configuration and outcome in one
> motion, and it is the thing no competitor screenshot in your research
> demonstrated. Record it from the Design or Review step where the preview sits
> beside the form.

### Screenshots
**YOU** — capture these five, in this order:

1. **Cart drawer, mid-ladder** — bar partly filled, one tier unlocked, gift card showing.
2. **The gift chooser modal**, open, with real product images.
3. **The wizard's Tiers step**, showing three tiers with different reward types.
4. **The Gifts step**, showing the claim-policy controls.
5. **The Review step**, showing the plain-language summary beside the preview.

> Real before/after only — no mockups, no invented storefronts. Numbers 1 and 2
> are what a shopper sees; 3–5 are what the merchant does.

### Support
**YOU** — support email address. Must be a **round-trip verified** inbox: a
forwarding-only address (Cloudflare Email Routing to Gmail) receives but cannot
reply, and review checks that you can reply.

### Resources
**YOU** — privacy policy URL. The text must match what the app actually does:
offers and an access token stored, no customer or order data, everything erased
on uninstall. Do not use a generic template that claims to collect analytics or
personal data you never touch — a policy that over-claims fails review as
readily as one that under-claims.

---

## 3. Pricing details

| Plan | Price | Live offers | Tiers per offer |
|---|---|---|---|
| Free | Free | 1 | 3 |
| Growth | $9.99 / month | 5 | 6 |
| Pro | $19.99 / month | 25 | 12 |

Every plan includes all design, gift and claim-policy features. Drafts are
unlimited on every plan.

**Set the redirection URL on each plan to `/app/plan`.** Shopify appends
`plan_handle`, which the app reads to skip its plan cache — without it a merchant
who has just upgraded sees their old limits for up to five minutes and concludes
the upgrade failed.

---

## 4. App discovery content

### App card subtitle
*(the one-liner in search results — no keyword stuffing)*

```
Cart progress bar with tiered free gifts
```

### App store search terms
*(complete words, one concept each, no "Shopify", no competitor names)*

```
cart progress bar
free gift
tiered rewards
cart upsell
gift picker
```

---

## 5. Install requirements

**Sales channel requirements:** Online Store

> CartBloom renders through a theme app embed, so it needs the Online Store
> channel. It does not need any other channel, and does not work on headless
> storefronts — say so here rather than letting a reviewer discover it.

---

## 6. Contact information

**YOU** — both fields:
- **Merchant review email** — where merchants' listing reviews go.
- **App submission email** — where Shopify sends review correspondence. Check it
  daily during review; the playbook's note about replying fast is what keeps a
  one-round review from becoming three.

---

## 7. App testing information

### Test account
**YOU** — a development store with:
- The CartBloom theme app embed **already enabled** in the theme editor.
- At least **four products with images**, so the gift chooser has something to show.
- One published CartBloom offer, so a reviewer sees the storefront working before
  they build their own.

### Screencast URL
**YOU** — unlisted video, roughly two minutes, following the numbered steps below
exactly. Record the storefront and the admin in one take so a reviewer can see
that the offer they configure is the offer that appears.

### Testing instructions

```
CartBloom adds a tiered rewards progress bar to the cart. No third-party account
is needed. The theme app embed is already enabled on the test store.

SETUP ALREADY DONE ON THE TEST STORE
- Theme app embed "CartBloom" is enabled in the theme editor.
- One offer, "Free gifts on every purchase", is published with three tiers.

TO SEE IT ON THE STOREFRONT
1. Open the storefront and add any product to the cart.
2. Open the cart drawer. The CartBloom bar appears above the cart items,
   showing how much more is needed for the next reward.
3. Add products until the cart passes the first tier. A card headed
   "SELECT YOUR GIFT" appears with a "Select" button.
4. Click "Select". A modal headed "Select free gift" opens with the gift
   products.
5. Choose a product, then click "Claim selected gift". The gift is added to the
   cart at no charge and the cart updates without a page reload.
6. Proceed to checkout. The gift line shows a 100% discount applied by the
   CartBloom discount function.

TO BUILD AN OFFER FROM SCRATCH
1. In the Shopify admin, open Apps > CartBloom.
2. Click "Create offer".
3. Step 1 "Trigger": enter a name. Leave the trigger as "Cart subtotal".
4. Step 2 "Tiers": set the first tier's amount. Set its reward to "A free or
   discounted gift". Click "Add tier" and set a higher amount.
5. Step 3 "Gifts": click "Add products" and choose two or more products for each
   gift tier. Set "Within one tier" to "They choose one product".
6. Step 4 "Design": optional. Drag the cart-value slider under the preview to
   see the ladder unlock.
7. Step 5 "Placement": leave both toggles on.
8. Step 6 "Review": read the plain-language summary, then click "Publish".
9. Return to the storefront and repeat the six steps above.

NOTES FOR THE REVIEWER
- CartBloom requests write_discounts and read_products only. It requests no
  customer or order scopes and holds no customer personal data. Tier targeting
  by customer tag is evaluated inside Shopify's discount function via hasTags,
  which returns a boolean and never yields a customer record.
- Gift entitlement is decided by the discount function at checkout, not by the
  storefront. A cart line manually given CartBloom's gift properties without
  meeting the threshold is billed at full price.
- Uninstalling erases all stored data for the shop.
```

---

## Before you submit

- [ ] Upload `icon.svg` as the app icon (16×16, `currentColor`, transparent — verified).
- [ ] Create the three plans, with the redirection URL set to `/app/plan`.
- [ ] Round-trip test the support inbox: send **from** it, not just to it.
- [ ] Confirm scopes are still `write_discounts,read_products` and nothing widened them.
- [ ] Run `shopify app-store-review` against the codebase.
- [ ] Complete Task 48 — a clean-store install and a real checkout — before submitting.
