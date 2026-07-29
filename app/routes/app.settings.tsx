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
import { useLoaderData, useRevalidator } from 'react-router';

import { getShop, listPublishedVersions } from '../db.server';
import { authenticatedFetch } from '../lib/authenticated-fetch';
import { API_VERSION } from '../shopify.server';

const ANCHOR_SNIPPET = '<div data-cartbloom-anchor></div>';

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { session } = await context.shopify.authenticate.admin(request);
  const [shop, versions] = await Promise.all([
    getShop(context.env.DB, session.shop),
    listPublishedVersions(context.env.DB, session.shop),
  ]);

  return {
    versions: versions.map((v, i) => ({
      versionHash: v.versionHash,
      publishedAt: v.publishedAt,
      offerCount: ((v.payload as { widget?: { offers?: unknown[] } }).widget?.offers ?? []).length,
      current: i === 0,
    })),
    shop: session.shop,
    handle: session.shop.replace('.myshopify.com', ''),
    installedAt: shop?.webhooksRegisteredAt ?? null,
    hasDiscountNode: shop?.discountNodeId !== null && shop?.discountNodeId !== undefined,
    apiVersion: API_VERSION,
  };
};

export default function Settings() {
  const { shop, handle, hasDiscountNode, apiVersion, versions } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [copied, setCopied] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const restore = async (versionHash: string) => {
    if (
      !window.confirm(
        'Put this version back on your storefront? Your saved offers are not changed — only what shoppers see.'
      )
    ) {
      return;
    }

    setRestoring(versionHash);
    setRestoreError(null);
    try {
      const response = await authenticatedFetch('/app/api/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionHash }),
      });
      const body = (await response.json()) as { errors?: string[] };
      if (!response.ok) throw new Error(body.errors?.[0] ?? 'Could not restore that version');
      revalidator.revalidate();
    } catch (e) {
      setRestoreError(e instanceof Error ? e.message : 'Could not restore that version');
    } finally {
      setRestoring(null);
    }
  };

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

      <s-section heading="Publish history">
        <s-stack gap="base">
          {restoreError !== null && <s-banner tone="critical">{restoreError}</s-banner>}

          {versions.length === 0 ? (
            <s-paragraph>Nothing published yet.</s-paragraph>
          ) : (
            <>
              <s-paragraph>
                Every publish is kept. Restoring puts that version back on your storefront — your
                saved offers are left exactly as they are, so this undoes what shoppers see
                without touching what you have been editing.
              </s-paragraph>

              {versions.map((v) => (
                <s-box key={v.versionHash} padding="base" borderWidth="base" borderRadius="base">
                  <s-stack
                    direction="inline"
                    gap="base"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <s-stack gap="none">
                      <s-stack direction="inline" gap="small" alignItems="center">
                        <s-text>{new Date(v.publishedAt).toLocaleString()}</s-text>
                        {v.current && <s-badge tone="success">Live</s-badge>}
                      </s-stack>
                      <s-text tone="neutral">
                        {`${v.offerCount} ${v.offerCount === 1 ? 'offer' : 'offers'} · ${v.versionHash}`}
                      </s-text>
                    </s-stack>

                    {!v.current && (
                      <s-button
                        onClick={() => restore(v.versionHash)}
                        loading={restoring === v.versionHash || undefined}
                      >
                        Restore
                      </s-button>
                    )}
                  </s-stack>
                </s-box>
              ))}
            </>
          )}
        </s-stack>
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
