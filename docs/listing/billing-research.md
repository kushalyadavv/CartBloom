# How Shopify billing works in 2026, and what CartBloom should do

Researched 2026-07-31 against the live docs via `shopify doc fetch`, not from
memory. Sources are linked inline.

---

## TL;DR

- There are **two** billing models. Shopify App Pricing is **the default and
  recommended** one; the Billing API is **explicitly labelled legacy**.
- Stockladder passed review on the legacy path. That proves it is *permitted*,
  not that it is *correct for a new app*.
- CartBloom's plan page almost certainly 404s because **App Pricing has not been
  enabled as the billing solution** — a separate switch from filling in pricing
  content on the listing.
- **Recommendation: fix the configuration, stay on App Pricing.** Switching to
  the legacy API means owning the exact failure class that got Stockladder cited
  twice.

---

## 1. The two models

### Shopify App Pricing — default and recommended

> "Shopify App Pricing is the default and recommended approach for all apps
> published on the Shopify App Store. Define plans in the app submission form and
> let Shopify host your plan selection page and automate billing, trials,
> proration, upgrades, and downgrades."
> — [About billing for your app](https://shopify.dev/docs/apps/launch/billing)

Shopify owns: the plan selection page, the approval screen, trials, proration,
upgrade and downgrade semantics, cancellation, chargebacks, and test-vs-live
determination. The app's only job is to read which plan is active and gate on it.

### Manual Pricing / Billing API — legacy

> "Manual pricing is still supported but is **the legacy method** for handling
> app billing. With manual pricing, you build your own billing logic and pricing
> page using the Billing API […] This option remains available for apps that have
> specific requirements not covered by Shopify App Pricing yet, and for existing
> app developers who are using it."
> — same page

Note the framing: it exists for *unmet requirements* and *existing users*. Ours
are flat recurring tiers, which App Pricing covers completely.

### They are mutually exclusive

> "Once you opt in to Shopify App Pricing, you can't create new recurring
> application charges using the Billing API."
> — [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing)

So this is a fork, not a layering.

---

## 2. Why CartBloom's plan page 404s

The docs give **three** prerequisites. All must hold.

### a. App Pricing must be *enabled*, not merely populated

> "Your app needs to have **Shopify App Pricing enabled, with at least one plan
> configured**."
> — [Redirect to the plan selection page](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/redirect-plan-selection-page) § Requirements

**This is the one to check first.** Entering plans under *Pricing details* in the
listing form is content. Selecting App Pricing as the billing *solution* is a
separate switch:

> Partner Dashboard → **Apps** → your app → **Distribution** → beside *Shopify
> App Store listing* click **Manage listing** → **Published languages** → **Edit**
> your locale → **Pricing content** → **Manage** → **Settings** → select
> **Shopify App Pricing** → **Switch**.

If that switch has never been thrown, the hosted page has nothing to serve and
404s — exactly the symptom.

### b. The development store must be in the same Partner organization

> "You can test draft Shopify App Pricing plans on a development store that
> **belongs to the same Partner organization as your app**."
> — [Migrate to Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/migrating-to-shopify-app-pricing) § Step 3

Both `cartbloom-test` and `stockladder-test-store` appear to sit under Pinion
Labs Inc alongside the app, so this likely holds — but it is worth confirming,
because a store from another org fails silently.

### c. Locales must match, for draft apps on dev stores

> "When testing a draft app during development, its plan selection page **might
> return a 404 error if the development store and the app listing are set to
> different locales**. This issue doesn't affect production stores or published
> apps."
> — [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing) § Known limitations

Your listing is the **English** primary. If the dev store's admin language is
anything else, this alone produces a 404 that disappears at publish.

### Diagnostic order

1. Check (a) — the billing-solution switch. Most likely cause, and free to check.
2. Check (c) — dev store admin language vs listing locale.
3. Check (b) — store and app in the same Partner org.

If all three hold and it still 404s, that is a genuine Shopify-side problem worth
raising with Partner support, and *then* switching becomes defensible.

---

## 3. What the app code should look like under App Pricing

CartBloom is already close to correct.

| Concern | Requirement | CartBloom |
|---|---|---|
| Send merchant to plan page | `admin.shopify.com/store/:store/charges/:app/pricing_plans` | ✅ built from `SHOPIFY_APP_HANDLE` |
| Escape the iframe | `target: '_top'` — embedded apps cannot redirect the parent frame | ✅ `target="_top"` link |
| Read active plan | `currentAppInstallation.activeSubscriptions` | ✅ `fetchPlan` |
| Handle the return | `plan_handle` appended to the redirect URL | ✅ read, and used to wait out propagation |
| Only count real subscriptions | `ACTIVE` only — not `FROZEN` or `PENDING` | ✅ |
| Trials | A trialing subscription reports `ACTIVE` | ✅ nothing extra needed |

The one open question is whether to use the library's `billing.check()` helper
instead of raw GraphQL. The App Pricing redirect doc uses it:

```js
const { billing, redirect, session } = await authenticate.admin(request);
const { hasActivePayment } = await billing.check();
```

It returns a boolean, not a plan name, so it does not replace `fetchPlan` — which
needs to distinguish Growth from Pro. Not worth changing.

---

## 4. What switching to the legacy Billing API would cost

Everything Shopify currently owns becomes ours:

- `appSubscriptionCreate`, `appSubscriptionCancel`, plan catalogue in source
- cancel-on-downgrade, by hand — **Stockladder shipped this wrong** and was cited
  under requirement 1.2.2, with merchants still being charged after leaving a
  paid plan
- post-approval sync racing Shopify's own propagation — **cited under requirement
  1.2.3**
- `APP_SUBSCRIPTIONS_UPDATE` registration as the safety net, which in
  Stockladder's case was never actually registered for any real shop
- test-vs-live determination, which in Stockladder's case keys off `NODE_ENV` and
  is one missing env var away from billing nobody

Against that: a marginally better click path — straight to "Approve subscription"
for one named plan, rather than a picker.

---

## 5. Recommendation

**Fix the configuration; stay on App Pricing.**

1. Throw the billing-solution switch (§2a). Most likely the whole problem.
2. Match the dev store's locale to the listing's (§2c).
3. Re-test the plan page.

Switch to the legacy Billing API **only** if all three prerequisites are
confirmed correct and Shopify still serves a 404 — at which point it is a
platform bug, and the legacy path is a documented, review-passing workaround
rather than a preference.

The App Store requirement (1.2.1) accepts either, so this is an engineering
decision, not a compliance one.
