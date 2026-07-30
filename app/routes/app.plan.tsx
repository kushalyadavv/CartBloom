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
    handle: session.shop.replace('.myshopify.com', ''),
    appHandle: context.env.SHOPIFY_APP_HANDLE ?? 'cartbloom',
  };
};

const PRICES: Record<PlanName, string> = {
  free: 'Free',
  growth: '$6.99 / month',
  pro: '$14.99 / month',
};

/** Cheapest first, so the ladder reads left to right. */
const ORDER: PlanName[] = ['free', 'growth', 'pro'];

const LABELS: Record<PlanName, string> = {
  free: 'Free',
  growth: 'Growth',
  pro: 'Pro',
};

export default function Plan() {
  const { plan, caps, liveOffers, handle, appHandle, justChanged, overCap } =
    useLoaderData<typeof loader>();

  // Shopify's own plan page. Building our own would mean handling charges,
  // proration and cancellation, all of which Shopify already does correctly.
  const pricingUrl = `https://admin.shopify.com/store/${handle}/charges/${appHandle}/pricing_plans`;

  return (
    <s-page heading="Plan">
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
          <s-link href={pricingUrl} target="_blank">
            <s-button variant="primary">Change plan</s-button>
          </s-link>
        </s-stack>
      </s-section>

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
        {ORDER.map((name) => {
          const current = name === plan;
          const caps = PLAN_CAPS[name];

          return (
            <s-grid-item key={name}>
              {/* The current plan is filled rather than outlined, so which one
                  you are on is answerable at a glance instead of by reading
                  three badges. */}
              <s-box
                padding="large"
                borderWidth={current ? 'large' : 'base'}
                borderRadius="base"
                background={current ? 'subdued' : undefined}
              >
                <s-stack gap="base">
                  <s-stack gap="none">
                    <s-stack
                      direction="inline"
                      gap="small"
                      justifyContent="space-between"
                      alignItems="center"
                    >
                      <s-heading>{LABELS[name]}</s-heading>
                      {current && <s-badge tone="success">Current</s-badge>}
                    </s-stack>
                    <s-text tone="neutral">{PRICES[name]}</s-text>
                  </s-stack>

                  <s-unordered-list>
                    <s-list-item>
                      {`${caps.activeOffers} live ${caps.activeOffers === 1 ? 'offer' : 'offers'}`}
                    </s-list-item>
                    <s-list-item>{`${caps.tiersPerOffer} tiers per offer`}</s-list-item>
                    <s-list-item>Unlimited drafts</s-list-item>
                    <s-list-item>Every design and gift feature</s-list-item>
                  </s-unordered-list>

                  {/* Every plan gets an action. A card you cannot act on is a
                      price list, and the merchant still has to find the button
                      at the top of the page. */}
                  {current ? (
                    <s-button disabled>Your plan</s-button>
                  ) : (
                    <s-link href={pricingUrl} target="_blank">
                      <s-button variant="primary">{`Choose ${LABELS[name]}`}</s-button>
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
