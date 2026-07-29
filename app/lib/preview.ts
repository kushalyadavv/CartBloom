/**
 * Builds the preview document from the real widget code.
 *
 * Every string here comes from `widget/src/render.ts` and every entitlement
 * from `app/entitlement/` — the same modules the storefront runs. Nothing in
 * this file reimplements either. If the preview and the storefront ever
 * disagree, a merchant configures against a lie and files bugs nobody can
 * reproduce, so a lookalike would be worse than no preview at all.
 */

import { resolveOffer } from '../entitlement';
import type { Cart } from '../entitlement/types';
import { renderOffer, renderRewardCard, type GiftDisplay } from '../../widget/src/render';

import { sortedTiers, toOffer, type OfferDraft } from './offer-draft';

/**
 * A cart that measures exactly `value` against the offer's trigger.
 *
 * For SUBTOTAL that is one line priced at the value; for QUANTITY it is `value`
 * items. Everything is in scope, because the preview's job is to show the
 * ladder behaving, not to model collection membership.
 */
export function previewCart(draft: OfferDraft, value: number): Cart {
  if (draft.trigger === 'QUANTITY') {
    return {
      lines: [
        {
          id: 'cb-preview',
          quantity: Math.max(0, Math.round(value)),
          unitPrice: 1000,
          variantId: 'gid://shopify/ProductVariant/preview',
          inScope: [draft.id],
        },
      ],
    };
  }

  return {
    lines: [
      {
        id: 'cb-preview',
        quantity: 1,
        unitPrice: Math.max(0, Math.round(value)),
        variantId: 'gid://shopify/ProductVariant/preview',
        inScope: [draft.id],
      },
    ],
  };
}

/**
 * Display data for the chooser, falling back to a readable placeholder.
 *
 * A merchant who has picked products sees their names; one who has not sees
 * "Gift 1" rather than a raw GID, which tells them nothing about whether the
 * layout works.
 */
function displaysFor(draft: OfferDraft): GiftDisplay[] {
  const known = new Map(draft.giftDisplays.map((d) => [d.variantId, d]));
  const out: GiftDisplay[] = [];
  let n = 0;

  for (const tier of draft.tiers) {
    for (const entry of tier.giftPool) {
      n += 1;
      out.push(known.get(entry.variantId) ?? { variantId: entry.variantId, title: `Gift ${n}` });
    }
  }
  return out;
}

/** The widget markup for a draft at a given cart value. */
export function previewMarkup(draft: OfferDraft, value: number, moneyFormat?: string): string {
  const offer = toOffer(draft);
  const entitlements = resolveOffer(previewCart(draft, value), offer);
  const displays = displaysFor(draft);

  const renderable = {
    ...offer,
    design: draft.design,
    copy: draft.copy,
  };

  // Composed exactly as widget/src/index.ts does it, including the carousel
  // wrapper that only appears past one card — a preview that differs here would
  // hide the peeking-edge behaviour that wrapper exists for.
  //
  // Nothing is selected: the preview shows the offer as a shopper first meets
  // it, before any claim.
  const cards = entitlements.gifts
    .filter((g) => g.requiresChoice)
    .map((g) => renderRewardCard(g, undefined, displays));

  const extra =
    cards.length > 1
      ? `<div class="cb-rewards" role="group" aria-label="Available rewards" tabindex="0">${cards.join('')}</div>`
      : cards.join('');

  // renderOffer applies the design tokens itself, so there is nothing to
  // splice here — which is the point: the preview and the storefront now go
  // through one code path instead of two that can drift.
  return renderOffer({ offer: renderable, entitlements, moneyFormat, extra });
}

/**
 * A self-contained document for the preview iframe.
 *
 * An iframe rather than a div: the widget stylesheet is written for a
 * storefront and would otherwise land in the same document as Polaris, where
 * each can restyle the other. Isolation here means what a merchant sees is what
 * a shopper gets.
 */
export function previewDocument(
  draft: OfferDraft,
  value: number,
  css: string,
  moneyFormat?: string
): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<style>',
    'html,body{margin:0;padding:16px;background:transparent;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}',
    css,
    '</style></head><body>',
    previewMarkup(draft, value, moneyFormat),
    '</body></html>',
  ].join('');
}

/**
 * Sensible bounds for the scrubber.
 *
 * Runs from zero to a quarter past the top tier, so a merchant can always drag
 * beyond the last threshold and see the fully-unlocked state — the one that is
 * easiest to get wrong and hardest to reach with a test order.
 */
export function scrubberMax(draft: OfferDraft): number {
  const tiers = sortedTiers(draft);
  const top = tiers[tiers.length - 1];
  if (top === undefined) return draft.trigger === 'QUANTITY' ? 10 : 20000;
  return Math.ceil(top.threshold * 1.25);
}
