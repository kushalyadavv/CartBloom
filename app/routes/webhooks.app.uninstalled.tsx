/**
 * Uninstall.
 *
 * The privacy policy promises deletion, so this purges every row for the shop
 * rather than only its sessions — `shop/redact` arrives up to 48 hours later,
 * and leaving offers and tokens behind in the meantime is exactly what the
 * policy says does not happen.
 *
 * Shopify redelivers webhooks, so this must stay idempotent: purging an
 * already-purged shop is a no-op, not an error.
 */

import type { ActionFunctionArgs } from 'react-router';

import { purgeShop } from '../db.server';

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const { shop, topic } = await context.shopify.authenticate.webhook(request);
  console.log(`Received ${topic} for ${shop}`);

  await purgeShop(context.env.DB, shop);

  return new Response();
};
