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

import { getShop, listOffers } from '../db.server';
import { PLAN_CAPS, planCaps, type PlanName } from '../lib/offer-draft';

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { session } = await context.shopify.authenticate.admin(request);
  const [shop, offers] = await Promise.all([
    getShop(context.env.DB, session.shop),
    listOffers(context.env.DB, session.shop),
  ]);

  const plan = (shop?.plan ?? 'free') as PlanName;
  return {
    plan,
    caps: planCaps(plan),
    liveOffers: offers.filter((o) => o.status === 'PUBLISHED').length,
    // The store handle, for the hosted pricing page.
    handle: session.shop.replace('.myshopify.com', ''),
  };
};

const PRICES: Record<PlanName, string> = {
  free: 'Free',
  growth: '$9.99 / month',
  pro: '$19.99 / month',
};

const LABELS: Record<PlanName, string> = {
  free: 'Free',
  growth: 'Growth',
  pro: 'Pro',
};

export default function Plan() {
  const { plan, caps, liveOffers, handle } = useLoaderData<typeof loader>();

  // Shopify's own plan page. Building our own would mean handling charges,
  // proration and cancellation, all of which Shopify already does correctly.
  const pricingUrl = `https://admin.shopify.com/store/${handle}/charges/cartbloom/pricing_plans`;

  return (
    <s-page heading="Plan">
      <s-section>
        <s-stack direction="inline" gap="base" justifyContent="space-between">
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

      <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
        {(Object.keys(PLAN_CAPS) as PlanName[]).map((name) => (
          <s-grid-item key={name}>
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack gap="small">
                <s-stack direction="inline" gap="small" justifyContent="space-between">
                  <s-heading>{LABELS[name]}</s-heading>
                  {name === plan && <s-badge tone="success">Current</s-badge>}
                </s-stack>
                <s-text>{PRICES[name]}</s-text>
                <s-unordered-list>
                  <s-list-item>
                    {`${PLAN_CAPS[name].activeOffers} live ${PLAN_CAPS[name].activeOffers === 1 ? 'offer' : 'offers'}`}
                  </s-list-item>
                  <s-list-item>{`${PLAN_CAPS[name].tiersPerOffer} tiers per offer`}</s-list-item>
                  <s-list-item>Unlimited drafts</s-list-item>
                  <s-list-item>Every design and gift feature</s-list-item>
                </s-unordered-list>
              </s-stack>
            </s-box>
          </s-grid-item>
        ))}
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
