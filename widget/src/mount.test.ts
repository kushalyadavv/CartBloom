// @vitest-environment jsdom
/**
 * Mounting is where this category of app fails in the wild: not with a crash,
 * but with a merchant seeing nothing and concluding the app is broken.
 *
 * These fixtures are representative of the drawer structures the selector list
 * targets. They are not a substitute for installing on a real theme, but they
 * do catch the regression where a refactor quietly stops matching one of them.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { findDrawerMount, observeForMount, keepMounted } from './mount';

const HORIZON = `
  <cart-drawer-component class="cart-drawer">
    <header class="cart-drawer__header"><h2>Your cart</h2></header>
    <div class="cart-drawer__items"></div>
  </cart-drawer-component>`;

const DAWN = `
  <cart-drawer class="drawer">
    <div class="drawer__inner">
      <div class="drawer__header"><h2>Your cart</h2></div>
      <div class="drawer__contents"></div>
    </div>
  </cart-drawer>`;

const PAID_THEME = `
  <div id="CartDrawer" class="mini-cart">
    <div class="mini-cart__items"></div>
  </div>`;

const NO_DRAWER = `<main><h1>Product</h1></main>`;

function render(html: string): void {
  document.body.innerHTML = html;
}

describe('findDrawerMount', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reports none when the page has no drawer', () => {
    render(NO_DRAWER);
    expect(findDrawerMount()).toEqual({ host: null, reason: 'none' });
  });

  it('mounts into a Horizon-style cart-drawer-component', () => {
    render(HORIZON);
    const { host, reason } = findDrawerMount();
    expect(reason).toBe('standard');
    expect(host?.closest('cart-drawer-component')).not.toBeNull();
  });

  it('mounts into a Dawn-style cart-drawer', () => {
    render(DAWN);
    expect(findDrawerMount().reason).toBe('standard');
  });

  it('falls back to a theme selector when no standard element exists', () => {
    render(PAID_THEME);
    const { host, reason } = findDrawerMount();
    expect(reason).toBe('theme-selector');
    expect(host).not.toBeNull();
  });

  it('places the bar after the header rather than at the end', () => {
    render(HORIZON);
    const host = findDrawerMount().host!;
    expect(host.previousElementSibling?.className).toContain('cart-drawer__header');
  });

  it('prepends when the drawer has no recognisable header', () => {
    render(PAID_THEME);
    const host = findDrawerMount().host!;
    expect(host.previousElementSibling).toBeNull();
  });

  it('prefers a merchant anchor over any drawer heuristic', () => {
    render(`<div data-cartbloom-anchor id="mine"></div>${HORIZON}`);
    const { host, reason } = findDrawerMount();
    expect(reason).toBe('anchor');
    expect(host?.id).toBe('mine');
  });

  it('is idempotent — mounting twice reuses one host', () => {
    render(HORIZON);
    const first = findDrawerMount().host;
    const second = findDrawerMount().host;
    expect(first).toBe(second);
    expect(document.querySelectorAll('[data-cartbloom-host]')).toHaveLength(1);
  });
});

describe('observeForMount', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('fires immediately when the drawer already exists', () => {
    render(HORIZON);
    const onMounted = vi.fn();
    observeForMount(onMounted);
    expect(onMounted).toHaveBeenCalledTimes(1);
  });

  it('waits for a drawer that is built lazily on first open', async () => {
    render(NO_DRAWER);
    const onMounted = vi.fn();
    observeForMount(onMounted);
    expect(onMounted).not.toHaveBeenCalled();

    document.body.insertAdjacentHTML('beforeend', HORIZON);
    await vi.waitFor(() => expect(onMounted).toHaveBeenCalledTimes(1));
  });

  it('stops observing once mounted', async () => {
    render(NO_DRAWER);
    const onMounted = vi.fn();
    observeForMount(onMounted);

    document.body.insertAdjacentHTML('beforeend', HORIZON);
    await vi.waitFor(() => expect(onMounted).toHaveBeenCalledTimes(1));

    document.body.insertAdjacentHTML('beforeend', DAWN);
    await new Promise((r) => setTimeout(r, 20));
    expect(onMounted).toHaveBeenCalledTimes(1);
  });
});

/**
 * Structures taken from the real themes this has been run against, added after
 * each one revealed a placement the fixtures did not cover.
 */
