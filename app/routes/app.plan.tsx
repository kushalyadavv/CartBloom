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
import { refreshPlan, resolvePlan } from '../lib/plan.server';
import { PLAN_CAPS, planCaps, type PlanName } from '../lib/offer-draft';

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { session, admin } = await context.shopify.authenticate.admin(request);

  // Shopify sends the merchant back here after they change plan, with
  // plan_handle set. Inside the cache TTL they would otherwise be looking at
  // their old limits and conclude the upgrade failed, so that return bypasses
  // the cache.
  const returning = new URL(request.url).searchParams.has('plan_handle');

  const [plan, offers] = await Promise.all([
    returning
      ? refreshPlan(admin, context.env.DB, session.shop)
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
  const { plan, caps, liveOffers, appHandle, justChanged, overCap } =
    useLoaderData<typeof loader>();

  // Shopify's own plan page. Building our own would mean handling charges,
  // proration and cancellation, all of which Shopify already does correctly.
  /*
   * Same-origin, on purpose. /app/change-plan redirects with target '_top',
   * which is what escapes the admin iframe — the plan page is outside the
   * app's scope and a plain external link from inside the frame does not
   * reliably get there.
   */
  const pricingUrl = appHandle === null ? null : '/app/change-plan';

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
            <s-link href={pricingUrl}>
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
                    <s-link href={pricingUrl}>
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
