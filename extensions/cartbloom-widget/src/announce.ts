/**
 * What to say out loud when the cart changes.
 *
 * The widget repaints on every cart update. Visually that is fine — a bar
 * grows, a chooser appears. To a screen reader it is nothing at all: replacing
 * markup announces neither the change nor its meaning.
 *
 * So the interesting transitions are computed here and pushed into a live
 * region. Kept pure and separate from the DOM so the rules are testable, and
 * because the rule that matters is about *restraint*: announce a newly unlocked
 * tier, and otherwise stay quiet. A live region that fires on every cart tick
 * is worse than one that never fires — it talks over the shopper while they are
 * trying to do something else.
 */

import type { OfferEntitlements } from '../../../app/entitlement';

export interface AnnouncementInput {
  previous: OfferEntitlements[] | null;
  current: OfferEntitlements[];
  /** Formats a threshold for speech. Injected so this file stays DOM-free. */
  formatAmount?: (minorUnits: number) => string;
}

/**
 * The message for this transition, or null to stay silent.
 *
 * Only newly unlocked tiers are announced. Losing a tier is already covered by
 * the removal notice, which is itself a live region — saying it twice is worse
 * than saying it once.
 */
export function announcement(input: AnnouncementInput): string | null {
  const { previous, current } = input;

  // First paint. The shopper did not just do anything, so announcing the
  // current state would be an interruption with no cause.
  if (previous === null) return null;

  const before = new Set(previous.flatMap((o) => o.unlockedTierIds));
  const newlyUnlocked = current
    .flatMap((o) => o.unlockedTierIds)
    .filter((id) => !before.has(id));

  if (newlyUnlocked.length === 0) return null;

  const giftsNowOffered = current
    .flatMap((o) => o.gifts)
    .filter((g) => newlyUnlocked.includes(g.tierId));

  const needsChoice = giftsNowOffered.some((g) => g.requiresChoice);

  if (needsChoice) {
    return newlyUnlocked.length === 1
      ? 'Reward unlocked. Choose your free gift.'
      : `${newlyUnlocked.length} rewards unlocked. Choose your free gifts.`;
  }

  if (giftsNowOffered.length > 0) {
    return 'Reward unlocked. Your free gift has been added.';
  }

  return newlyUnlocked.length === 1 ? 'Reward unlocked.' : `${newlyUnlocked.length} rewards unlocked.`;
}
