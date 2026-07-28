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
