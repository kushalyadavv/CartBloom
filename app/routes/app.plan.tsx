/**
 * Plans.
 *
 * Deliberately not a billing UI. Shopify hosts the plan picker, handles the
 * charge, and is the only place a merchant can be certain what they are
 * agreeing to — so this states what each plan gives and hands off. Task 47
 * still has to read the live subscription; until then the plan comes from D1
 * and defaults to free.
 */

import type { LoaderFunctionArgs } from 'react-router';
import { useLoaderData } from 'react-router';

import { listOffers } from '../db.server';
import { planFromHandle, refreshPlan, resolvePlan } from '../lib/plan.server';
import { PLAN_CAPS, planCaps, type PlanName } from '../lib/offer-draft';

const STORE_KIND_QUERY = `#graphql
  query CartBloomStoreKind {
    shop { plan { partnerDevelopment } }
  }`;

/**
 * Whether this is a development store.
 *
 * Only used to explain a documented 404 that affects draft apps on dev stores.
 * Failure is not worth surfacing — a missing banner is a smaller problem than
 * an error page — so any problem here reads as "not a dev store".
 */
async function isDevelopmentStore(
  admin: Awaited<ReturnType<AdminAuthenticate>>['admin']
): Promise<boolean> {
  try {
    const response = await admin.graphql(STORE_KIND_QUERY);
    const body = (await response.json()) as {
      data?: { shop?: { plan?: { partnerDevelopment?: boolean } } };
    };
    return body.data?.shop?.plan?.partnerDevelopment === true;
  } catch {
    return false;
  }
}

type AdminAuthenticate = (request: Request) => Promise<{ admin: { graphql: (q: string) => Promise<Response> } }>;

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { session, admin } = await context.shopify.authenticate.admin(request);

  // Shopify sends the merchant back here after they change plan, with
  // plan_handle set. Inside the cache TTL they would otherwise be looking at
  // their old limits and conclude the upgrade failed, so that return bypasses
  // the cache.
  const planHandle = new URL(request.url).searchParams.get('plan_handle');
  const returning = planHandle !== null;

  const [plan, offers] = await Promise.all([
    returning
      ? // The handle names the plan the merchant just took, so the refresh can
        // wait for Shopify's own read to agree rather than trusting the first
        // answer it gets.
        refreshPlan(admin, context.env.DB, session.shop, planFromHandle(planHandle))
      : resolvePlan(admin, context.env.DB, session.shop),
    listOffers(context.env.DB, session.shop),
  ]);

  const live = offers.filter((o) => o.status === 'PUBLISHED').length;

  return {
    plan,
    caps: planCaps(plan),
    liveOffers: live,
    justChanged: returning,
    /*
     * Grandfathering, made visible.
     *
     * A downgrade never stops a running offer — silently breaking a live
     * storefront promotion earns a one-star review that never comes off. So
     * more offers can be live than the plan allows, and the merchant is told
     * rather than corrected.
     */
    overCap: live > planCaps(plan).activeOffers,
    /*
     * The store handle, for the plan page URL.
     */
    handle: session.shop.replace('.myshopify.com', ''),
    /*
     * Development stores hit a documented 404 on the plan page while the app is
     * still a draft. Detected from the plan itself: a store on a paid plan is
     * not a dev store, and this only gates a piece of explanatory copy, so a
     * wrong guess costs a banner rather than a behaviour.
     */
    isDevStore: await isDevelopmentStore(admin),
    /*
     * No default. An app handle that is merely plausible is worse than none:
     * `cartbloom` belongs to a different published app, so guessing it sent
     * merchants to a stranger's pricing page and a 404. When it is unset the
     * page says so instead of linking somewhere wrong.
     */
    appHandle: context.env.SHOPIFY_APP_HANDLE ?? null,
  };
};

const PRICES: Record<PlanName, string> = {
  free: 'Free',
  growth: '$6.99 / month',
  pro: '$14.99 / month',
};

/**
 * Set as "Trial days" on the plan itself in the Partner Dashboard — this is
 * display copy only, not something the app enforces. A merchant who has
 * approved a trial subscription reads as ACTIVE from day one, identical to one
 * being billed, so the caps already apply for the whole trial with nothing
 * else to configure here.
 */
const TRIALS: Record<PlanName, string> = {
  // Free is not a subscription, so it has no trial — but it still gets a line
  // here. Omitting it shortens the card and the three stop aligning, which
  // reads as a rendering bug rather than as a meaningful difference.
  free: 'Free forever',
  growth: '7-day free trial',
  pro: '7-day free trial',
};

/** The plan most merchants should land on, called out rather than left to chance. */
const RECOMMENDED: PlanName = 'growth';

/** Cheapest first, so the ladder reads left to right. */
const ORDER: PlanName[] = ['free', 'growth', 'pro'];

const LABELS: Record<PlanName, string> = {
  free: 'Free',
  growth: 'Growth',
  pro: 'Pro',
};

