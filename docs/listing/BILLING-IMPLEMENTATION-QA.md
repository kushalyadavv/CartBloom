# Stockladder billing implementation — Q&A

Answers to CartBloom's questions about how Stockladder handles Shopify billing,
grounded in the actual source. Written 2026-07-31 against commit `6bd8406`.

**Context for the question:** CartBloom uses Shopify **App Pricing** (managed —
plans defined in the Partner Dashboard, app links to Shopify's hosted plan
selection page). The question was whether Stockladder uses the **Billing API**
(`appSubscriptionCreate` → `confirmationUrl` → "Approve subscription" screen),
and what the trade-offs are.

Anything the repository cannot answer is marked as such rather than guessed.

---

## TL;DR

- Stockladder uses the **Billing API** (`appSubscriptionCreate`), not managed App Pricing.
- It has **not passed App Store review with this implementation.** It was submitted,
  came back with **two billing requirements cited** (req 1.2.2, req 1.2.3), was
  remediated on 2026-07-25, and the repo records no resubmission or approval.
- Every billing defect the reviewer caught was in state Stockladder had to own
  *because* it rolled its own billing.
- For flat recurring tiers — which is what both apps have — the recommendation is
  to **switch to managed App Pricing**.

---

## 1. Which mechanism, definitively

### 1. `appSubscriptionCreate` or the hosted plan page?

