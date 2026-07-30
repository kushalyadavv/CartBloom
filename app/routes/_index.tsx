/**
 * The app's root path.
 *
 * Always forwards into the app, and deliberately never off-site.
 *
 * Shopify loads this route *inside the admin iframe* when a merchant clicks the
 * app's own entry in the left nav. An earlier version redirected to
 * apps.shopify.com when no `shop` param was present, which is exactly what that
 * click looks like — and the App Store sets X-Frame-Options, so the iframe
 * rendered "apps.shopify.com refused to connect" and stayed stuck until a full
 * page reload.
 *
 * There is nothing to render here in any case: `/app` authenticates, and if
 * there is no session it knows how to bounce for a token. Handing that decision
 * to a route that can answer it beats guessing from a query parameter.
 */

import type { LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';

export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  throw redirect(`/app${url.search}`);
};
