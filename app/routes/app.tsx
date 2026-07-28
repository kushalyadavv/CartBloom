import { AppProvider } from '@shopify/shopify-app-react-router/react';
import { boundary } from '@shopify/shopify-app-react-router/server';
import type { HeadersFunction, LoaderFunctionArgs } from 'react-router';
import { Outlet, useRouteError } from 'react-router';

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  await context.shopify.authenticate.admin(request);
  return null;
};

export default function App() {
  return (
    // `embedded={false}` looks wrong here and is not: the prop's only effect is
    // whether AppProvider renders the App Bridge script itself. root.tsx
    // already loads it statically in <head>, which is the required order, so
    // passing `embedded` would load App Bridge twice — the second copy racing
    // the first. This still adds the Polaris web components, which is all that
    // is wanted from AppProvider.
    <AppProvider embedded={false}>
      <s-app-nav>
        <s-link href="/app">Offers</s-link>
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