describe('findDrawerMount — real theme structures', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('mounts inside the sliding panel, not the overlay container', () => {
    // cart-drawer is the viewport-covering overlay; .drawer__inner slides.
    // Mounting into the outer element put the bar behind the panel, where it
    // only flashed during the open/close transition.
    render(`
      <cart-drawer class="drawer animate">
        <div class="drawer__overlay"></div>
        <div class="drawer__inner">
          <div class="drawer__header"><h2>Your cart</h2></div>
          <div class="drawer__contents"></div>
        </div>
      </cart-drawer>`);

    const host = findDrawerMount().host!;
    expect(host.closest('.drawer__inner')).not.toBeNull();
    expect(host.closest('.drawer__overlay')).toBeNull();
    expect(host.parentElement).not.toBe(document.querySelector('cart-drawer'));
  });

  it('sits above the line items when no header is recognisable', () => {
    render(`
      <cart-drawer>
        <div class="drawer__inner">
          <cart-items></cart-items>
        </div>
      </cart-drawer>`);

    const host = findDrawerMount().host!;
    expect(host.nextElementSibling?.tagName).toBe('CART-ITEMS');
    expect(host.closest('.drawer__inner')).not.toBeNull();
  });

  it('stays idempotent through the panel path', () => {
    render(`
      <cart-drawer>
        <div class="drawer__inner">
          <div class="drawer__header"></div>
        </div>
      </cart-drawer>`);

    expect(findDrawerMount().host).toBe(findDrawerMount().host);
    expect(document.querySelectorAll('[data-cartbloom-host]')).toHaveLength(1);
  });
});

/**
 * Mounting must survive the theme rebuilding its drawer.
 *
 * A one-shot observer produced three separate reported bugs: the bar missing on
 * an empty cart, missing intermittently, and vanishing permanently once a gift
 * was removed. All were the same cause — the theme re-renders the drawer on
 * every cart change and takes the host with it.
 */
describe('keepMounted — surviving theme re-renders', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('re-mounts after the theme replaces the drawer', async () => {
    render(HORIZON);
    const onMounted = vi.fn();
    const stop = keepMounted(onMounted);
    expect(onMounted).toHaveBeenCalledTimes(1);

    // What a theme does when the cart changes.
    document.body.innerHTML = HORIZON;
    await vi.waitFor(() => expect(onMounted).toHaveBeenCalledTimes(2));

    expect(document.querySelector('[data-cartbloom-host]')).not.toBeNull();
    stop();
  });

  it('mounts when a drawer appears having started empty', async () => {
    render(NO_DRAWER);
    const onMounted = vi.fn();
    const stop = keepMounted(onMounted);
    expect(onMounted).not.toHaveBeenCalled();

    document.body.insertAdjacentHTML('beforeend', HORIZON);
    await vi.waitFor(() => expect(onMounted).toHaveBeenCalledTimes(1));
    stop();
  });

  it('does not re-fire while the host is still attached', async () => {
    render(HORIZON);
    const onMounted = vi.fn();
    const stop = keepMounted(onMounted);

    // Unrelated DOM churn, of the kind a storefront produces constantly.
    document.body.insertAdjacentHTML('beforeend', '<div>noise</div>');
    await new Promise((r) => setTimeout(r, 20));

    expect(onMounted).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops re-mounting once torn down', async () => {
    render(HORIZON);
    const onMounted = vi.fn();
    const stop = keepMounted(onMounted);
    stop();

    document.body.innerHTML = HORIZON;
    await new Promise((r) => setTimeout(r, 20));
    expect(onMounted).toHaveBeenCalledTimes(1);
  });
});

/**
 * Dawn's empty drawer, taken verbatim from a real store. It shares no anchor
 * with the filled state: no header, no contents container, no form.
 */
const DAWN_EMPTY = `
  <cart-drawer class="drawer is-empty animate active">
    <div id="CartDrawer" class="cart-drawer">
      <div id="CartDrawer-Overlay" class="cart-drawer__overlay"></div>
      <div class="drawer__inner" role="dialog">
        <div class="drawer__inner-empty">
          <div class="cart-drawer__warnings center">
            <div class="cart-drawer__empty-content">
              <h2 class="cart__empty-text">Your cart is empty</h2>
              <a href="/collections/all" class="button">Continue shopping</a>
            </div>
          </div>
          <div class="cart-drawer__collection"></div>
        </div>
      </div>
    </div>
  </cart-drawer>`;

