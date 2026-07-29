/**
 * The live preview, with a cart-value scrubber.
 *
 * Dragging from zero past the top tier turns "did I configure this right?" into
 * a three-second answer instead of a test order — and it is the strongest piece
 * of feature media for the listing.
 *
 * The markup is produced by the real widget renderer, and the stylesheet is the
 * one the theme extension ships, imported as text so the two cannot drift.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import widgetCss from '../../extensions/cartbloom-widget/assets/cartbloom.css?raw';
import { previewDocument, scrubberMax } from '../lib/preview';
import type { OfferDraft } from '../lib/offer-draft';
import { formatMoney } from '../../widget/src/render';

export function OfferPreview({ draft }: { draft: OfferDraft }) {
  const max = useMemo(() => scrubberMax(draft), [draft]);
  const [value, setValue] = useState(() => Math.round(max / 2));
  const frame = useRef<HTMLIFrameElement | null>(null);

  // Keep the scrubber inside its bounds when the tiers change underneath it.
  useEffect(() => {
    setValue((v) => Math.min(v, max));
  }, [max]);

  const doc = useMemo(() => previewDocument(draft, value, widgetCss), [draft, value]);

  // Resize to content rather than guessing: the widget grows by a reward card
  // whenever a tier unlocks, and a fixed height would clip exactly the state a
  // merchant is checking.
  useEffect(() => {
    const el = frame.current;
    if (el === null) return;
    const fit = () => {
      const body = el.contentDocument?.body;
      if (body) el.style.height = `${body.scrollHeight}px`;
    };
    el.addEventListener('load', fit);
    const timer = setTimeout(fit, 50);
    return () => {
      el.removeEventListener('load', fit);
      clearTimeout(timer);
    };
  }, [doc]);

  const label =
    draft.trigger === 'QUANTITY'
      ? `${value} ${value === 1 ? 'item' : 'items'} in cart`
      : `${formatMoney(value)} in cart`;

  return (
    <s-section heading="Preview">
      <s-stack gap="base">
        <iframe
          ref={frame}
          title="Offer preview"
          srcDoc={doc}
          style={{ width: '100%', border: 'none', minHeight: '160px' }}
        />

        <s-stack gap="small">
          <s-text>{label}</s-text>
          {/*
            A native range input: Polaris has no slider component, and this is
            the one control where dragging matters more than styling.
          */}
          <input
            type="range"
            min={0}
            max={max}
            step={draft.trigger === 'QUANTITY' ? 1 : 100}
            value={value}
            aria-label="Cart value"
            onChange={(e) => setValue(Number(e.target.value))}
            style={{ width: '100%' }}
          />
          <s-text tone="neutral">
            Drag to see what a shopper sees as their cart grows.
          </s-text>
        </s-stack>
      </s-stack>
    </s-section>
  );
}
