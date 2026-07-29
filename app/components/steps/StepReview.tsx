/**
 * Step 6 — the offer stated back in plain language.
 *
 * Not a summary of the fields: a description of the consequence. The claim
 * policy is what merchants misconfigure confidently, and "customers keep every
 * gift they unlock" is checkable at a glance in a way that STACK is not.
 */

import {
  audienceSentences,
  claimSentence,
  placementSentence,
  tierSentences,
} from '../../lib/plain-language';
import { blockingIssues, type Issue, type OfferDraft } from '../../lib/offer-draft';

interface Props {
  draft: OfferDraft;
  issues: Issue[];
}

export function StepReview({ draft, issues }: Props) {
  const blocking = blockingIssues(issues);
  const warnings = issues.filter((i) => !i.blocking);
  const claim = claimSentence(draft);
  const audience = audienceSentences(draft);

  return (
    <s-stack gap="base">
      {blocking.length > 0 && (
        <s-banner tone="critical" heading="Fix these before publishing">
          <s-unordered-list>
            {blocking.map((issue, i) => (
              <s-list-item key={i}>{issue.message}</s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      )}

      {warnings.map((issue, i) => (
        <s-banner key={i} tone="warning">
          {issue.message}
        </s-banner>
      ))}

      <s-box padding="base" borderWidth="base" borderRadius="base">
        <s-stack gap="small">
          <s-heading>What customers will see</s-heading>

          <s-unordered-list>
            {tierSentences(draft).map((sentence, i) => (
              <s-list-item key={i}>{sentence}</s-list-item>
            ))}
          </s-unordered-list>

          {claim !== null && <s-paragraph>{claim}</s-paragraph>}

          {audience.length > 0 && (
            <s-unordered-list>
              {audience.map((sentence, i) => (
                <s-list-item key={i}>{sentence}</s-list-item>
              ))}
            </s-unordered-list>
          )}

          <s-paragraph>{placementSentence(draft)}</s-paragraph>
        </s-stack>
      </s-box>

      {blocking.length === 0 && (
        <s-banner tone="info">
          Publishing writes this offer to your storefront and creates the discount that applies
          it. You can roll back to the previous version afterwards.
        </s-banner>
      )}
    </s-stack>
  );
}