**Billing API.** [`src/billing.js:4-26`](../src/billing.js#L4-L26) defines the
`appSubscriptionCreate` mutation; it is called at
[`src/billing.js:150`](../src/billing.js#L150).

There is no reference to `charges/:app/pricing_plans` anywhere in the tree — a grep
for `pricing_plans` across all source and config returns zero hits outside
billing.js's own mutation.

### 2. Dashboard setting: "Shopify App Pricing" or "Manual pricing with the API"?

**Not determinable from the repo**, and worth being straight about. Managed App
Pricing is dashboard-only config; it never appears in `shopify.app.toml` or the CLI
deploy bundle.

What the repo *does* show: the deployed module manifest at
`.shopify/deploy-bundle/manifest.json` contains modules for
`privacy_compliance_webhooks`, `app_access`, `webhooks`, `point_of_sale`, and
`app_home` — and **no pricing module**. Combined with working `appSubscriptionCreate`
calls (Shopify rejects those when managed pricing is enabled), it is effectively
certain the dashboard is set to **Manual pricing with the API**.

Confirm it in the dashboard directly before relying on it as precedent.

### 3. Deliberate choice or default?

**Can't tell from the repo.** Billing existed in the very first commit
(`3eeee6d Initial Stockladder app — multi-tenant OAuth, billing, per-shop data`)
with the mutation already written, so there is no commit where a choice was made and
recorded. No ADR, no note in [`README.md`](../README.md).

---

## 2. The mutation itself

### 4. The mutation and full variables

[`src/billing.js:4-26`](../src/billing.js#L4-L26):

```graphql
mutation AppSubscriptionCreate(
  $name: String!
  $returnUrl: URL!
  $trialDays: Int
  $test: Boolean
  $lineItems: [AppSubscriptionLineItemInput!]!
) {
  appSubscriptionCreate(
    name: $name
    returnUrl: $returnUrl
    trialDays: $trialDays
    test: $test
    lineItems: $lineItems
  ) {
    confirmationUrl
    appSubscription { id status trialDays }
    userErrors { field message }
  }
}
```

Variables, [`src/billing.js:150-165`](../src/billing.js#L150-L165):

```js
const returnUrl = `${appBaseUrl()}/api/billing/callback?shop=${encodeURIComponent(shop)}&plan=${planId}`;
const data = await client.graphql(SUBSCRIPTION_CREATE, {
  name: `Stockladder ${plan.name}`,        // "Stockladder Growth" / "Stockladder Pro"
  returnUrl,
  trialDays: plan.trialDays || null,       // 7 for both paid plans
  test: billingTestMode(),
  lineItems: [{
    plan: {
      appRecurringPricingDetails: {
        price: { amount: plan.price, currencyCode: "USD" },
        interval: "EVERY_30_DAYS",
      },
    },
  }],
});
```

> **Fragility worth copying down.** `name` is load-bearing beyond display — plan
> identity is recovered on the way back by **string-matching the subscription name**
> ([`src/billing.js:71-76`](../src/billing.js#L71-L76)):
>
> ```js
> export function mapSubscriptionNameToPlan(name = "") {
>   const lower = name.toLowerCase();
>   if (lower.includes("pro")) return "pro";
>   if (lower.includes("growth")) return "growth";
>   return "free";
> }
> ```
>
> Rename a plan in the UI and plan detection silently breaks.

### 5. How is `test` set?

Neither hardcoded nor derived from the shop — it is **environment-derived**
([`src/billing.js:56-61`](../src/billing.js#L56-L61)):

```js
function billingTestMode() {
  return process.env.SHOPIFY_BILLING_TEST === "true" ||
         process.env.NODE_ENV !== "production";
}
```

> **⚠️ Live footgun.** If the production process starts without
> `NODE_ENV=production`, every real merchant gets a **test charge** and the app bills
> nothing. Nothing in [`deploy/`](../deploy/) sets `NODE_ENV`. Shopify raises no
> error — revenue is simply zero.
>
> If CartBloom stays on the Billing API, derive `test` from the shop
> (`shop { plan { partnerDevelopment } }`), not from your own env.

### 6. Where do plan definitions live?

**Hardcoded in app source**, [`src/plans.js`](../src/plans.js):

| Plan | Price | Trial | Collections | Rule overrides | Orders/mo |
|---|---|---|---|---|---|
| `free` | $0 | 0d | 10 | 2 | 500 |
| `growth` | $9/mo | 7d | 50 | 20 | 1,000 |
| `pro` | $19/mo | 7d | 100 | 50 | 5,000 |

Each carries a `limits` and `features` block. Changing a price is a **code deploy**.
Under managed pricing these would live in the dashboard instead.

---

## 3. Redirecting to the confirmation page

### 7. How is the merchant sent to `confirmationUrl`?

**Client-side `window.open(url, "_top")`** —
[`web/src/PlanPanel.jsx:91-98`](../web/src/PlanPanel.jsx#L91-L98):

```js
const result = await api.subscribePlan(planId);
if (result.confirmationUrl) {
  window.open(result.confirmationUrl, "_top");
  onToast?.({ tone: "info", message: "Complete billing approval in Shopify Admin" });
  return;
}
```

Not a server-side `redirect()`, and not the `@shopify/shopify-app-react-router`
helper — this is a plain Express + Vite/React app ([`package.json`](../package.json)),
so that helper isn't available.

### 8. Is the upgrade button a form POST or a link?

**Neither.** A Polaris `<Button onClick>` → `fetch` POST to `/api/billing/subscribe`
([`web/src/api.js:66-70`](../web/src/api.js#L66-L70)) → server returns JSON
`{ confirmationUrl, subscription }`
([`server/index.js:340-350`](../server/index.js#L340-L350)) → client performs the
top-level navigation.

### 9. Any 401 or "refused to connect" from inside the embedded iframe?

**No.** `window.open(confirmationUrl, "_top")` is present in the initial commit and
was never changed — the only later commit touching that file (`f0b43d7`) changed
destructuring, not navigation. Zero commits about iframe/CSP/"refused to connect".

The 401s in the history are a **different problem**:
`6bd8406 Auto-retry once on expired/invalid session token`. App Bridge session tokens
live ~60s, and a backgrounded tab throttles JS timers, so App Bridge can hand back an
already-stale token on the next click. Fixed with a one-shot retry in
[`web/src/api.js:18-22`](../web/src/api.js#L18-L22). Unrelated to billing navigation —
it would hit you under managed pricing too.

---

## 4. Coming back after approval

### 10. What is `returnUrl`?

[`src/billing.js:149`](../src/billing.js#L149):

```
${appBaseUrl()}/api/billing/callback?shop=<shop>&plan=<planId>
```

`appBaseUrl()` resolves `PUBLIC_URL` → `APP_URL` → `http://localhost:3001`
([`src/billing.js:63-69`](../src/billing.js#L63-L69)).

The `plan` query param is passed but **never read** by the handler — the callback
re-queries Shopify instead of trusting it. Good instinct, dead parameter.

### 11. How does the app learn the subscription is active?

**Re-queries, with an explicit retry loop**, and does *not* trust the URL param
([`server/index.js:352-376`](../server/index.js#L352-L376)):

```js
const record = await syncPlanFromShopify(client, shop, { retries: 5 });
planId = record?.planId ?? "free";
const base = shop ? embeddedAppUrl(shop) : process.env.PUBLIC_URL?.trim() || "/";
const status = planId === "free" ? "declined" : "confirmed";
res.redirect(`${base}?billing=${status}`);
```

The retry exists because of a real bug — commit `5995477` root-caused a
read-after-write race where Shopify's `activeSubscriptions` query lags the approval,
silently dropping the merchant back to Free. Backoff is 6 attempts × 800ms
([`src/billing.js:99-111`](../src/billing.js#L99-L111)).

`embeddedAppUrl()` returns `https://{shop}/admin/apps/{clientId}`
([`src/shop-auth.js:188-193`](../src/shop-auth.js#L188-L193)) so the merchant lands
back **inside the admin**, not on the standalone origin — that was requirement 2.3.3
feedback.

### 12. Is `APP_SUBSCRIPTIONS_UPDATE` subscribed, and what does the handler do?

Yes. Registered in
[`src/webhook-registration.js:19-23`](../src/webhook-registration.js#L19-L23), handler
at [`server/index.js:95-117`](../server/index.js#L95-L117) (HMAC-verified),
delegating to `handleSubscriptionWebhook`
([`src/billing.js:186-211`](../src/billing.js#L186-L211)):

- `ACTIVE` / `ACCEPTED` → map subscription name to plan, persist
- `CANCELLED` / `DECLINED` / `EXPIRED` → set plan to free

> **Important history:** this webhook was **never actually registered for any real
> shop until 2026-07-25.** From `5995477`'s commit body — *"Webhooks were never
> registered for any managed-install shop… `APP_SUBSCRIPTIONS_UPDATE`, the real-time
> backup for syncing plan state, was silently inactive for every shop."* Registration
> was only wired into a manual CLI script; the token-exchange path that every managed
> install actually uses never called it. It now fires idempotently on first token
> exchange.

---

## 5. Reading the current plan

### 13. How is the current plan determined for gating?

**Locally stored, not queried at gate time.** `getPlanContext()`
([`src/shop-store.js:198-203`](../src/shop-store.js#L198-L203)) reads a per-shop JSON
record from disk and calls `getPlan(record.planId)`.

Shopify is queried at exactly two moments: the billing callback, and the webhook.

No `billing.check()` — that helper ships with `@shopify/shopify-app-*`, which this app
does not use.

### 14. Is it cached?

**No cache layer** — `readShopRecordFile` does a `readFileSync` per call
([`src/shop-store.js:67-73`](../src/shop-store.js#L67-L73)). The *file itself* is the
durable store, so the plan is effectively cached forever until the callback or the
webhook rewrites it.

That is precisely why the missing webhook registration (#12) was so damaging: with
both refresh paths broken, a stale record never self-corrected.

### 15. Is a trialing subscription distinguished from a paid one?

**Not at all.** `trialEndsAt` exists in the record shape
([`src/shop-store.js:48`](../src/shop-store.js#L48)) and `setShopPlan` will accept it
([`src/shop-store.js:178-180`](../src/shop-store.js#L178-L180)), but **nothing in the
tree ever writes it.**

`subscriptionStatus` is stored and returned by `/api/plan` but is **never read by any
gating decision** — every check goes through `record.planId` only.

Two consequences worth knowing before copying this design:

1. A trialing merchant and a paying merchant are indistinguishable to the app.
2. [`src/billing.js:173-178`](../src/billing.js#L173-L178) writes the plan record
   **optimistically at `appSubscriptionCreate` time, with status `PENDING`** — before
   the merchant has approved anything. Since gating ignores status, clicking "Upgrade
   to Pro" and abandoning the approval screen **grants Pro features immediately.** It
   self-heals via the callback or the `DECLINED` webhook, but the window is real — and
   it was a *permanent* hole during the period when webhooks weren't registered.

---

## 6. Downgrades and cancellation

### 16. What does "Downgrade to Free" call?

**`appSubscriptionCancel`**, on every active subscription
([`src/billing.js:127-140`](../src/billing.js#L127-L140) → `cancelActiveSubscriptions`
at [`src/billing.js:84-97`](../src/billing.js#L84-L97)). It iterates
`ACTIVE`/`ACCEPTED`/`PENDING` subs and cancels each. No free-plan
`appSubscriptionCreate`.

> This was **not** the original behavior. Commit `352ad25 (req 1.2.2)`: *"Downgrading
> to Free never cancelled the active Shopify subscription, so a merchant leaving a
> paid plan kept being charged while only receiving Free features."* A
> reviewer-caught billing defect — merchants charged for a plan they had left.

Paid→paid upgrades don't cancel explicitly; Shopify auto-cancels the prior
subscription on `appSubscriptionCreate`
([`src/billing.js:131-132`](../src/billing.js#L131-L132)).

### 17. Immediate or at period end?

The app's local plan flips **immediately** — `setShopPlan(shop, "free", …)` runs
synchronously after the cancel
([`src/billing.js:136-139`](../src/billing.js#L136-L139)). Shopify's own
proration/period-end handling is whatever `appSubscriptionCancel` does by default; the
app passes no `prorate` argument and models no grace period. The merchant loses
features instantly.

### 18. What happens to data exceeding the lower plan's limits?

Config is **coerced down rather than blocked**, via `applyPlanToConfig`
([`src/plans.js:163-200`](../src/plans.js#L163-L200)):

- `hide` out-of-stock → reverts to `push_down`
- variant sort → off
- promote/demote tag and vendor lists → **emptied**
- rule stack → reset to default
- sales strategies → reverted to `inventory_full`
- seasonal collections and smart mirrors → **emptied**
- `collectionRules` → **truncated** by `clampCollectionRules`, i.e.
  `entries.slice(0, maxOverrides)` — silently dropped in object order, no warning

**Downgrade → re-upgrade is lossy.**

---

## 7. Testing and review

### 19. Does the flow work end to end on a development store?

**Not verifiable from the repo**, and there is a specific reason to doubt local
testing ever exercised it: [`.env`](../.env) has **`ALLOW_DEV_PLAN_SWITCH=true`**,
which short-circuits billing entirely
([`src/billing.js:142-147`](../src/billing.js#L142-L147)):

```js
if (process.env.ALLOW_DEV_PLAN_SWITCH === "true") {
  return setShopPlan(shop, planId, {
    subscriptionId: `dev-${planId}`,
    subscriptionStatus: "ACTIVE",
  });
}
```

No mutation, no confirmation page, no approval. It also skips the cancel on downgrade
([`src/billing.js:133`](../src/billing.js#L133)). So on the dev machine, the flow that
runs is **not** the flow merchants get. The UI does warn about this
([`web/src/PlanPanel.jsx:141-146`](../web/src/PlanPanel.jsx#L141-L146)).

The strongest evidence about real dev-store behavior is negative: with the flag off, a
reviewer on a real store **did** run it, and it failed — see #21.

### 20. Any 404 on the plan page on a dev store?

**No trace anywhere** — not in commits, not in README troubleshooting
([`README.md:184`](../README.md#L184) covers only `shop_not_permitted`), not in docs.
The failures actually hit were plan-state failures, not page-load failures.

Consistent with the hypothesis that the Billing API path avoids the App Pricing
draft-app/locale 404 — but this is absence of evidence, not evidence of absence.

### 21. Has Stockladder passed App Store review with this billing implementation?

**No. It was submitted and came back with billing citations.** Four commits carry
reviewer requirement numbers:

| Commit | Date | Requirement | Reviewer finding |
|---|---|---|---|
| `7168399` | 2026-07-21 | req 2.3.1 | Manual store-domain entry in embedded install |
| `fdbcd1f` | 2026-07-21 | req 2.3.3 | Didn't redirect into embedded admin after OAuth |
| `352ad25` | 2026-07-21 | **req 1.2.2** | Downgrade didn't cancel subscription — merchants kept being charged |
| `1bad018` | 2026-07-22 | req 2.3.1 | Landing page collected shop URL instead of linking the listing |
| `5995477` | 2026-07-25 | **req 1.2.3** | *"upgrading to Pro leaves the account on the Basic/Free tier"* |

**Two billing requirements cited (1.2.2, 1.2.3), both substantive.** The last fix
landed 2026-07-25; the repo contains no record of resubmission or approval.

Treat this as a **rejected-then-remediated app, outcome unknown** — close to the
opposite of useful positive precedent.

---

## 8. Regrets

### 22. Billing API again, or switch to Shopify App Pricing?

No retrospective doc exists in the repo, so this is what the codebase argues rather
than a recorded opinion.

**The evidence points at switching to managed App Pricing.** Every billing defect the
reviewer caught was in state Stockladder had to own *because* it used the Billing API:

- plan identity recovered by substring-matching a subscription name
  ([`src/billing.js:71-76`](../src/billing.js#L71-L76))
- cancel-on-downgrade hand-written, and initially missing (req 1.2.2)
- post-approval sync racing Shopify's own propagation, needing a 6× retry loop
  (req 1.2.3)
- the webhook meant to be the safety net not registered for any real shop
- `test` mode keyed off `NODE_ENV`, one missing env var away from billing nobody

Under managed pricing, Shopify owns the plan state machine, the cancel semantics, the
confirmation page, and the test-vs-live determination. Roughly all of
[`src/billing.js`](../src/billing.js) collapses to "read `activeSubscriptions`, map to
a plan."

**The case for keeping the Billing API** is real but narrow: usage-based line items,
per-merchant custom pricing, arbitrary trial logic, or prices changed without a
dashboard edit.

If CartBloom's plans are flat recurring tiers — which is what Stockladder's are —
managed pricing removes the exact failure class that got Stockladder cited. **Switch.**

### 23. Most annoying part of the Billing API implementation?

By the commit record: **`5995477`**, and it was non-obvious in an instructive way.

The symptom was a single line of reviewer feedback — *"upgrading to Pro leaves the
account on Free."* It had **three independent causes stacked**, and fixing any one
alone would not have fixed it:

1. **`APP_SUBSCRIPTIONS_UPDATE` never registered for managed-install shops.** The
   token-exchange path never called registration, so the real-time backup was dead for
   *every* shop — and the paid inventory-webhook auto-sort feature had never worked
   either.
2. **The callback queried Shopify with no propagation allowance** — a read-after-write
   race that defaulted the shop back to Free.
3. **A pure frontend bug found the same week** (`f0b43d7`): `/api/plan` spreads
   `planUsageSummary()` flat, but [`PlanPanel.jsx`](../web/src/PlanPanel.jsx)
   destructured a nested `plan` object that never existed, so `plan?.name` fell back to
   `"Free"` **unconditionally** — the UI showed Free even once the backend had it right.

**The lesson for CartBloom:** two of those three are Billing-API-specific plumbing
(registration, propagation race), and the third was masked by them. Managed pricing
would not have created #1 or #2 — and #3 would have been obvious immediately without
them.

---

## Appendix: files that matter

| File | Role |
|---|---|
| [`src/billing.js`](../src/billing.js) | All three mutations, plan sync, webhook handler, test-mode toggle |
| [`src/plans.js`](../src/plans.js) | Hardcoded plan catalog, limits, features, downgrade coercion |
| [`src/shop-store.js`](../src/shop-store.js) | Per-shop JSON record — the durable plan store |
| [`src/webhook-registration.js`](../src/webhook-registration.js) | Idempotent webhook registration incl. `APP_SUBSCRIPTIONS_UPDATE` |
| [`server/index.js`](../server/index.js) | `/api/plan`, `/api/billing/subscribe`, `/api/billing/callback`, webhook routes |
| [`web/src/PlanPanel.jsx`](../web/src/PlanPanel.jsx) | Plan UI, `window.open(confirmationUrl, "_top")` |
| [`web/src/api.js`](../web/src/api.js) | Fetch wrapper with the 401 session-token retry |
