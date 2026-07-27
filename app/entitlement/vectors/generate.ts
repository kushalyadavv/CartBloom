import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveOffer } from '../resolve';
import type {
  AcrossTierPolicy, Cart, ClaimPolicy, Offer, OfferEntitlements,
  SingleTierResolution, TriggerMetric, WithinTierPolicy,
} from '../types';

export interface Vector {
  name: string;
  cart: Cart;
  offer: Offer;
  expected: OfferEntitlements;
}

const WITHIN: WithinTierPolicy[] = ['ALL_IN_POOL', 'PICK_ONE'];
const ACROSS: Array<{ acrossTiers: AcrossTierPolicy; singleResolution?: SingleTierResolution }> = [
  { acrossTiers: 'STACK' },
  { acrossTiers: 'SINGLE', singleResolution: 'HIGHEST' },
  { acrossTiers: 'SINGLE', singleResolution: 'PINNED' },
  { acrossTiers: 'SINGLE', singleResolution: 'CUSTOMER_CHOICE' },
];
const TIER_COUNTS = [1, 2, 3, 4, 5, 6];
const TRIGGERS: TriggerMetric[] = ['SUBTOTAL', 'QUANTITY'];

function buildOffer(
  tierCount: number,
  within: WithinTierPolicy,
  across: { acrossTiers: AcrossTierPolicy; singleResolution?: SingleTierResolution },
  trigger: TriggerMetric
): Offer {
  const tiers = Array.from({ length: tierCount }, (_, i) => ({
    id: `t${i + 1}`,
    threshold: trigger === 'QUANTITY' ? (i + 1) * 2 : (i + 1) * 5000,
    reward: (i === 0 ? 'FREE_SHIPPING' : 'GIFT') as Offer['tiers'][number]['reward'],
    giftPool:
      i === 0
        ? []
        : Array.from({ length: (i % 3) + 1 }, (_, g) => ({
            variantId: `v${i}-${g}`,
            discountType: 'FREE' as const,
            value: 0,
            maxQty: (g % 2) + 1,
          })),
  }));

  const claimPolicy: ClaimPolicy = {
    withinTier: within,
    acrossTiers: across.acrossTiers,
    ...(across.singleResolution ? { singleResolution: across.singleResolution } : {}),
    ...(across.singleResolution === 'PINNED' ? { pinnedTierId: 't2' } : {}),
  };

  return { id: 'o1', trigger, claimPolicy, tiers };
}

/** Below, exactly at, and above every threshold, plus zero. */
function measurePoints(offer: Offer): number[] {
  const points = new Set<number>([0]);
  for (const t of offer.tiers) {
    if (t.threshold > 0) points.add(t.threshold - 1);
    points.add(t.threshold);
    points.add(t.threshold + 1);
  }
  return [...points].sort((a, b) => a - b);
}

function buildCart(measure: number, trigger: TriggerMetric, withGift: boolean): Cart {
  const lines: Cart['lines'] = [];
  if (measure > 0) {
    lines.push(
      trigger === 'QUANTITY'
        ? { id: 'l1', quantity: measure, unitPrice: 1000, variantId: 'base', inScope: ['o1'] }
        : { id: 'l1', quantity: 1, unitPrice: measure, variantId: 'base', inScope: ['o1'] }
    );
  }
  if (withGift) {
    lines.push({
      id: 'lg', quantity: 1, unitPrice: 4000, variantId: 'v1-0',
      inScope: ['o1'], giftOfferId: 'o1', giftTierId: 't2',
    });
  }
  return { lines };
}

export function generateVectors(): Vector[] {
  const vectors: Vector[] = [];
  for (const trigger of TRIGGERS) {
    for (const within of WITHIN) {
      for (const across of ACROSS) {
        for (const tierCount of TIER_COUNTS) {
          const offer = buildOffer(tierCount, within, across, trigger);
          for (const measure of measurePoints(offer)) {
            for (const withGift of [false, true]) {
              const cart = buildCart(measure, trigger, withGift);
              const suffix = across.singleResolution ?? across.acrossTiers;
              vectors.push({
                name: `${trigger}/${within}/${suffix}/tiers=${tierCount}/measure=${measure}/gift=${withGift}`,
                cart,
                offer,
                expected: resolveOffer(cart, offer),
              });
            }
          }
        }
      }
    }
  }
  return vectors;
}

if (process.argv[1]?.endsWith('generate.ts')) {
  const vectors = generateVectors();
  writeFileSync(
    join(import.meta.dirname, 'golden.json'),
    JSON.stringify(vectors, null, 2) + '\n'
  );
  console.log(`Wrote ${vectors.length} vectors`);
}
