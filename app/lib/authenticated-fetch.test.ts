import { afterEach, describe, expect, it, vi } from 'vitest';

import { authenticatedFetch, SessionTokenUnavailableError } from './authenticated-fetch';

function mockBridge(tokens: string[]) {
  let i = 0;
  const idToken = vi.fn(async () => tokens[Math.min(i++, tokens.length - 1)]);
  vi.stubGlobal('window', { shopify: { idToken } });
  return idToken;
}

const authHeader = (call: unknown[]) =>
  new Headers((call[1] as RequestInit).headers).get('Authorization');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('authenticatedFetch', () => {
  it('sends a bearer token minted for that request', async () => {
    mockBridge(['tok-1']);
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await authenticatedFetch('/api/offers');

    expect(authHeader(fetchMock.mock.calls[0])).toBe('Bearer tok-1');
  });

  it('mints a new token per call rather than reusing one', async () => {
    const idToken = mockBridge(['tok-1', 'tok-2']);
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await authenticatedFetch('/api/offers');
    await authenticatedFetch('/api/offers');

    expect(idToken).toHaveBeenCalledTimes(2);
    expect(authHeader(fetchMock.mock.calls[1])).toBe('Bearer tok-2');
  });

  it('retries once with a fresh token on 401', async () => {
    mockBridge(['stale', 'fresh']);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('no', { status: 401 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await authenticatedFetch('/api/offers');

    expect(response.status).toBe(200);
    expect(authHeader(fetchMock.mock.calls[0])).toBe('Bearer stale');
    expect(authHeader(fetchMock.mock.calls[1])).toBe('Bearer fresh');
  });

  it('does not retry more than once, so a persistent 401 cannot spin', async () => {
    mockBridge(['a', 'b', 'c']);
    const fetchMock = vi.fn(async () => new Response('no', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await authenticatedFetch('/api/offers');

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-401 failure', async () => {
    mockBridge(['tok-1']);
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await authenticatedFetch('/api/offers');

    expect(response.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves method and body across the retry', async () => {
    mockBridge(['stale', 'fresh']);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('no', { status: 401 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await authenticatedFetch('/api/offers', {
      method: 'POST',
      body: '{"name":"Spring"}',
      headers: { 'Content-Type': 'application/json' },
    });

    const retry = fetchMock.mock.calls[1][1] as RequestInit;
    expect(retry.method).toBe('POST');
    expect(retry.body).toBe('{"name":"Spring"}');
    expect(new Headers(retry.headers).get('Content-Type')).toBe('application/json');
  });

  it('fails clearly when App Bridge is absent rather than sending an unauthenticated request', async () => {
    vi.stubGlobal('window', {});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(authenticatedFetch('/api/offers')).rejects.toBeInstanceOf(
      SessionTokenUnavailableError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
