// @vitest-environment jsdom
/**
 * A dialog with aria-modal="true" tells assistive technology the rest of the
 * page is inert. It does not make it so. Without a trap, Tab walks out of the
 * picker into the drawer and the page behind it, leaving a keyboard shopper
 * operating a UI they cannot see behind a backdrop.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderModal } from './render';

const pool = {
  offerId: 'o1',
  tierId: 't2',
  candidates: [{ variantId: 'v1' }, { variantId: 'v2' }],
};

function focusablesIn(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    ),
  ];
}

describe('modal focusables', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('every control in the dialog is reachable by keyboard', () => {
    document.body.innerHTML = renderModal(pool, 'v1', []);
    const layer = document.body.firstElementChild as HTMLElement;
    const labels = focusablesIn(layer).map((el) => el.textContent?.trim());

    // Close, both tiles, claim, decide later.
    expect(focusablesIn(layer).length).toBeGreaterThanOrEqual(5);
    expect(labels.some((l) => l?.includes('Claim'))).toBe(true);
    expect(labels.some((l) => l?.includes('Decide later'))).toBe(true);
  });

  it('excludes the claim button while it is disabled', () => {
    document.body.innerHTML = renderModal(pool, undefined, []);
    const layer = document.body.firstElementChild as HTMLElement;
    const labels = focusablesIn(layer).map((el) => el.textContent?.trim());

    // Nothing is selected, so claiming is not an available action and should
    // not be a tab stop either.
    expect(labels.some((l) => l?.includes('Claim'))).toBe(false);
  });

  it('offers a way out even with no tiles', () => {
    document.body.innerHTML = renderModal({ ...pool, candidates: [] }, undefined, []);
    const layer = document.body.firstElementChild as HTMLElement;
    expect(focusablesIn(layer).length).toBeGreaterThan(0);
  });

  it('is announced as a modal dialog with a name', () => {
    document.body.innerHTML = renderModal(pool, undefined, []);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBeTruthy();
  });
});