export default function Plan() {
  const { plan, caps, liveOffers, handle, appHandle, justChanged, overCap, isDevStore } =
    useLoaderData<typeof loader>();

  // Shopify's own plan page. Building our own would mean handling charges,
  // proration and cancellation, all of which Shopify already does correctly.
  /*
   * A direct link, opened in the top frame.
   *
   * Routing this through a server-side redirect looked more correct and was
   * worse: App Bridge turns an in-app link into a client-side navigation, so
   * the loader ran as a data request, and the library answers a '_top' redirect
   * on a data request with a 401 for App Bridge to act on. React Router has no
   * idea what to do with that and rendered "401 Unauthorized" inside the frame.
   *
   * `target="_top"` on the real URL asks the browser to navigate the whole
   * admin page, which is what the plan page needs and what the docs require.
   * No round trip, nothing to authenticate, nothing to misinterpret.
   */
  const pricingUrl =
    appHandle === null
      ? null
      : `https://admin.shopify.com/store/${handle}/charges/${appHandle}/pricing_plans`;

  return (
    <s-page heading="Plan">
      {pricingUrl === null && (
        <s-section>
          <s-banner tone="critical" heading="Plan changes are unavailable">
            CartBloom is missing its app handle, so it cannot link to your plan page. This is a
            configuration problem on our side, not something you can fix — please contact support.
          </s-banner>
        </s-section>
      )}

      {/*
        A documented Shopify limitation, surfaced rather than left to look like
        our bug: a draft app's plan page 404s on a development store when the
        store and the listing are set to different locales. It does not affect
        published apps or production stores, so this only ever shows on a dev
        store and disappears the moment the app is approved.
      */}
      {isDevStore && (
        <s-section>
          <s-banner tone="info" heading="Testing on a development store">
            While CartBloom is still in review, this page can return a 404 on a development store
            if the store and the app listing use different locales. It is a known Shopify
            limitation and does not affect merchants on published apps.
          </s-banner>
        </s-section>
      )}

      {justChanged && (
        <s-section>
          <s-banner tone="success">{`You are now on ${LABELS[plan]}.`}</s-banner>
        </s-section>
      )}

      {overCap && (
        <s-section>
          <s-banner tone="warning" heading="More offers are live than your plan allows">
            {`Your ${liveOffers} live offers keep running — nothing on your storefront has changed. You will not be able to publish or edit an offer until you pause enough to be within ${caps.activeOffers}, or move to a larger plan.`}
          </s-banner>
        </s-section>
      )}

      <s-section>
        <s-stack direction="inline" gap="base" justifyContent="space-between" alignItems="center">
          <s-stack gap="none">
            <s-heading>{`You are on ${LABELS[plan]}`}</s-heading>
            <s-text tone="neutral">
              {`${liveOffers} of ${caps.activeOffers} live ${caps.activeOffers === 1 ? 'offer' : 'offers'} used · up to ${caps.tiersPerOffer} tiers per offer`}
            </s-text>
          </s-stack>
          {pricingUrl !== null && (
            <s-link href={pricingUrl} target="_top">
              <s-button variant="primary">Change plan</s-button>
            </s-link>
          )}
        </s-stack>
      </s-section>

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap="base">
        {ORDER.map((name) => {
          const current = name === plan;
          const planCaps = PLAN_CAPS[name];
          const recommended = name === RECOMMENDED && !current;

          return (
            <s-grid-item key={name}>
              {/*
                Every card is the same shape: badge row, name, price, trial,
                four features, one action. Only the emphasis changes. The
                previous version omitted lines that did not apply, so the three
                cards ended at different heights and the buttons did not line
                up.
              */}
              <s-box
                padding="large"
                borderWidth={current || recommended ? 'large' : 'base'}
                borderRadius="large"
                background={current ? 'subdued' : undefined}
              >
                <s-stack gap="large">
                  <s-stack gap="small">
                    {/* Reserved even when empty, so the name sits on the same
                        line across all three cards. */}
                    <s-box minBlockSize="24px">
                      {current && <s-badge tone="success">Current plan</s-badge>}
                      {recommended && <s-badge tone="info">Recommended</s-badge>}
                    </s-box>

                    <s-heading>{LABELS[name]}</s-heading>

                    <s-stack gap="none">
                      <s-text
                        {...(name === 'free' ? {} : { tone: 'neutral' as const })}
                      >
                        {PRICES[name]}
                      </s-text>
                      <s-text tone={name === 'free' ? 'neutral' : 'success'}>
                        {TRIALS[name]}
                      </s-text>
                    </s-stack>
                  </s-stack>

                  <s-divider />

                  <s-unordered-list>
                    <s-list-item>
                      {`${planCaps.activeOffers} live ${planCaps.activeOffers === 1 ? 'offer' : 'offers'}`}
                    </s-list-item>
                    <s-list-item>{`${planCaps.tiersPerOffer} tiers per offer`}</s-list-item>
                    <s-list-item>Unlimited drafts</s-list-item>
                    <s-list-item>Every design and gift feature</s-list-item>
                  </s-unordered-list>

                  {/* Every plan gets an action in the same position. A card you
                      cannot act on is a price list, and the merchant would have
                      to go back up the page to find the button. */}
                  {current ? (
                    <s-button disabled>Your current plan</s-button>
                  ) : pricingUrl === null ? (
                    <s-button disabled>{`Choose ${LABELS[name]}`}</s-button>
                  ) : (
                    <s-link href={pricingUrl} target="_top">
                      <s-button variant={recommended ? 'primary' : 'secondary'}>
                        {`Choose ${LABELS[name]}`}
                      </s-button>
                    </s-link>
                  )}
                </s-stack>
              </s-box>
            </s-grid-item>
          );
        })}
      </s-grid>

      <s-section heading="If you downgrade">
        <s-paragraph>
          Offers already running keep running. You will not be able to publish or edit past the
          new plan&apos;s limits until you pause one — nothing on your storefront breaks on its
          own.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
