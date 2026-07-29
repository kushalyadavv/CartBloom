/**
 * Step 4 — how it looks.
 *
 * Token names are unprefixed here and gain their `--cb-` prefix in
 * `tokenStyle`, which also drops anything outside its allowlist — a merchant
 * cannot inject arbitrary CSS into their own storefront through this form.
 */

import { useCallback, useRef } from 'react';

import type { Layout, OfferDraft } from '../../lib/offer-draft';
import { useFieldEvents } from '../../lib/use-field-events';

interface Props {
  draft: OfferDraft;
  update: (patch: Partial<OfferDraft>) => void;
}

const PRESETS = [
  { value: 'candy', label: 'Candy — bright and playful' },
  { value: 'mono', label: 'Mono — matches a minimal theme' },
  { value: 'forest', label: 'Forest — deep greens' },
  { value: 'sunset', label: 'Sunset — warm oranges' },
];

/** Only tokens `tokenStyle` will actually honour. */
const TOKENS = [
  { key: 'fill', label: 'Progress fill', type: 'color' },
  { key: 'track', label: 'Track', type: 'color' },
  { key: 'unlocked-color', label: 'Unlocked text', type: 'color' },
  { key: 'locked-color', label: 'Locked text', type: 'color' },
  { key: 'message-color', label: 'Message text', type: 'color' },
] as const;

export function StepDesign({ draft, update }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const onField = useCallback(
    ({ name, value }: { name: string; value: string }) => {
      if (name === 'layout') {
        update({ design: { ...draft.design, layout: value as Layout } });
        return;
      }
      if (name === 'preset') {
        update({ design: { ...draft.design, preset: value } });
        return;
      }
      if (name === 'progressCopy') {
        update({ copy: { ...draft.copy, progress: value || undefined } });
        return;
      }
      if (name === 'unlockedCopy') {
        update({ copy: { ...draft.copy, unlocked: value || undefined } });
        return;
      }

      const [field, key] = name.split(':');
      if (field === 'token' && key !== undefined) {
        const tokens = { ...draft.design.tokens };
        // An empty value removes the override rather than storing "", which
        // would emit `--cb-fill:` and break the declaration it sits in.
        if (value === '') delete tokens[key];
        else tokens[key] = value;
        update({ design: { ...draft.design, tokens } });
      }
    },
    [draft.copy, draft.design, update]
  );

  useFieldEvents(ref, onField);

  return (
    <div ref={ref}>
      <s-stack gap="base">
        <s-select name="layout" label="Layout" value={draft.design.layout}>
          <s-option value="BAR">Progress bar</s-option>
          <s-option value="MILESTONE">Milestones</s-option>
        </s-select>

        <s-select name="preset" label="Colour preset" value={draft.design.preset}>
          {PRESETS.map((p) => (
            <s-option key={p.value} value={p.value}>
              {p.label}
            </s-option>
          ))}
        </s-select>

        <s-divider />
        <s-heading>Fine tuning</s-heading>
        <s-text tone="neutral">Leave a colour empty to keep the preset&apos;s own.</s-text>

        <s-grid gridTemplateColumns="1fr 1fr" gap="small">
          {TOKENS.map((t) => (
            <s-grid-item key={t.key}>
              <s-color-field
                name={`token:${t.key}`}
                label={t.label}
                value={draft.design.tokens[t.key] ?? ''}
              />
            </s-grid-item>
          ))}
        </s-grid>

        <s-divider />
        <s-heading>Wording</s-heading>

        <s-text-field
          name="progressCopy"
          label="While they are still shopping"
          value={draft.copy.progress ?? ''}
          details="Leave empty for the default. Use {{remaining}} for the amount still needed."
        />

        <s-text-field
          name="unlockedCopy"
          label="Once everything is unlocked"
          value={draft.copy.unlocked ?? ''}
          details="Leave empty for the default."
        />
      </s-stack>
    </div>
  );
}
