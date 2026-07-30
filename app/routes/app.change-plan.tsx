/**
 * Hand the merchant off to Shopify's hosted plan page.
 *
 * A server-side redirect through the library's own helper, not a link in the
 * page. The plan page lives outside the app's scope, so the navigation has to
 * escape the admin iframe — `target: '_top'` is what does that, and it is
 * required rather than optional. A plain anchor from inside the frame either
 * opens a stray tab or is blocked outright.
 *
 * Shopify hosts the page itself. Building a billing UI here would mean handling
 * charges, proration and cancellation that Shopify already handles correctly.
 */

import type { LoaderFunctionArgs } from 'react-router';

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { session, redirect } = await context.shopify.authenticate.admin(request);

  const appHandle = context.env.SHOPIFY_APP_HANDLE;
  if (!appHandle) {
    // Never guess. The handle `cartbloom` belongs to a different published app,
    // so a plausible default sent merchants to a stranger's pricing page and a
    // 404 — a visible failure here is far better than a silent wrong turn.
    throw new Response(
      'CartBloom is missing its app handle, so it cannot open your plan page. Please contact support.',
      { status: 500 }
    );
  }

  const storeHandle = session.shop.replace('.myshopify.com', '');

  return redirect(
    `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`,
    { target: '_top' }
  );
};
