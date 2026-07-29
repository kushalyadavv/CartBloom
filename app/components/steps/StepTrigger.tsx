/**
 * Step 1 — what counts, and who for.
 */

import { useCallback, useRef } from 'react';

import type { OfferDraft, ScopeKind } from '../../lib/offer-draft';
import { useFieldEvents } from '../../lib/use-field-events';

interface Props {
  draft: OfferDraft;
  update: (patch: Partial<OfferDraft>) => void;
}

export function StepTrigger({ draft, update }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const onField = useCallback(
    ({ name, value }: { name: string; value: string }) => {
      switch (name) {
        case 'name':
          update({ name: value });
          break;
        case 'trigger':
          update({ trigger: value === 'QUANTITY' ? 'QUANTITY' : 'SUBTOTAL' });
          break;
        case 'scopeKind':
          // Ids from the previous kind are meaningless under the new one —
          // collection GIDs are not product GIDs.
          update({ scope: { kind: value as ScopeKind, ids: [] } });
          break;
        case 'customerTags':
          update({
            audience: {
              ...draft.audience,
              // Free text, split on commas: Shopify exposes no API to
              // enumerate a shop's customer tags, and CartBloom requests no
              // customer scopes to read them with.
              customerTags: value
                .split(',')
                .map((t) => t.trim())
                .filter((t) => t !== ''),
            },
          });
          break;
        case 'countries':
          update({
            audience: {
              ...draft.audience,
              countries: value
                .split(',')
                .map((c) => c.trim().toUpperCase())
                .filter((c) => c !== ''),
            },
          });
          break;
        case 'startsAt':
          update({ audience: { ...draft.audience, startsAt: value || undefined } });
          break;
        case 'endsAt':
          update({ audience: { ...draft.audience, endsAt: value || undefined } });
          break;
      }
    },
    [draft.audience, update]
  );

  useFieldEvents(ref, onField);

  return (
    <div ref={ref}>
      <s-stack gap="base">
        <s-text-field name="name" label="Offer name" value={draft.name} />

        <s-select name="trigger" label="Progress is measured by" value={draft.trigger}>
          <s-option value="SUBTOTAL">Cart subtotal</s-option>
          <s-option value="QUANTITY">Number of items</s-option>
        </s-select>

        <s-select name="scopeKind" label="What counts toward the total" value={draft.scope.kind}>
          <s-option value="ALL">Everything in the cart</s-option>
          <s-option value="COLLECTIONS">Only certain collections</s-option>
          <s-option value="PRODUCTS">Only certain products</s-option>
        </s-select>

        {draft.scope.kind !== 'ALL' && (
          <s-banner tone="info">
            {`${draft.scope.ids.length} selected. Use the picker on the Gifts step to add more.`}
          </s-banner>
        )}

        <s-text-field
          name="customerTags"
          label="Customer tags (optional)"
          value={draft.audience.customerTags.join(', ')}
          details="Comma separated. Leave empty to show the offer to everyone."
        />

        <s-text-field
          name="countries"
          label="Countries (optional)"
          value={draft.audience.countries.join(', ')}
          details="Two-letter codes, comma separated. Leave empty for every market."
        />

        <s-stack direction="inline" gap="base">
          <s-date-field name="startsAt" label="Starts (optional)" value={draft.audience.startsAt ?? ''} />
          <s-date-field name="endsAt" label="Ends (optional)" value={draft.audience.endsAt ?? ''} />
        </s-stack>
      </s-stack>
    </div>
  );
}
