/**
 * The offer wizard.
 *
 * Six steps, with the current one in the URL so a merchant can reload or link
 * to where they were. The draft autosaves to D1; nothing reaches a storefront
 * until Publish, which is Task 45.
 *
 * The loader does the minimum the CPU budget allows — one authenticated read —
 * and everything after that is client state saved over fetch.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LoaderFunctionArgs } from 'react-router';
import { useLoaderData, useRevalidator, useSearchParams } from 'react-router';

import { getOffer, getShop } from '../db.server';
import { authenticatedFetch } from '../lib/authenticated-fetch';
import {
  blockingIssues,
  planCaps,
  STEPS,
  validateDraft,
  type Issue,
  type OfferDraft,
  type WizardStep,
} from '../lib/offer-draft';
import { OfferPreview } from '../components/OfferPreview';
import { StepDesign } from '../components/steps/StepDesign';
import { StepGifts } from '../components/steps/StepGifts';
import { StepPlacement } from '../components/steps/StepPlacement';
import { StepReview } from '../components/steps/StepReview';
import { StepTiers } from '../components/steps/StepTiers';
import { StepTrigger } from '../components/steps/StepTrigger';

export const loader = async ({ request, params, context }: LoaderFunctionArgs) => {
  const { session } = await context.shopify.authenticate.admin(request);
  const record = await getOffer(context.env.DB, session.shop, params.id!);

  if (record === null) {
    throw new Response('Offer not found', { status: 404 });
  }

  const shop = await getShop(context.env.DB, session.shop);
  return {
    offer: record.config as OfferDraft,
    status: record.status,
    plan: shop?.plan ?? 'free',
  };
};

const STEP_LABELS: Record<WizardStep, string> = {
  trigger: 'Trigger',
  tiers: 'Tiers',
  gifts: 'Gifts',
  design: 'Design',
  placement: 'Placement',
  review: 'Review',
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface PublishResult {
  ok: boolean;
  version?: string;
  errors?: string[];
  warnings?: string[];
  /** Gifts dropped because Shopify no longer knows the variant. */
  droppedVariants?: string[];
}

