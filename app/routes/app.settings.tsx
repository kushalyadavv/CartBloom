/**
 * Settings.
 *
 * There is very little to configure, and that is the design: everything about
 * an offer lives on the offer. What remains is the theme hookup, which is the
 * step most likely to be missed, and a plain statement of what data the app
 * holds — which a merchant is entitled to know without reading a policy.
 */

import { useState } from 'react';
import type { LoaderFunctionArgs } from 'react-router';
import { useLoaderData } from 'react-router';

import { getShop } from '../db.server';
import { API_VERSION } from '../shopify.server';

const ANCHOR_SNIPPET = '<div data-cartbloom-anchor></div>';

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { session } = await context.shopify.authenticate.admin(request);
  const shop = await getShop(context.env.DB, session.shop);

  return {
    shop: session.shop,
    handle: session.shop.replace('.myshopify.com', ''),
    installedAt: shop?.webhooksRegisteredAt ?? null,
    hasDiscountNode: shop?.discountNodeId !== null && shop?.discountNodeId !== undefined,
    apiVersion: API_VERSION,
  };
};

export default function Settings() {
  const { shop, handle, hasDiscountNode, apiVersion } = useLoaderData<typeof loader>();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard?.writeText(ANCHOR_SNIPPET);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const themeEditor = `https://admin.shopify.com/store/${handle}/themes/current/editor?context=apps`;

  return (
    <s-page heading="Settings">
      <s-section heading="Show CartBloom in your theme">
        <s-stack gap="base">
          <s-paragraph>
            CartBloom renders through a theme app embed. It has to be switched on once, in the
            theme editor — an offer can be published and still show nothing until it is.
          </s-paragraph>
          <s-link href={themeEditor} target="_blank">
            <s-button variant="primary">Open theme editor</s-button>
          </s-link>
        </s-stack>
      </s-section>

      <s-section heading="Place it manually">
        <s-stack gap="base">
          <s-paragraph>
            CartBloom finds the right spot in most themes on its own. If yours puts it somewhere
            odd, paste this where you want it and CartBloom will use it instead of guessing.
          </s-paragraph>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack gap="small">
              <code style={{ userSelect: 'all', fontSize: '0.85em' }}>{ANCHOR_SNIPPET}</code>
              <s-button onClick={copy}>{copied ? 'Copied' : 'Copy'}</s-button>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="Status">
        <s-unordered-list>
          <s-list-item>{`Store: ${shop}`}</s-list-item>
          <s-list-item>{`Admin API version: ${apiVersion}`}</s-list-item>
          <s-list-item>
            {hasDiscountNode
              ? 'Discount created — CartBloom can apply rewards at checkout.'
              : 'No discount yet. Publish an offer and CartBloom will create one.'}
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="What CartBloom stores">
        <s-stack gap="base">
          <s-paragraph>
            Your offers, and an access token so the app can write them to your store. That is all.
          </s-paragraph>
          <s-paragraph>
            CartBloom requests no access to customers or orders, and holds no personal data about
            your shoppers. Tier targeting by customer tag is evaluated inside Shopify&apos;s own
            discount function, which answers yes or no without ever handing us a customer record.
          </s-paragraph>
          <s-paragraph>
            Uninstalling erases everything above within seconds — offers, tokens and published
            history.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}
