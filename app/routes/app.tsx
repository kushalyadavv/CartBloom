import { AppProvider } from '@shopify/shopify-app-react-router/react';
import { boundary } from '@shopify/shopify-app-react-router/server';
import type { HeadersFunction, LoaderFunctionArgs } from 'react-router';
import { Outlet, useLoaderData, useRouteError } from 'react-router';

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  await context.shopify.authenticate.admin(request);
  // From the binding, not `process.env` — there is no `process` on Workers.
  return { apiKey: context.env.SHOPIFY_API_KEY };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
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
