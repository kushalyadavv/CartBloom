/**
 * The dashboard: every offer as a card, with the controls that matter on it.
 *
 * A list of links made a merchant open an offer to learn whether it was
 * running. Status, and the switch that changes it, belong on the card.
 */

import { useState } from 'react';
import type { LoaderFunctionArgs } from 'react-router';
import { useLoaderData, useNavigate, useRevalidator } from 'react-router';

import { getShop, listOffers } from '../db.server';
import { authenticatedFetch } from '../lib/authenticated-fetch';
import { planCaps, type OfferDraft, type OfferStatus } from '../lib/offer-draft';
import { tierSentences } from '../lib/plain-language';

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { session } = await context.shopify.authenticate.admin(request);
  const [offers, shop] = await Promise.all([
    listOffers(context.env.DB, session.shop),
    getShop(context.env.DB, session.shop),
  ]);

  const plan = shop?.plan ?? 'free';
  return {
    offers: offers.map((o) => {
      const draft = o.config as OfferDraft;
      return {
        id: o.id,
        name: o.name,
        status: o.status,
        updatedAt: o.updatedAt,
        tierCount: draft.tiers?.length ?? 0,
        // One line of what it does, so a card is readable without opening it.
        summary: tierSentences(draft)[0] ?? 'No tiers yet.',
      };
    }),
    plan,
    caps: planCaps(plan),
  };
};

type Offer = Awaited<ReturnType<typeof loader>>['offers'][number];

export default function Dashboard() {
  const { offers, caps } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy('new');
    setError(null);
    try {
      const response = await authenticatedFetch('/app/api/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Untitled offer' }),
      });
      if (!response.ok) throw new Error('Could not create the offer');
      const { offer } = (await response.json()) as { offer: OfferDraft };
      navigate(`/app/offers/${offer.id}?step=trigger`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the offer');
      setBusy(null);
    }
  };

  const setStatus = async (id: string, status: OfferStatus) => {
    setBusy(id);
    setError(null);
    try {
      const response = await authenticatedFetch(`/app/api/offers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const body = (await response.json()) as { errors?: string[] };
      if (!response.ok) throw new Error(body.errors?.[0] ?? 'Could not update the offer');
      revalidator.revalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the offer');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string, name: string) => {
    // Deleting a live offer takes it off a storefront. Worth one question.
    if (!window.confirm(`Delete “${name}”? This cannot be undone.`)) return;
    setBusy(id);
    try {
      await authenticatedFetch(`/app/api/offers/${id}`, { method: 'DELETE' });
      revalidator.revalidate();
    } finally {
      setBusy(null);
    }
  };

  const live = offers.filter((o) => o.status === 'PUBLISHED').length;

  return (
    <s-page heading="Offers">
      <s-section>
        <s-stack direction="inline" gap="base" justifyContent="space-between" alignItems="center">
          <s-stack gap="none">
            <s-heading>
              {offers.length === 0
                ? 'No offers yet'
                : `${live} of ${offers.length} ${offers.length === 1 ? 'offer' : 'offers'} live`}
            </s-heading>
            <s-text tone="neutral">
              Rewards your shoppers unlock as their cart grows.
            </s-text>
          </s-stack>
          <s-button
            variant="primary"
            icon="plus"
            onClick={create}
            loading={busy === 'new' || undefined}
          >
            Create offer
          </s-button>
        </s-stack>
      </s-section>

      {error !== null && (
        <s-section>
          <s-banner tone="critical">{error}</s-banner>
        </s-section>
      )}

      {offers.length === 0 ? (
        <s-section heading="Start here">
          <s-paragraph>
            An offer shows a progress bar in your cart and rewards shoppers as it fills — free
            shipping, a discount, or a gift they choose.
          </s-paragraph>
        </s-section>
      ) : (
        // auto-fill rather than a fixed two columns: a single offer filled half
        // a row and left the other half empty, which read as something missing.
        <s-grid gridTemplateColumns="repeat(auto-fill, minmax(320px, 1fr))" gap="base">
          {offers.map((offer) => (
            <s-grid-item key={offer.id}>
              <OfferCard
                offer={offer}
                busy={busy === offer.id}
                onOpen={() => navigate(`/app/offers/${offer.id}?step=trigger`)}
                onToggle={() =>
                  setStatus(offer.id, offer.status === 'PUBLISHED' ? 'PAUSED' : 'PUBLISHED')
                }
                onDelete={() => remove(offer.id, offer.name)}
              />
            </s-grid-item>
          ))}
        </s-grid>
      )}

      {live >= caps.activeOffers && offers.length > 0 && (
        <s-section>
          <s-banner tone="info">
            {`Your plan runs ${caps.activeOffers} live offer${caps.activeOffers === 1 ? '' : 's'} at a time. Drafts are unlimited.`}
          </s-banner>
        </s-section>
      )}
    </s-page>
  );
}

function OfferCard({
  offer,
  busy,
  onOpen,
  onToggle,
  onDelete,
}: {
  offer: Offer;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const live = offer.status === 'PUBLISHED';
  const paused = offer.status === 'PAUSED';

  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background={live ? 'subdued' : undefined}
    >
      <s-stack gap="base">
        <s-stack direction="inline" gap="small" justifyContent="space-between" alignItems="center">
          <s-badge tone={live ? 'success' : paused ? 'caution' : 'neutral'}>
            {live ? 'Live' : paused ? 'Paused' : 'Draft'}
          </s-badge>
          <s-text tone="neutral">
            {`${offer.tierCount} ${offer.tierCount === 1 ? 'tier' : 'tiers'}`}
          </s-text>
        </s-stack>

        <s-stack gap="none">
          <s-heading>{offer.name}</s-heading>
          {/* One line of what it does. A card nobody can read without opening
              it is only a link with extra steps. */}
          <s-text tone="neutral">{offer.summary}</s-text>
        </s-stack>

        <s-divider />

        <s-stack direction="inline" gap="small" justifyContent="space-between" alignItems="center">
          <s-stack direction="inline" gap="small">
            <s-button icon="edit" onClick={onOpen}>
              Edit
            </s-button>

            {/* A draft has never been published, so there is nothing to pause
                and nothing live to resume. */}
            {offer.status !== 'DRAFT' && (
              <s-button
                icon={live ? 'pause-circle' : 'play'}
                variant={live ? 'secondary' : 'primary'}
                onClick={onToggle}
                loading={busy || undefined}
              >
                {live ? 'Deactivate' : 'Activate'}
              </s-button>
            )}
          </s-stack>

          <s-button
            icon="delete"
            variant="tertiary"
            tone="critical"
            accessibilityLabel={`Delete ${offer.name}`}
            onClick={onDelete}
            loading={busy || undefined}
          />
        </s-stack>
      </s-stack>
    </s-box>
  );
}
