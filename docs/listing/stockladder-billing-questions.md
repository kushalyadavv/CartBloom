# Questions for the Stockladder session — billing implementation

Context for whoever answers: CartBloom uses **Shopify App Pricing** (managed —
plans defined in the Partner Dashboard, app links to Shopify's hosted plan
selection page). Stockladder appears to use the **Billing API**
(`appSubscriptionCreate` → `confirmationUrl` → "Approve subscription" screen).
I want to confirm that and understand the trade-offs before deciding whether
CartBloom should switch.

Please answer with specifics — file paths, actual code, actual dashboard
settings — rather than summaries.

---

## 1. Which mechanism, definitively

1. Does Stockladder call `appSubscriptionCreate` (Billing API), or does it link
   to `admin.shopify.com/store/:store/charges/:app/pricing_plans` (App Pricing)?
2. In the Partner/Dev Dashboard, under the app's **Pricing** settings, is the
   billing solution set to **"Shopify App Pricing"** or **"Manual pricing with
   the API"**?
3. Was that a deliberate choice, or the default it came with?

## 2. The mutation itself

4. Paste the actual `appSubscriptionCreate` mutation and the full variables
   object, including `lineItems`, `trialDays`, `test`, and `returnUrl`.
5. How is `test` set? Hardcoded, or derived from whether the shop is a
   development store?
6. Are plan definitions (name, price, trial length, caps) hardcoded in the app's
   source, or read from somewhere else?

## 3. Redirecting to the confirmation page

7. How does the app send the merchant to `confirmationUrl`? Specifically:
   - a server-side `redirect()` from a loader or action?
   - the `@shopify/shopify-app-react-router` `redirect` helper with
     `{ target: '_top' }`?
   - a client-side `<a target="_top">`, or `open(url, '_top')`?
8. Is the upgrade button a form POST / action, or a link?
9. Did you hit any **401** or **"refused to connect"** problems when navigating
   from inside the embedded admin iframe? If so, what fixed it?

## 4. Coming back after approval

10. What is `returnUrl` set to, exactly?
11. After the merchant approves, how does the app learn the subscription is
    active — does it re-query, trust a URL parameter, or use a webhook?
12. Is `APP_SUBSCRIPTIONS_UPDATE` subscribed to? If so, what does the handler do?

## 5. Reading the current plan

13. How does the app determine which plan a shop is on for gating?
    `currentAppInstallation.activeSubscriptions`, the `billing.check()` helper,
    or something stored locally?
14. Is that cached? If so, where and for how long, and what invalidates it?
15. How is a **trialing** subscription distinguished from a paid one, if at all?

## 6. Downgrades and cancellation

16. The first screenshot shows a **"Downgrade to Free"** button. What does it
    actually call — `appSubscriptionCancel`, or a new `appSubscriptionCreate`
    for a free plan?
17. Does downgrading take effect immediately or at period end?
18. What happens to data or features that exceed the lower plan's limits?

## 7. Testing and review — the part I most need

19. On a **development store**, does the flow work end to end? Can you actually
    approve a subscription there, and does the app then read the new plan
    correctly?
20. Did you ever see the plan page return a **404** on a dev store? (Shopify
    documents this for App Pricing draft apps with mismatched locales — I want
    to know whether the Billing API path avoids it entirely.)
21. **Has Stockladder passed App Store review with this billing implementation?**
    If yes, did the reviewer raise anything about billing? If it is still in
    review or not yet submitted, say so plainly — that changes how much weight
    this carries as precedent.

## 8. Regrets

22. Knowing what you know now, would you use the Billing API again, or switch to
    Shopify App Pricing? Why?
23. What was the most annoying part of the Billing API implementation — the bit
    that took longest or broke in a non-obvious way?