describe('findDrawerMount — empty cart', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('mounts above the empty-state region, not after it', () => {
    render(DAWN_EMPTY);
    const host = findDrawerMount().host!;
    expect(host.nextElementSibling?.className).toContain('drawer__inner-empty');
  });

  it('stays inside the sliding panel', () => {
    render(DAWN_EMPTY);
    const host = findDrawerMount().host!;
    expect(host.closest('.drawer__inner')).not.toBeNull();
    expect(host.closest('.cart-drawer__overlay')).toBeNull();
  });

  it('is idempotent across the empty-state path', () => {
    render(DAWN_EMPTY);
    expect(findDrawerMount().host).toBe(findDrawerMount().host);
    expect(document.querySelectorAll('[data-cartbloom-host]')).toHaveLength(1);
  });

  it('re-mounts correctly when the cart goes from empty to filled', async () => {
    render(DAWN_EMPTY);
    const onMounted = vi.fn();
    const stop = keepMounted(onMounted);
    expect(onMounted).toHaveBeenCalledTimes(1);

    // The theme swaps the whole drawer when the first item lands.
    document.body.innerHTML = DAWN;
    await vi.waitFor(() => expect(onMounted).toHaveBeenCalledTimes(2));

    const host = document.querySelector('[data-cartbloom-host]')!;
    expect(host.previousElementSibling?.className).toContain('drawer__header');
    stop();
  });
});

describe('merchant-configured placement', () => {
  beforeEach(() => {
    document.body.innerHTML = HORIZON;
  });

  it('outranks every heuristic when the selector resolves', () => {
    const result = findDrawerMount(document, { selector: '.cart-drawer__items' });

    expect(result.reason).toBe('configured');
    // Placed relative to the named element, not the header the heuristics
    // would otherwise have chosen.
    expect(result.host?.previousElementSibling?.className).toBe('cart-drawer__items');
  });

  it('places above, inside-top and inside-bottom on request', () => {
    const before = findDrawerMount(document, {
      selector: '.cart-drawer__items',
      position: 'before',
    });
    expect(before.host?.nextElementSibling?.className).toBe('cart-drawer__items');

    document.body.innerHTML = HORIZON;
    const prepend = findDrawerMount(document, {
      selector: '.cart-drawer__items',
      position: 'prepend',
    });
    expect(prepend.host?.parentElement?.className).toBe('cart-drawer__items');

    document.body.innerHTML = HORIZON;
    const append = findDrawerMount(document, {
      selector: '.cart-drawer__items',
      position: 'append',
    });
    expect(append.host?.parentElement?.className).toBe('cart-drawer__items');
  });

  it('falls back to automatic placement when the selector matches nothing', () => {
    // A merchant mid-typing in the theme editor must not lose the widget.
    const result = findDrawerMount(document, { selector: '.does-not-exist' });

    expect(result.reason).not.toBe('configured');
    expect(result.host).not.toBeNull();
  });

  it('survives an invalid selector rather than throwing', () => {
    const result = findDrawerMount(document, { selector: ':::not valid:::' });

    expect(result.host).not.toBeNull();
    expect(result.reason).not.toBe('configured');
  });

  it('ignores an empty or whitespace-only selector', () => {
    expect(findDrawerMount(document, { selector: '' }).reason).not.toBe('configured');
    expect(findDrawerMount(document, { selector: '   ' }).reason).not.toBe('configured');
  });

  it('is idempotent — re-mounting does not stack hosts', () => {
    findDrawerMount(document, { selector: '.cart-drawer__items' });
    findDrawerMount(document, { selector: '.cart-drawer__items' });

    expect(document.querySelectorAll('[data-cartbloom-host]')).toHaveLength(1);
  });
});

describe('configured placement over an existing mount', () => {
  beforeEach(() => {
    document.body.innerHTML = HORIZON;
  });

  it('moves a host the heuristics already placed', () => {
    // The widget mounts on first paint, so by the time a merchant saves a
    // placement selector a host usually exists already. Reusing it wherever it
    // sits would make the setting look broken.
    const automatic = findDrawerMount();
    expect(automatic.host).not.toBeNull();
    expect(automatic.reason).not.toBe('configured');

    const configured = findDrawerMount(document, { selector: '.cart-drawer__items' });

    expect(configured.reason).toBe('configured');
    expect(configured.host?.previousElementSibling?.className).toBe('cart-drawer__items');
    // Moved, not duplicated.
    expect(document.querySelectorAll('[data-cartbloom-host]')).toHaveLength(1);
  });

  it('leaves a correctly placed host alone, so focus inside it survives', () => {
    const first = findDrawerMount(document, { selector: '.cart-drawer__items' });
    const button = document.createElement('button');
    first.host?.appendChild(button);
    button.focus();

    findDrawerMount(document, { selector: '.cart-drawer__items' });

    expect(document.activeElement).toBe(button);
  });
});
