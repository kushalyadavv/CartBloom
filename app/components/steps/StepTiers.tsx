/**
 * Step 2 — the ladder.
 *
 * Thresholds are entered in the shop's currency but stored in minor units,
 * because that is what the entitlement core and the discount function both
 * compare against. Doing the conversion at the edge keeps every layer below
 * this one working in one unit.
 */

import { useCallback, useRef } from 'react';

import type { RewardKind, Tier } from '../../entitlement/types';
import { newTier, sortedTiers, type OfferDraft, type PlanCaps } from '../../lib/offer-draft';
import { useFieldEvents } from '../../lib/use-field-events';

interface Props {
  draft: OfferDraft;
  update: (patch: Partial<OfferDraft>) => void;
  caps: PlanCaps;
}

export function StepTiers({ draft, update, caps }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const patchTier = useCallback(
    (id: string, patch: Partial<Tier>) => {
      update({ tiers: draft.tiers.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
    },
    [draft.tiers, update]
  );

  const onField = useCallback(
    ({ name, value }: { name: string; value: string }) => {
      const [field, id] = name.split(':');
      if (id === undefined) return;

      if (field === 'threshold') {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        // Money fields report major units; quantity is already a count.
        patchTier(id, { threshold: draft.trigger === 'QUANTITY' ? Math.round(n) : Math.round(n * 100) });
      }

      if (field === 'reward') {
        patchTier(id, { reward: value as RewardKind });
      }

      if (field === 'value') {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        const tier = draft.tiers.find((t) => t.id === id);
        patchTier(id, { value: tier?.reward === 'ORDER_FIXED' ? Math.round(n * 100) : Math.round(n) });
      }
    },
    [draft.tiers, draft.trigger, patchTier]
  );

  useFieldEvents(ref, onField);

  const addTier = () => {
    const tiers = sortedTiers(draft);
    const top = tiers[tiers.length - 1];
    const next = top === undefined ? 5000 : top.threshold * 2;
    update({ tiers: [...draft.tiers, newTier(next)] });
  };

  const removeTier = (id: string) => {
    const remaining = draft.tiers.filter((t) => t.id !== id);
    // A pinned policy pointing at a deleted tier would publish an offer that
    // grants nothing, so drop the pin with the tier.
    const policy =
      draft.claimPolicy.pinnedTierId === id
        ? { ...draft.claimPolicy, pinnedTierId: undefined }
        : draft.claimPolicy;
    update({ tiers: remaining, claimPolicy: policy });
  };

  const atCap = draft.tiers.length >= caps.tiersPerOffer;

  return (
    <div ref={ref}>
      <s-stack gap="base">
        {sortedTiers(draft).map((tier, i) => (
          <s-box key={tier.id} padding="base" borderWidth="base" borderRadius="base">
            <s-stack gap="small">
              <s-stack direction="inline" gap="base" justifyContent="space-between">
                <s-heading>{`Tier ${i + 1}`}</s-heading>
                {draft.tiers.length > 1 && (
                  <s-button variant="tertiary" tone="critical" onClick={() => removeTier(tier.id)}>
                    Remove
                  </s-button>
                )}
              </s-stack>

              {draft.trigger === 'QUANTITY' ? (
                <s-number-field
                  name={`threshold:${tier.id}`}
                  label="Unlocks at (items)"
                  value={String(tier.threshold)}
                  min={1}
                />
              ) : (
                <s-money-field
                  name={`threshold:${tier.id}`}
                  label="Unlocks at"
                  value={(tier.threshold / 100).toFixed(2)}
                />
              )}

              <s-select name={`reward:${tier.id}`} label="Reward" value={tier.reward}>
                <s-option value="FREE_SHIPPING">Free shipping</s-option>
                <s-option value="ORDER_PERCENT">Percent off the order</s-option>
                <s-option value="ORDER_FIXED">Amount off the order</s-option>
                <s-option value="GIFT">A free or discounted gift</s-option>
              </s-select>

              {tier.reward === 'ORDER_PERCENT' && (
                <s-number-field
                  name={`value:${tier.id}`}
                  label="Percent off"
                  value={String(tier.value ?? 0)}
                  min={1}
                  max={100}
                />
              )}

              {tier.reward === 'ORDER_FIXED' && (
                <s-money-field
                  name={`value:${tier.id}`}
                  label="Amount off"
                  value={((tier.value ?? 0) / 100).toFixed(2)}
                />
              )}

              {tier.reward === 'GIFT' && (
                <s-text tone="neutral">
                  {tier.giftPool.length === 0
                    ? 'No gifts chosen yet — add them on the Gifts step.'
                    : `${tier.giftPool.length} gift${tier.giftPool.length === 1 ? '' : 's'} in this tier.`}
                </s-text>
              )}
            </s-stack>
          </s-box>
        ))}

        <s-button onClick={addTier} disabled={atCap || undefined}>
          Add tier
        </s-button>

        {atCap && (
          <s-banner tone="info">
            {`Your plan allows ${caps.tiersPerOffer} tiers per offer. Upgrade to add more.`}
          </s-banner>
        )}
      </s-stack>
    </div>
  );
}
