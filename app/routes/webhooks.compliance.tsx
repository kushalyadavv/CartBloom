/**
 * The three mandatory GDPR compliance topics, on one endpoint.
 *
 * Shopify requires all three to be implemented regardless of whether an app
 * stores personal data. CartBloom does not: it requests no customer or order
 * scopes, and tag targeting is evaluated inside the discount function via
 * `hasTags`, which returns booleans and never yields a customer record.
 *
 * So two of the three are honest no-ops, and saying so is the point — a
 * reviewer checks that the response is a deliberate 200 rather than an
 * accidental one. `shop/redact` is not a no-op: it actually purges, because the
 * privacy policy promises deletion.
 *
 * `authenticate.webhook` verifies the HMAC and throws a 401 on a bad signature,
 * which is what stops this being an unauthenticated delete endpoint.
 */

import type { ActionFunctionArgs } from 'react-router';

import { purgeShop } from '../db.server';

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const { topic, shop } = await context.shopify.authenticate.webhook(request);

  switch (topic) {
    case 'CUSTOMERS_DATA_REQUEST':
    case 'CUSTOMERS_REDACT':
      // Nothing to return and nothing to erase: no customer data is ever
      // received or stored. Acknowledged so Shopify does not retry.
      console.log(`${topic} for ${shop}: no customer data held`);
      break;

    case 'SHOP_REDACT':
      // Redelivery-safe: purging an already-purged shop is a no-op.
      await purgeShop(context.env.DB, shop);
      console.log(`${topic} for ${shop}: purged`);
      break;

    default:
      // An unexpected topic on this endpoint means the TOML and this file have
      // drifted apart. A 404 makes that visible in the Shopify webhook log
      // rather than silently succeeding.
      return new Response('Unhandled topic', { status: 404 });
  }

  return new Response();
};
