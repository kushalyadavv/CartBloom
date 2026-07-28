/**
 * The app's root path.
 *
 * Under managed installation a merchant never lands here with intent — Shopify
 * sends them straight to `/app` inside the admin. The template's version asked
 * for a `.myshopify.com` domain in a text input, which App Store review rejects
 * outright, so there is no form: with a shop param we forward into the app, and
 * without one there is nothing meaningful to show.
 */

import type { LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';

export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get('shop')) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  throw redirect('https://apps.shopify.com/');
};