export default function OfferWizard() {
  const { offer, status, plan } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const revalidator = useRevalidator();
  const [draft, setDraft] = useState<OfferDraft>(offer);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const stepParam = params.get('step') as WizardStep | null;
  const step: WizardStep = stepParam && STEPS.includes(stepParam) ? stepParam : 'trigger';
  const stepIndex = STEPS.indexOf(step);

  const issues = useMemo(() => validateDraft(draft, plan), [draft, plan]);
  const caps = useMemo(() => planCaps(plan), [plan]);

  // Autosave, debounced. A merchant dragging a threshold slider would otherwise
  // issue a write per pixel.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    setSaveState('saving');
    const timer = setTimeout(() => {
      authenticatedFetch(`/app/api/offers/${draft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offer: draft }),
      })
        .then((r) => setSaveState(r.ok ? 'saved' : 'error'))
        .catch(() => setSaveState('error'));
    }, 700);

    return () => clearTimeout(timer);
  }, [draft]);

  const update = useCallback((patch: Partial<OfferDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);

  const publish = async () => {
    setPublishing(true);
    setResult(null);
    try {
      const response = await authenticatedFetch(`/app/api/offers/${draft.id}/publish`, {
        method: 'POST',
      });
      const body = (await response.json()) as PublishResult;
      setResult(body);
      // Reload so the status badge and the offers list reflect what was
      // actually written, rather than what the client hoped would be.
      if (body.ok) revalidator.revalidate();
    } catch {
      setResult({ ok: false, errors: ['Could not reach the server. Check your connection and try again.'] });
    } finally {
      setPublishing(false);
    }
  };

  const goTo = (next: WizardStep) => {
    params.set('step', next);
    setParams(params, { replace: true });
  };

  const stepIssues = issues.filter((i) => i.step === step);
  const blocking = blockingIssues(issues);

  return (
    <s-page heading={draft.name || 'Untitled offer'}>
      <s-stack direction="inline" gap="base" justifyContent="space-between">
        <s-stack direction="inline" gap="small">
          <s-badge tone={status === 'PUBLISHED' ? 'success' : undefined}>{status}</s-badge>
          <SaveBadge state={saveState} />
        </s-stack>
      </s-stack>

      <StepNav step={step} issues={issues} onGo={goTo} />

      <s-grid gridTemplateColumns="2fr 1fr" gap="base">
        <s-grid-item>
          <s-section heading={STEP_LABELS[step]}>
            <IssueList issues={stepIssues} />

            {step === 'trigger' && <StepTrigger draft={draft} update={update} />}
            {step === 'tiers' && <StepTiers draft={draft} update={update} caps={caps} />}
            {step === 'gifts' && <StepGifts draft={draft} update={update} />}
            {step === 'design' && <StepDesign draft={draft} update={update} />}
            {step === 'placement' && <StepPlacement draft={draft} update={update} />}
            {step === 'review' && <StepReview draft={draft} issues={issues} />}
            {step === 'review' && <PublishOutcome result={result} />}

            <s-divider />

            <s-stack direction="inline" gap="base">
              {stepIndex > 0 && (
                <s-button onClick={() => goTo(STEPS[stepIndex - 1])} variant="secondary">
                  Back
                </s-button>
              )}
              {stepIndex < STEPS.length - 1 && (
                <s-button onClick={() => goTo(STEPS[stepIndex + 1])} variant="primary">
                  Next
                </s-button>
              )}
              {step === 'review' && (
                <s-button
                  variant="primary"
                  disabled={blocking.length > 0 || publishing || undefined}
                  loading={publishing || undefined}
                  onClick={publish}
                >
                  Publish
                </s-button>
              )}
            </s-stack>
          </s-section>
        </s-grid-item>

        <s-grid-item>
          <OfferPreview draft={draft} />
        </s-grid-item>
      </s-grid>
    </s-page>
  );
}

/**
 * What publishing did.
 *
 * Shown rather than swallowed: a merchant who clicks Publish and sees nothing
 * cannot tell a validation failure from an outage, and will click again.
 */
function PublishOutcome({ result }: { result: PublishResult | null }) {
  if (result === null) return null;

  if (result.ok) {
    return (
      <s-stack gap="small">
        <s-banner tone="success" heading="Published">
          {`This offer is live on your storefront. Version ${result.version ?? ''}.`}
        </s-banner>
        {(result.droppedVariants ?? []).length > 0 && (
          <s-banner tone="warning">
            {`${result.droppedVariants!.length} gift product no longer exists in your catalogue and was removed from this offer.`}
          </s-banner>
        )}
        {(result.warnings ?? []).map((warning, i) => (
          <s-banner key={i} tone="warning">
            {warning}
          </s-banner>
        ))}
      </s-stack>
    );
  }

  return (
    <s-banner tone="critical" heading="Not published">
      <s-unordered-list>
        {(result.errors ?? ['Publishing failed.']).map((error, i) => (
          <s-list-item key={i}>{error}</s-list-item>
        ))}
      </s-unordered-list>
    </s-banner>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  if (state === 'saving') return <s-badge>Saving…</s-badge>;
  if (state === 'saved') return <s-badge tone="success">Saved</s-badge>;
  return <s-badge tone="critical">Not saved</s-badge>;
}

/**
 * The step rail.
 *
 * Every step stays reachable even while earlier ones are invalid. A wizard that
 * locks you out of step 4 until step 2 is perfect stops a merchant answering
 * "what will this even look like?", which is the question they are actually
 * trying to resolve.
 */
function StepNav({
  step,
  issues,
  onGo,
}: {
  step: WizardStep;
  issues: Issue[];
  onGo: (s: WizardStep) => void;
}) {
  return (
    <s-section>
      <s-stack direction="inline" gap="small">
        {STEPS.map((s, i) => {
          const problems = issues.filter((issue) => issue.step === s && issue.blocking).length;
          return (
            <s-button
              key={s}
              variant={s === step ? 'primary' : 'tertiary'}
              onClick={() => onGo(s)}
            >
              {`${i + 1}. ${STEP_LABELS[s]}${problems > 0 ? ` (${problems})` : ''}`}
            </s-button>
          );
        })}
      </s-stack>
    </s-section>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null;

  return (
    <s-stack gap="small">
      {issues.map((issue, i) => (
        <s-banner key={i} tone={issue.blocking ? 'critical' : 'warning'}>
          {issue.message}
        </s-banner>
      ))}
    </s-stack>
  );
}
