import { boundary } from '@shopify/shopify-app-react-router/server';
import type { HeadersFunction, LoaderFunctionArgs } from 'react-router';

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  await context.shopify.authenticate.admin(request);
  return null;
};

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
