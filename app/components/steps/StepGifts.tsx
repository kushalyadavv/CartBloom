/**
 * Step 3 — the gifts, and the two claim-policy axes.
 *
 * §6 of the spec is the hardest thing in the product to explain, and the axes
 * are independent: what a customer may take *within* one tier, and what they
 * may keep *across* several. The Review step states the consequence in a
 * sentence; this step names each choice by what it does rather than by its
 * internal value.
 */

import { useCallback, useRef } from 'react';

import type { GiftDiscountType, GiftPoolEntry } from '../../entitlement/types';
import { sortedTiers, type OfferDraft } from '../../lib/offer-draft';
import { useFieldEvents } from '../../lib/use-field-events';

interface Props {
  draft: OfferDraft;
  update: (patch: Partial<OfferDraft>) => void;
}

interface PickedVariant {
  id: string;
  title?: string;
  image?: string;
  price?: number;
}

/** What the App Bridge product picker hands back. */
interface PickedProduct {
  id: string;
  title?: string;
  images?: Array<{ originalSrc?: string; url?: string }>;
  variants?: Array<{
    id: string;
    title?: string;
    price?: string;
    image?: { originalSrc?: string; url?: string };
  }>;
}

/**
 * Opens the admin's own product picker.
 *
 * `type: 'product'`, not `'variant'`. The variant picker lists every variant in
 * the shop flat — "$10", "$25", "$50" with no indication of what they belong
 * to — which is unusable in a catalogue of any size. The product picker groups
 * them under their product and lets a merchant take a whole product or pick
 * variants within it.
 *
 * Variant ids are still what comes back, because that is what the entitlement
 * core and the discount function both work in: a gift is a specific variant,
 * not a product. Selecting a whole product means every one of its variants.
 *
 * App Bridge provides all of this, so there is no CartBloom UI to build and no
 * product data to cache. `read_products` is what makes it work, and it is the
 * only reason that scope is requested.
 */
async function pickVariants(): Promise<PickedVariant[]> {
  const bridge = (window as unknown as {
    shopify?: { resourcePicker?: (o: unknown) => Promise<unknown> };
  }).shopify;

  if (!bridge?.resourcePicker) return [];

  const selection = (await bridge.resourcePicker({
    type: 'product',
    multiple: true,
  })) as PickedProduct[] | undefined;

  if (!selection) return [];

  const picked: PickedVariant[] = [];

  for (const product of selection) {
    const productImage = product.images?.[0]?.originalSrc ?? product.images?.[0]?.url;

    for (const variant of product.variants ?? []) {
      // "Small / Black" alone means nothing in a gift chooser; the product name
      // is what a shopper recognises. Publishing rebuilds this from the Admin
      // API, but the preview needs it now.
      const title =
        variant.title === undefined || variant.title === 'Default Title'
          ? product.title
          : `${product.title} — ${variant.title}`;

      picked.push({
        id: variant.id,
        title,
        // The variant's own image where it has one; the product's otherwise, so
        // a chooser is never a row of blank tiles.
        image: variant.image?.originalSrc ?? variant.image?.url ?? productImage,
        price: variant.price === undefined ? undefined : Math.round(Number(variant.price) * 100),
      });
    }
  }

  return picked;
}

