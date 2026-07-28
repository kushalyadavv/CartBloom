/**
 * Offers list — the app's home.
 *
 * A placeholder until Task 42 builds the wizard. The template's demo page and
 * its product-creation mutation are gone: they exercised scopes CartBloom does
 * not request, which is precisely the kind of mismatch review looks for.
 */

import type { LoaderFunctionArgs } from 'react-router';
import { useLoaderData } from 'react-router';

import { listOffers } from '../db.server';

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { session } = await context.shopify.authenticate.admin(request);
  return { offers: await listOffers(context.env.DB, session.shop) };
};

export default function Index() {
  const { offers } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Offers">
      {offers.length === 0 ? (
        <s-section heading="No offers yet">
          <s-paragraph>
            Create an offer to show a progress bar in your cart.
          </s-paragraph>
        </s-section>
      ) : (
        <s-section heading="Your offers">
          {offers.map((offer) => (
            <s-box key={offer.id} padding="base">
              <s-text>{offer.name}</s-text> <s-badge>{offer.status}</s-badge>
            </s-box>
          ))}
        </s-section>
      )}
    </s-page>
  );
}
