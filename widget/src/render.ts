/**
 * Rendering.
 *
 * Two layout engines, everything else design tokens. `BAR` and `MILESTONE` are
 * the only structural difference; the five presets are token bundles, so a new
 * preset ships as JSON rather than as a release.
 *
 * Deliberately thin. The JavaScript budget is 10 KB compressed and the CSS
 * budget is 100 KB, so visual richness belongs in the stylesheet and this file
 * should do no more than emit semantic markup and set a few custom properties.
 */

import type { OfferEntitlements, Offer, Tier } from '../../app/entitlement';

export type Layout = 'BAR' | 'MILESTONE';

export interface RenderOffer extends Offer {
  design?: { layout?: Layout; preset?: string; tokens?: Record<string, string | number> };
  copy?: { progress?: string; unlocked?: string; locked?: string };
}

export interface RenderInput {
  offer: RenderOffer;
  entitlements: OfferEntitlements;
  moneyFormat?: string;
}

/** Minor units to a display string, using the shop's own money format. */
export function formatMoney(minorUnits: number, moneyFormat?: string): string {
  const amount = (minorUnits / 100).toFixed(2);
  if (moneyFormat === undefined) return `$${amount}`;
  // Shopify money formats use {{amount}} and relatives. Only the common cases
  // are handled; anything unrecognised falls through with the number appended,
  // which is wrong-looking but never blank.
  return moneyFormat
    .replace(/\{\{\s*amount\s*\}\}/g, amount)
    .replace(/\{\{\s*amount_no_decimals\s*\}\}/g, String(Math.round(minorUnits / 100)))
    .replace(/\{\{\s*amount_with_comma_separator\s*\}\}/g, amount.replace('.', ','));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Tiers ascending by threshold — the order they render in. */
function sortedTiers(offer: RenderOffer): Tier[] {
  return [...offer.tiers].sort((a, b) => a.threshold - b.threshold);
}

/**
 * The message above the bar.
 *
 * `{{remaining}}` is substituted with the amount still needed. Once everything
 * is unlocked there is no remaining amount, so the unlocked copy is used
 * instead — a bar that says "spend $0.00 more" reads as broken.
 */
export function progressMessage(input: RenderInput): string {
  const { offer, entitlements, moneyFormat } = input;
  const tiers = sortedTiers(offer);
  const next = tiers.find((t) => !entitlements.unlockedTierIds.includes(t.id));

  if (next === undefined) {
    return offer.copy?.unlocked ?? 'All rewards unlocked';
  }

  const remaining = Math.max(0, next.threshold - entitlements.measure);
  const amount =
    offer.trigger === 'QUANTITY'
      ? `${remaining} ${remaining === 1 ? 'item' : 'items'}`
      : formatMoney(remaining, moneyFormat);

  const template =
    entitlements.unlockedTierIds.length > 0
      ? (offer.copy?.progress ?? 'Just {{remaining}} away from your next reward!')
      : (offer.copy?.locked ?? 'Spend {{remaining}} more to unlock a reward');

  return template.replace(/\{\{\s*remaining\s*\}\}/g, amount);
}

/** Fraction of the way to the top tier, clamped to 0..1. */
export function progressFraction(input: RenderInput): number {
  const tiers = sortedTiers(input.offer);
  const top = tiers[tiers.length - 1];
  if (top === undefined || top.threshold <= 0) return 1;
  return Math.min(1, Math.max(0, input.entitlements.measure / top.threshold));
}

function tierLabel(tier: Tier, moneyFormat: string | undefined, trigger: Offer['trigger']): string {
  return trigger === 'QUANTITY'
    ? `${tier.threshold}`
    : formatMoney(tier.threshold, moneyFormat);
}

function tierCaption(tier: Tier): string {
  switch (tier.reward) {
    case 'FREE_SHIPPING':
      return 'Free shipping';
    case 'ORDER_PERCENT':
      return `${tier.value ?? 0}% off`;
    case 'ORDER_FIXED':
      return 'Order discount';
    case 'GIFT':
      return tier.giftPool.length > 1 ? 'Pick a gift' : 'Free gift';
  }
}

/**
 * The widget's markup.
 *
 * Positions are expressed as custom properties rather than baked into class
 * names so the stylesheet owns all presentation. `aria-valuenow` uses the
 * percentage rather than the raw measure, because a screen reader announcing
 * "12000 of 15000" is meaningless without the currency.
 */
export function renderOffer(input: RenderInput): string {
  const { offer, entitlements, moneyFormat } = input;
  const layout = offer.design?.layout ?? 'BAR';
  const preset = offer.design?.preset ?? 'candy';
  const tiers = sortedTiers(offer);
  const fraction = progressFraction(input);
  const percent = Math.round(fraction * 100);
  const top = tiers[tiers.length - 1];

  const nodes = tiers
    .map((tier) => {
      const unlocked = entitlements.unlockedTierIds.includes(tier.id);
      const at = top !== undefined && top.threshold > 0 ? tier.threshold / top.threshold : 1;
      return (
        `<li class="cb-tier${unlocked ? ' is-unlocked' : ''}" style="--cb-at:${(at * 100).toFixed(2)}%">` +
        `<span class="cb-tier__dot" aria-hidden="true"></span>` +
        `<span class="cb-tier__label">${escapeHtml(tierLabel(tier, moneyFormat, offer.trigger))}</span>` +
        `<span class="cb-tier__caption">${escapeHtml(tierCaption(tier))}</span>` +
        `</li>`
      );
    })
    .join('');

  return (
    `<div class="cb" data-layout="${layout.toLowerCase()}" data-preset="${escapeHtml(preset)}" style="--cb-progress:${percent}%">` +
    `<p class="cb__message">${escapeHtml(progressMessage(input))}</p>` +
    `<div class="cb__track" role="progressbar" aria-valuemin="0" aria-valuemax="100"` +
    ` aria-valuenow="${percent}" aria-label="Rewards progress">` +
    `<span class="cb__fill"></span>` +
    `</div>` +
    `<ol class="cb__tiers">${nodes}</ol>` +
    `</div>`
  );
}

/**
 * Display data for a gift, embedded at publish time.
 *
 * Resolved by the admin app rather than fetched here: a per-variant request on
 * every cart render would add latency to the drawer for data that changes
 * rarely. The trade is that a renamed or re-priced product reads stale until
 * the merchant republishes.
 */
export interface GiftDisplay {
  variantId: string;
  title?: string;
  image?: string;
  price?: number;
}

/**
 * The gift chooser.
 *
 * Real `<button>` elements, not clickable divs — this is the one interactive
 * part of the widget, and keyboard shoppers have to be able to claim a gift.
 *
 * `display` is optional: when the config predates publish-time resolution, the
 * variant id is shown rather than nothing. An unlabelled chooser is poor, an
 * absent one loses the shopper their gift.
 */
export function renderChooser(
  entitlement: { offerId: string; tierId: string; candidates: Array<{ variantId: string }> },
  selected: string | undefined,
  displays: GiftDisplay[] = [],
  title = 'Pick your gift'
): string {
  const options = entitlement.candidates
    .map((candidate) => {
      const display = displays.find((d) => d.variantId === candidate.variantId);
      const label = display?.title ?? candidate.variantId;
      const isSelected = selected === candidate.variantId;
      const image =
        display?.image === undefined
          ? ''
          : `<img class="cb-opt__img" src="${escapeHtml(display.image)}" alt="" loading="lazy" width="44" height="44">`;

      return (
        `<li class="cb-opt">` +
        `<button type="button" class="cb-opt__btn${isSelected ? ' is-selected' : ''}"` +
        ` data-cb-claim data-cb-offer="${escapeHtml(entitlement.offerId)}"` +
        ` data-cb-tier="${escapeHtml(entitlement.tierId)}"` +
        ` data-cb-variant="${escapeHtml(candidate.variantId)}"` +
        ` aria-pressed="${isSelected}">` +
        image +
        `<span class="cb-opt__title">${escapeHtml(label)}</span>` +
        `</button></li>`
      );
    })
    .join('');

  return (
    `<div class="cb__chooser">` +
    `<p class="cb__chooser-title">${escapeHtml(title)}</p>` +
    `<ul class="cb__opts">${options}</ul>` +
    `</div>`
  );
}

/**
 * Design tokens as inline custom properties.
 *
 * Merchant overrides land here; presets live in the stylesheet. Keys are
 * filtered to a known set so a malformed config cannot inject arbitrary CSS.
 */
const ALLOWED_TOKENS = new Set([
  'fill',
  'track',
  'thickness',
  'radius',
  'message-color',
  'locked-color',
  'unlocked-color',
  'font-weight',
]);

export function tokenStyle(tokens: Record<string, string | number> | undefined): string {
  if (tokens === undefined) return '';
  return Object.entries(tokens)
    .filter(([key]) => ALLOWED_TOKENS.has(key))
    .map(([key, value]) => `--cb-${key}:${String(value).replace(/[;"'<>]/g, '')}`)
    .join(';');
}
