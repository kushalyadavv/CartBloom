import { AppProvider } from '@shopify/shopify-app-react-router/react';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { useEffect } from 'react';
import type { HeadersFunction, LoaderFunctionArgs } from 'react-router';
import { Outlet, useNavigate, useRouteError } from 'react-router';

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  await context.shopify.authenticate.admin(request);
  return null;
};

/**
 * Turn App Bridge navigation into client-side routing.
 *
 * Shopify loads the app iframe with `id_token`, `shop` and `host` in the query
 * string. A full page navigation to another route drops all three, so that
 * route's loader has nothing to authenticate with and answers 410 — which
 * surfaces as a blank page where the wizard should be.
 *
 * AppProvider normally registers this listener, but only inside the same
 * `embedded` branch that injects the App Bridge script. root.tsx already loads
 * that script statically, which is the order the platform requires, so this app
 * renders AppProvider with `embedded={false}` to avoid a second copy — and has
 * to bring the listener itself.
 */
function useAppBridgeNavigation(): void {
  const navigate = useNavigate();

  useEffect(() => {
    const onNavigate = (event: Event) => {
      const href = (event.target as HTMLElement | null)?.getAttribute('href');
      if (href) navigate(href);
    };

    document.addEventListener('shopify:navigate', onNavigate);
    return () => document.removeEventListener('shopify:navigate', onNavigate);
  }, [navigate]);
}

export default function App() {
  useAppBridgeNavigation();

  return (
    // `embedded={false}` looks wrong here and is not: the prop's only effect is
    // whether AppProvider injects App Bridge and its navigation listener.
    // root.tsx loads the script statically in <head>, which is the required
    // order, so passing `embedded` would load App Bridge twice — the second
    // copy racing the first. The listener is supplied above instead.
    <AppProvider embedded={false}>
      <s-app-nav>
        <s-link href="/app">Offers</s-link>
        <s-link href="/app/plan">Plan</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch these thrown responses so their headers
// survive to the browser.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
