/**
 * The checks that run at publish, on top of the wizard's own validation.
 *
 * Every one of these exists because the failure is silent. An oversized config
 * is delivered to the function as `null` and the offer simply stops working; a
 * scheduled start reports SCHEDULED and does nothing; an out-of-stock gift is
 * discounted happily by the function and cannot be bought by the shopper.
 * None of them produce an error anywhere unless something looks for them here.
 */

import { checkConfigSize, METAFIELD_BYTE_LIMIT } from '../entitlement/config/size';

import type { CompiledPublish } from './compile';
import { blockingIssues, planCaps, validateDraft, type Issue, type OfferDraft } from './offer-draft';

/** Shopify rejects an input-variable list past this many elements. */
export const INPUT_VARIABLE_LIMIT = 100;

export interface PublishCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface PublishContext {
  /** Every offer that will be live after this publish, including this one. */
  activeDrafts: OfferDraft[];
  plan: string | null;
  compiled: CompiledPublish;
  /**
   * Variants the Admin API reported as unbuyable, by GID. Resolved at publish
   * (Task 43); an empty map means the check could not run, not that all is well.
   */
  unbuyableVariants?: Map<string, string>;
}

export function checkPublish(draft: OfferDraft, ctx: PublishContext): PublishCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Everything the wizard already knows about still blocks.
  const draftIssues: Issue[] = validateDraft(draft, ctx.plan);
  for (const issue of blockingIssues(draftIssues)) errors.push(issue.message);
  for (const issue of draftIssues.filter((i) => !i.blocking)) warnings.push(issue.message);

  // ---- config size. The failure this prevents is total and silent.
  const size = checkConfigSize(ctx.compiled.compact);
  if (size.bytes > METAFIELD_BYTE_LIMIT) {
    const over = size.bytes - METAFIELD_BYTE_LIMIT;
    const worst = size.suggestedRemovals.slice(0, 3).join(', ');
    errors.push(
      `The offer configuration is ${size.bytes} bytes, ${over} over Shopify's ${METAFIELD_BYTE_LIMIT}-byte limit. ` +
        (worst === ''
          ? 'Remove some gifts or tiers.'
          : `The largest offers are ${worst} — removing gifts or tiers there frees the most room.`)
    );
  } else if (size.bytes > METAFIELD_BYTE_LIMIT * 0.9) {
    warnings.push(
      `The configuration is using ${Math.round((size.bytes / METAFIELD_BYTE_LIMIT) * 100)}% of the size limit. Adding much more will stop it publishing.`
    );
  }

  // ---- input variable caps
  const { tags, collectionIds } = ctx.compiled.inputVariables;
  if (tags.length > INPUT_VARIABLE_LIMIT) {
    errors.push(
      `Your offers use ${tags.length} customer tags in total — Shopify allows ${INPUT_VARIABLE_LIMIT} across all offers.`
    );
  }
  if (collectionIds.length > INPUT_VARIABLE_LIMIT) {
    errors.push(
      `Your offers use ${collectionIds.length} collections in total — Shopify allows ${INPUT_VARIABLE_LIMIT} across all offers.`
    );
  }

  // ---- plan caps, counted over what will be live afterwards
  const caps = planCaps(ctx.plan);
  const activeCount = ctx.activeDrafts.length;
  if (activeCount > caps.activeOffers) {
    errors.push(
      `Publishing this would leave ${activeCount} offers running, and your plan allows ${caps.activeOffers}. Pause one first, or upgrade.`
    );
  }

  // ---- gifts a shopper cannot actually buy
  if (ctx.unbuyableVariants !== undefined) {
    for (const tier of draft.tiers) {
      for (const entry of tier.giftPool) {
        const reason = ctx.unbuyableVariants.get(entry.variantId);
        if (reason !== undefined) {
          const title =
            draft.giftDisplays.find((d) => d.variantId === entry.variantId)?.title ??
            entry.variantId;
          // A warning, not an error: stock comes back, and blocking a publish
          // over a temporarily out-of-stock gift would be worse than showing
          // one that cannot be claimed today.
          warnings.push(`“${title}” ${reason}, so customers will not be able to claim it.`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
