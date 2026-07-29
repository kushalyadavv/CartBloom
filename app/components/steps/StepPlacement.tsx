/**
 * Step 5 — where it appears.
 *
 * Both placements are theme extension blocks the merchant still has to enable
 * in the theme editor, which is the step most likely to be missed: the offer
 * publishes cleanly and then does not appear. So the banner says so here rather
 * than leaving it to support.
 */

import { useCallback, useRef, useState } from 'react';

import type { OfferDraft } from '../../lib/offer-draft';
import { useFieldEvents } from '../../lib/use-field-events';

interface Props {
  draft: OfferDraft;
  update: (patch: Partial<OfferDraft>) => void;
}

/** Honoured by widget/src/mount.ts, which prefers it over every guess. */
const ANCHOR_SNIPPET = '<div data-cartbloom-anchor></div>';

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

  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(ANCHOR_SNIPPET);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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

        <s-divider />
        <s-heading>Put it somewhere specific</s-heading>
        <s-paragraph>
          CartBloom finds the right spot in most themes on its own. If yours puts it in an odd
          place, paste this line into your theme where you want it — CartBloom will use it instead
          of guessing.
        </s-paragraph>

        {/*
          The widget already honours [data-cartbloom-anchor] and prefers it over
          every automatic strategy; this only surfaces it. Themes that build the
          drawer from a section this cannot reach are the reason the automatic
          path exists, and the reason this escape hatch does.
        */}
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack gap="small">
            <code style={{ userSelect: 'all', wordBreak: 'break-all', fontSize: '0.85em' }}>
              {ANCHOR_SNIPPET}
            </code>
            <s-button onClick={copy}>{copied ? 'Copied' : 'Copy'}</s-button>
          </s-stack>
        </s-box>

        <s-paragraph>
          Usual spot: your cart drawer snippet, just below the drawer&apos;s heading. The offer
          still has to be published, and the placement toggles above still apply.
        </s-paragraph>
      </s-stack>
    </div>
  );
}