export function StepGifts({ draft, update }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const onField = useCallback(
    ({ name, value }: { name: string; value: string }) => {
      if (name === 'withinTier') {
        update({ claimPolicy: { ...draft.claimPolicy, withinTier: value as 'ALL_IN_POOL' | 'PICK_ONE' } });
        return;
      }

      if (name === 'acrossTiers') {
        const acrossTiers = value as 'STACK' | 'SINGLE';
        update({
          claimPolicy: {
            ...draft.claimPolicy,
            acrossTiers,
            // Default the resolution the moment SINGLE is chosen, so the
            // merchant is never left with a policy that cannot be published
            // and no obvious reason why.
            singleResolution:
              acrossTiers === 'SINGLE' ? (draft.claimPolicy.singleResolution ?? 'HIGHEST') : undefined,
          },
        });
        return;
      }

      if (name === 'singleResolution') {
        update({
          claimPolicy: {
            ...draft.claimPolicy,
            singleResolution: value as 'HIGHEST' | 'PINNED' | 'CUSTOMER_CHOICE',
          },
        });
        return;
      }

      if (name === 'pinnedTierId') {
        update({ claimPolicy: { ...draft.claimPolicy, pinnedTierId: value } });
        return;
      }

      const [field, tierId, variantId] = name.split(':');
      if (tierId === undefined || variantId === undefined) return;

      const patchEntry = (patch: Partial<GiftPoolEntry>) => {
        update({
          tiers: draft.tiers.map((t) =>
            t.id !== tierId
              ? t
              : {
                  ...t,
                  giftPool: t.giftPool.map((e) => (e.variantId === variantId ? { ...e, ...patch } : e)),
                }
          ),
        });
      };

      if (field === 'discountType') patchEntry({ discountType: value as GiftDiscountType, value: 0 });
      if (field === 'giftValue') {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        const entry = draft.tiers
          .find((t) => t.id === tierId)
          ?.giftPool.find((e) => e.variantId === variantId);
        patchEntry({ value: entry?.discountType === 'FIXED' ? Math.round(n * 100) : Math.round(n) });
      }
      if (field === 'maxQty') {
        const n = Number(value);
        if (Number.isFinite(n)) patchEntry({ maxQty: Math.max(1, Math.round(n)) });
      }
    },
    [draft.claimPolicy, draft.tiers, update]
  );

  useFieldEvents(ref, onField);

  const addGifts = async (tierId: string) => {
    const picked = await pickVariants();
    if (picked.length === 0) return;

    const existing = new Set(
      draft.tiers.find((t) => t.id === tierId)?.giftPool.map((e) => e.variantId) ?? []
    );

    const additions: GiftPoolEntry[] = picked
      .filter((p) => !existing.has(p.id))
      .map((p) => ({ variantId: p.id, discountType: 'FREE', value: 0, maxQty: 1 }));

    // Titles and images are kept so the preview shows real products. Publishing
    // re-resolves them rather than trusting this copy, which goes stale if a
    // product is renamed.
    const displays = [
      ...draft.giftDisplays.filter((d) => !picked.some((p) => p.id === d.variantId)),
      ...picked.map((p) => ({ variantId: p.id, title: p.title, image: p.image, price: p.price })),
    ];

    update({
      tiers: draft.tiers.map((t) =>
        t.id === tierId ? { ...t, giftPool: [...t.giftPool, ...additions] } : t
      ),
      giftDisplays: displays,
    });
  };

  const removeGift = (tierId: string, variantId: string) => {
    update({
      tiers: draft.tiers.map((t) =>
        t.id === tierId ? { ...t, giftPool: t.giftPool.filter((e) => e.variantId !== variantId) } : t
      ),
    });
  };

  const giftTiers = sortedTiers(draft).filter((t) => t.reward === 'GIFT');
  const titleOf = (variantId: string) =>
    draft.giftDisplays.find((d) => d.variantId === variantId)?.title ?? variantId;

  if (giftTiers.length === 0) {
    return (
      <s-banner tone="info">
        No tier offers a gift yet. Set a tier&apos;s reward to “A free or discounted gift” on the
        Tiers step.
      </s-banner>
    );
  }

  return (
    <div ref={ref}>
      <s-stack gap="base">
        {giftTiers.map((tier, i) => (
          <s-box key={tier.id} padding="base" borderWidth="base" borderRadius="base">
            <s-stack gap="small">
              <s-heading>{`Tier ${i + 1} — unlocks at ${(tier.threshold / 100).toFixed(2)}`}</s-heading>

              {tier.giftPool.map((entry) => (
                <s-box key={entry.variantId} padding="small">
                  <s-stack gap="small">
                    <s-stack direction="inline" gap="base" justifyContent="space-between">
                      <s-text>{titleOf(entry.variantId)}</s-text>
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        onClick={() => removeGift(tier.id, entry.variantId)}
                      >
                        Remove
                      </s-button>
                    </s-stack>

                    <s-stack direction="inline" gap="small">
                      <s-select
                        name={`discountType:${tier.id}:${entry.variantId}`}
                        label="Price"
                        value={entry.discountType}
                      >
                        <s-option value="FREE">Free</s-option>
                        <s-option value="PERCENT">Percent off</s-option>
                        <s-option value="FIXED">Amount off</s-option>
                      </s-select>

                      {entry.discountType === 'PERCENT' && (
                        <s-number-field
                          name={`giftValue:${tier.id}:${entry.variantId}`}
                          label="Percent"
                          value={String(entry.value)}
                          min={1}
                          max={100}
                        />
                      )}

                      {entry.discountType === 'FIXED' && (
                        <s-money-field
                          name={`giftValue:${tier.id}:${entry.variantId}`}
                          label="Amount off"
                          value={(entry.value / 100).toFixed(2)}
                        />
                      )}

                      <s-number-field
                        name={`maxQty:${tier.id}:${entry.variantId}`}
                        label="Max qty"
                        value={String(entry.maxQty)}
                        min={1}
                      />
                    </s-stack>
                  </s-stack>
                </s-box>
              ))}

              <s-button onClick={() => addGifts(tier.id)}>Add products</s-button>
            </s-stack>
          </s-box>
        ))}

        <s-divider />

        <s-heading>What customers may claim</s-heading>

        <s-select
          name="withinTier"
          label="Within one tier"
          value={draft.claimPolicy.withinTier}
          details="What a customer gets from a single tier's list of products."
        >
          <s-option value="PICK_ONE">They choose one product</s-option>
          <s-option value="ALL_IN_POOL">They get every product in the list</s-option>
        </s-select>

        <s-select
          name="acrossTiers"
          label="Across tiers"
          value={draft.claimPolicy.acrossTiers}
          details="What happens once a customer has unlocked more than one gift tier."
        >
          <s-option value="STACK">They keep a gift from every tier they unlock</s-option>
          <s-option value="SINGLE">They keep only one gift in total</s-option>
        </s-select>

        {draft.claimPolicy.acrossTiers === 'SINGLE' && (
          <s-select
            name="singleResolution"
            label="Which gift do they keep?"
            value={draft.claimPolicy.singleResolution ?? 'HIGHEST'}
          >
            <s-option value="HIGHEST">The most valuable tier they have reached</s-option>
            <s-option value="PINNED">Always one specific tier</s-option>
            <s-option value="CUSTOMER_CHOICE">Let the customer decide</s-option>
          </s-select>
        )}

        {draft.claimPolicy.acrossTiers === 'SINGLE' &&
          draft.claimPolicy.singleResolution === 'PINNED' && (
            <s-select
              name="pinnedTierId"
              label="Which tier?"
              value={draft.claimPolicy.pinnedTierId ?? ''}
            >
              <s-option value="">Choose a tier…</s-option>
              {giftTiers.map((t, i) => (
                <s-option key={t.id} value={t.id}>
                  {`Tier ${i + 1} — ${(t.threshold / 100).toFixed(2)}`}
                </s-option>
              ))}
            </s-select>
          )}
      </s-stack>
    </div>
  );
}
