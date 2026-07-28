// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MutationQueue,
  addGift,
  removeLine,
  swapGift,
  numericVariantId,
  GIFT_OFFER_PROP,
  GIFT_TIER_PROP,
} from './mutate';

function mockFetch(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function bodyOf(fn: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  return JSON.parse((fn.mock.calls[call][1] as RequestInit).body as string);
}

describe('MutationQueue', () => {
  it('runs operations one at a time, in order', async () => {
    const queue = new MutationQueue();
    const order: string[] = [];
    const slow = (label: string, ms: number) => () =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          order.push(label);
          resolve();
        }, ms)
      );

    // First is slower; without serialisation "b" would finish first.
    const a = queue.run(slow('a', 30));
    const b = queue.run(slow('b', 1));
    await Promise.all([a, b]);

    expect(order).toEqual(['a', 'b']);
  });

  it('keeps running after a failure — one blip must not wedge the widget', async () => {
    const queue = new MutationQueue();
    await expect(queue.run(() => Promise.reject(new Error('network')))).rejects.toThrow('network');
    await expect(queue.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});

describe('numericVariantId', () => {
  it('strips a GID down to the id the AJAX API wants', () => {
    expect(numericVariantId('gid://shopify/ProductVariant/123')).toBe(123);
  });

  it('accepts a bare id unchanged', () => {
    expect(numericVariantId('123')).toBe(123);
  });
});

describe('addGift', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('tags the line with the claim, underscore-prefixed', async () => {
    const fetchMock = mockFetch();
    await addGift({ variantId: 'gid://shopify/ProductVariant/9', offerId: 'o1', tierId: 't2' });

    const body = bodyOf(fetchMock) as { items: Array<{ id: number; properties: Record<string, string> }> };
    expect(body.items[0].id).toBe(9);
    expect(body.items[0].properties[GIFT_OFFER_PROP]).toBe('o1');
    expect(body.items[0].properties[GIFT_TIER_PROP]).toBe('t2');
  });

  it('always adds exactly one unit — quantity is the function’s to cap', async () => {
    const fetchMock = mockFetch();
    await addGift({ variantId: '9', offerId: 'o1', tierId: 't2' });
    const body = bodyOf(fetchMock) as { items: Array<{ quantity: number }> };
    expect(body.items[0].quantity).toBe(1);
  });

  it('surfaces the reason when Shopify rejects the add', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"description":"out of stock"}', { status: 422 }))
    );
    await expect(addGift({ variantId: '9', offerId: 'o1', tierId: 't2' })).rejects.toThrow(
      /422.*out of stock/
    );
  });

  it('honours theme-provided routes', async () => {
    const fetchMock = mockFetch();
    await addGift({ variantId: '9', offerId: 'o1', tierId: 't2' }, { cartAdd: '/fr/cart/add' });
    expect(fetchMock.mock.calls[0][0]).toBe('/fr/cart/add.js');
  });
});

describe('removeLine', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('sets quantity to zero', async () => {
    const fetchMock = mockFetch();
    await removeLine('key123');
    expect(bodyOf(fetchMock)).toEqual({ id: 'key123', quantity: 0 });
  });
});

describe('swapGift', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('removes before adding, so two claims never coexist', async () => {
    const fetchMock = mockFetch();
    await swapGift('oldkey', { variantId: '9', offerId: 'o1', tierId: 't2' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/cart/change');
    expect(fetchMock.mock.calls[1][0]).toContain('/cart/add');
  });

  it('does not add when the removal fails', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('change')
        ? new Response('nope', { status: 422 })
        : new Response('{}', { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(swapGift('oldkey', { variantId: '9', offerId: 'o1', tierId: 't2' })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
