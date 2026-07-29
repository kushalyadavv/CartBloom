/**
 * Step 5 — where it appears.
 *
 * Both placements are theme extension blocks the merchant still has to enable
 * in the theme editor, which is the step most likely to be missed: the offer
 * publishes cleanly and then does not appear. So the banner says so here rather
 * than leaving it to support.
 */

import { useCallback, useRef } from 'react';

import type { OfferDraft } from '../../lib/offer-draft';
import { useFieldEvents } from '../../lib/use-field-events';

interface Props {
  draft: OfferDraft;
  update: (patch: Partial<OfferDraft>) => void;
}

export function StepPlacement({ draft, update }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const onField = useCallback(
    ({ name, checked }: { name: string; checked: boolean }) => {
      if (name === 'drawer') update({ placement: { ...draft.placement, drawer: checked } });
      if (name === 'cartPage') update({ placement: { ...draft.placement, cartPage: checked } });
    },
    [draft.placement, update]
  );

  useFieldEvents(ref, onField);

  return (
    <div ref={ref}>
      <s-stack gap="base">
        <s-switch
          name="drawer"
          label="Cart drawer"
          checked={draft.placement.drawer || undefined}
          details="The slide-out cart most themes open when an item is added."
        />

        <s-switch
          name="cartPage"
          label="Cart page"
          checked={draft.placement.cartPage || undefined}
          details="The full /cart page."
        />

        <s-banner tone="info">
          CartBloom also has to be turned on in your theme. Open the theme editor, then App
          embeds, and enable CartBloom.
        </s-banner>
      </s-stack>
    </div>
  );
}
