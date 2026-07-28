/**
 * Browser-side fetch for the app's own JSON endpoints.
 *
 * Three rules, each of which is a real failure mode rather than a preference:
 *
 * 1. Mint a fresh token per request. Session tokens live about a minute, so
 *    anything cached across a merchant's editing session is expired by the time
 *    it is used.
 *
 * 2. Never persist the token. No cookies, no localStorage — the app has to work
 *    in Chrome incognito with third-party cookies blocked, which is exactly how
 *    it gets tested during review.
 *
 * 3. Retry once on 401. App Bridge's refresh timer is throttled in backgrounded
 *    tabs, so a merchant returning to a tab left open can present a token that
 *    expired while the tab slept. The retry mints a new one and succeeds;
 *    without it the merchant sees a random failure that never reproduces for
 *    whoever is debugging it.
 */

declare global {
  interface Window {
    shopify?: { idToken: () => Promise<string> };
  }
}

export class SessionTokenUnavailableError extends Error {
  constructor() {
    super(
      'App Bridge is not available. The app must be loaded inside the Shopify admin.'
    );
    this.name = 'SessionTokenUnavailableError';
  }
}

async function idToken(): Promise<string> {
  const bridge = typeof window === 'undefined' ? undefined : window.shopify;
  if (!bridge?.idToken) throw new SessionTokenUnavailableError();
  return bridge.idToken();
}

function withToken(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(input, withToken(init, await idToken()));

  if (response.status !== 401) return response;

  // One retry, and only one: if a freshly minted token is also rejected, the
  // problem is not expiry, and retrying past that would spin.
  return fetch(input, withToken(init, await idToken()));
}
