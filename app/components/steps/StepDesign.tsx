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

/** Must match the `[data-preset]` blocks in the widget stylesheet. */
const PRESETS = [
  { value: 'candy', label: 'Candy — bright and playful' },
  { value: 'levelup', label: 'Level up — greens' },
  { value: 'cool', label: 'Cool — indigo' },
  { value: 'quiet', label: 'Quiet — minimal, no shimmer' },
  { value: 'theme-match', label: 'Match my theme' },
];

const COLOUR_TOKENS = [
  { key: 'fill', label: 'Progress fill & buttons' },
  { key: 'track', label: 'Track' },
  { key: 'unlocked-color', label: 'Unlocked' },
  { key: 'locked-color', label: 'Locked' },
  { key: 'message-color', label: 'Heading text' },
  { key: 'tier-color', label: 'Milestone labels' },
] as const;

const WEIGHTS = ['400', '500', '600', '700', '800'];

/**
 * Sizes a merchant has already seen somewhere, so an empty field is a real
 * default rather than a guess at what the theme does.
 */
const SIZE_PLACEHOLDER: Record<string, number> = {
  'message-size': 15,
  'tier-size': 13,
  'reward-title-size': 14,
  'reward-status-size': 16,
};

const PADDING_SIDES = [
  { key: 'pad-top', label: 'Top' },
  { key: 'pad-right', label: 'Right' },
  { key: 'pad-bottom', label: 'Bottom' },
  { key: 'pad-left', label: 'Left' },
] as const;

/** "14px" to 14. An unset token reads as null, not zero. */
function px(value: string): number | null {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

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
        //
        // Size fields report a bare number, so the unit is added here. Without
        // it the token would be `--cb-message-size:15`, which is invalid and
        // drops the whole declaration.
        const withUnit = key.endsWith('-size') && value !== '' ? `${value}px` : value;
        if (withUnit === '') delete tokens[key];
        else tokens[key] = withUnit;

        // The fill colour also drives the solid accent — the selected tile's
        // border, its tick, the focus ring. Those cannot take a gradient, so
        // they read a separate token; keeping the two in step here means the
        // merchant sets one colour and everything follows.
        if (key === 'fill') {
          if (value === '') delete tokens.accent;
          else tokens.accent = value;
        }

        update({ design: { ...draft.design, tokens } });
      }
    },
    [draft.copy, draft.design, update]
  );

  useFieldEvents(ref, onField);

  const token = (key: string) => draft.design.tokens[key] ?? '';

  const setToken = useCallback(
    (key: string, value: string) => {
      const tokens = { ...draft.design.tokens };
      if (value === '' || value === '0px') delete tokens[key];
      else tokens[key] = value;
      update({ design: { ...draft.design, tokens } });
    },
    [draft.design, update]
  );

  /**
   * A size in pixels.
   *
   * Was a five-item list of `em` values, which meant a merchant matching a
   * theme could get close and never exact. Pixels because that is the unit the
   * rest of a theme editor speaks; the widget scales them against nothing else,
   * so what is typed is what renders.
   */
  const size = (name: string, label: string) => (
    <s-number-field
      name={`token:${name}`}
      label={label}
      value={token(name) === '' ? '' : String(px(token(name)) ?? '')}
      placeholder={String(SIZE_PLACEHOLDER[name] ?? 15)}
      min={8}
      max={48}
      step={1}
      details="px"
    />
  );

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
          <s-grid-item>{size('message-size', 'Size')}</s-grid-item>
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
          <s-grid-item>{size('tier-size', 'Size')}</s-grid-item>
          <s-grid-item>{weight('tier-weight', 'Weight')}</s-grid-item>
        </s-grid>

        <s-divider />
        <s-heading>Gift card</s-heading>

        <s-grid gridTemplateColumns="1fr 1fr" gap="small">
          <s-grid-item>{size('reward-title-size', '“Select your gift” size')}</s-grid-item>
          <s-grid-item>{weight('reward-title-weight', '“Select your gift” weight')}</s-grid-item>
          <s-grid-item>{size('reward-status-size', 'Reward text size')}</s-grid-item>
          <s-grid-item>{weight('reward-status-weight', 'Reward text weight')}</s-grid-item>
        </s-grid>

        <s-divider />
        <s-heading>Spacing</s-heading>
        <s-text tone="neutral">
          Room around the whole widget, for when your drawer already has padding of its own.
        </s-text>

<s-stack gap="small">
          {PADDING_SIDES.map((side) => {
            const current = px(token(side.key)) ?? 0;
            return (
              <s-stack key={side.key} gap="none">
                <s-text>{`${side.label} — ${current}px`}</s-text>
                {/*
                  A native range input: Polaris has no slider, and dragging is
                  the point — spacing is judged against the preview beside it,
                  not typed.
                */}
                <input
                  type="range"
                  min={0}
                  max={48}
                  step={1}
                  value={current}
                  aria-label={`${side.label} spacing in pixels`}
                  onChange={(e) => setToken(side.key, `${e.target.value}px`)}
                  style={{ width: '100%' }}
                />
              </s-stack>
            );
          })}
        </s-stack>

        <s-divider />
        <s-heading>Buttons</s-heading>

        {choice('claim-radius', 'Corner radius', [
          { value: '', label: 'Default' },
          { value: '0px', label: 'Square' },
          { value: '6px', label: 'Slightly rounded' },
          { value: '14px', label: 'Rounded' },
          { value: '999px', label: 'Pill' },
        ])}

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
