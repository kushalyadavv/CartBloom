/**
 * Step 4 — how it looks.
 *
 * Token names are unprefixed here and gain their `--cb-` prefix in
 * `tokenStyle`, which also drops anything outside its allowlist — a merchant
 * cannot inject arbitrary CSS into their own storefront through this form.
 *
 * Sizes are offered as a short list rather than a free-text CSS length. The
 * values are `em`, so they scale with whatever the theme already sets, and a
 * merchant cannot type something that breaks the declaration it lands in.
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

const COLOUR_TOKENS = [
  { key: 'fill', label: 'Progress fill' },
  { key: 'track', label: 'Track' },
  { key: 'unlocked-color', label: 'Unlocked' },
  { key: 'locked-color', label: 'Locked' },
  { key: 'message-color', label: 'Heading text' },
  { key: 'tier-color', label: 'Milestone labels' },
] as const;

const WEIGHTS = ['400', '500', '600', '700', '800'];

const SIZES = [
  { value: '', label: 'Default' },
  { value: '0.8em', label: 'Small' },
  { value: '0.95em', label: 'Medium' },
  { value: '1.1em', label: 'Large' },
  { value: '1.3em', label: 'Extra large' },
];

const SPACING = [
  { value: '', label: 'None' },
  { value: '8px', label: 'Small' },
  { value: '16px', label: 'Medium' },
  { value: '24px', label: 'Large' },
];

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

  const token = (key: string) => draft.design.tokens[key] ?? '';

  const choice = (
    name: string,
    label: string,
    options: Array<{ value: string; label: string }>
  ) => (
    <s-select name={`token:${name}`} label={label} value={token(name)}>
      {options.map((o) => (
        <s-option key={o.value} value={o.value}>
          {o.label}
        </s-option>
      ))}
    </s-select>
  );

  const weight = (name: string, label: string) =>
    choice(name, label, [
      { value: '', label: 'Default' },
      ...WEIGHTS.map((w) => ({ value: w, label: w })),
    ]);

  return (
    <div ref={ref}>
      <s-stack gap="base">
        <s-select name="layout" label="Layout" value={draft.design.layout}>
          <s-option value="MILESTONE">Milestones — markers on a rail</s-option>
          <s-option value="BAR">Progress bar</s-option>
        </s-select>

        <s-select name="preset" label="Colour preset" value={draft.design.preset}>
          {PRESETS.map((p) => (
            <s-option key={p.value} value={p.value}>
              {p.label}
            </s-option>
          ))}
        </s-select>

        <s-divider />
        <s-heading>Heading</s-heading>
        <s-text tone="neutral">The line above the bar: “Add $25.00 for a free gift”.</s-text>

        <s-text-field
          name="progressCopy"
          label="Wording"
          value={draft.copy.progress ?? ''}
          details="Leave empty for the default. Use {{remaining}} for the amount still needed."
        />

        <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="small">
          <s-grid-item>{choice('message-size', 'Size', SIZES)}</s-grid-item>
          <s-grid-item>{weight('message-weight', 'Weight')}</s-grid-item>
          <s-grid-item>
            {choice('message-align', 'Alignment', [
              { value: '', label: 'Centred' },
              { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' },
            ])}
          </s-grid-item>
        </s-grid>

        <s-divider />
        <s-heading>Milestone labels</s-heading>
        <s-text tone="neutral">
          The reward under each marker — “Free gift”, “Free shipping”. The wording comes from each
          tier&apos;s reward, so it stays in step with the Tiers step.
        </s-text>

        <s-grid gridTemplateColumns="1fr 1fr" gap="small">
          <s-grid-item>{choice('tier-size', 'Size', SIZES)}</s-grid-item>
          <s-grid-item>{weight('tier-weight', 'Weight')}</s-grid-item>
        </s-grid>

        <s-divider />
        <s-heading>Gift card</s-heading>

        <s-grid gridTemplateColumns="1fr 1fr" gap="small">
          <s-grid-item>{choice('reward-title-size', '“Select your gift” size', SIZES)}</s-grid-item>
          <s-grid-item>{weight('reward-title-weight', '“Select your gift” weight')}</s-grid-item>
          <s-grid-item>{choice('reward-status-size', 'Reward text size', SIZES)}</s-grid-item>
          <s-grid-item>{weight('reward-status-weight', 'Reward text weight')}</s-grid-item>
        </s-grid>

        <s-divider />
        <s-heading>Spacing</s-heading>
        <s-text tone="neutral">
          Room around the whole widget, for when your drawer already has padding of its own.
        </s-text>

        <s-grid gridTemplateColumns="1fr 1fr" gap="small">
          <s-grid-item>{choice('pad-x', 'Left and right', SPACING)}</s-grid-item>
          <s-grid-item>{choice('pad-y', 'Top and bottom', SPACING)}</s-grid-item>
        </s-grid>

        <s-divider />
        <s-heading>Colours</s-heading>
        <s-text tone="neutral">Leave a colour empty to keep the preset&apos;s own.</s-text>

        <s-grid gridTemplateColumns="1fr 1fr" gap="small">
          {COLOUR_TOKENS.map((t) => (
            <s-grid-item key={t.key}>
              <s-color-field name={`token:${t.key}`} label={t.label} value={token(t.key)} />
            </s-grid-item>
          ))}
        </s-grid>
      </s-stack>
    </div>
  );
}
