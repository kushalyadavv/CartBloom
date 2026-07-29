/**
 * Offers list — the app's home.
 *
 * The template's demo page and its product-creation mutation are gone: they
 * exercised scopes CartBloom does not request, which is precisely the kind of
 * mismatch review looks for.
 */

import { useState } from 'react';
import type { LoaderFunctionArgs } from 'react-router';
import { useLoaderData, useNavigate } from 'react-router';

import { getShop, listOffers } from '../db.server';
import { authenticatedFetch } from '../lib/authenticated-fetch';
import { planCaps, type OfferDraft } from '../lib/offer-draft';

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { session } = await context.shopify.authenticate.admin(request);
  const [offers, shop] = await Promise.all([
    listOffers(context.env.DB, session.shop),
    getShop(context.env.DB, session.shop),
  ]);

  const plan = shop?.plan ?? 'free';
  return {
    offers: offers.map((o) => ({ id: o.id, name: o.name, status: o.status })),
    plan,
    caps: planCaps(plan),
  };
};

export default function Index() {
  const { offers, caps } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const create = async () => {
    setCreating(true);
    try {
      const response = await authenticatedFetch('/app/api/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Untitled offer' }),
      });
      if (!response.ok) {
        setCreating(false);
        return;
      }
      const { offer } = (await response.json()) as { offer: OfferDraft };
      navigate(`/app/offers/${offer.id}?step=trigger`);
    } catch {
      setCreating(false);
    }
  };

  const active = offers.filter((o) => o.status === 'PUBLISHED').length;

  return (
    <s-page heading="Offers">
      {offers.length === 0 ? (
        <s-section heading="No offers yet">
          <s-stack gap="base">
            <s-paragraph>
              An offer shows a progress bar in your cart and rewards shoppers as it fills.
            </s-paragraph>
            <s-button variant="primary" onClick={create} loading={creating || undefined}>
              Create offer
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section heading="Your offers">
          <s-stack gap="base">
            {offers.map((offer) => (
              <s-box key={offer.id} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="inline" gap="small">
                  <s-link href={`/app/offers/${offer.id}?step=trigger`}>{offer.name}</s-link>
                  <s-badge tone={offer.status === 'PUBLISHED' ? 'success' : undefined}>
                    {offer.status}
                  </s-badge>
                </s-stack>
              </s-box>
            ))}

            <s-button variant="primary" onClick={create} loading={creating || undefined}>
              Create offer
            </s-button>

            {active >= caps.activeOffers && (
              <s-banner tone="info">
                {`Your plan runs ${caps.activeOffers} active offer${caps.activeOffers === 1 ? '' : 's'} at a time. You can keep building drafts, but publishing another needs an upgrade.`}
              </s-banner>
            )}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}
