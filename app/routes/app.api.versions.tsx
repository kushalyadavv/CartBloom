/**
 * Publish history, and restoring from it.
 *
 * Scoped to the shop from the verified session token, so a version hash from
 * another shop reads as "not found".
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';

import { getPublishedVersion, getShop, listPublishedVersions, setDiscountNodeId } from '../db.server';
import { getShopInfo, restoreVersion, type RecordedPayload } from '../lib/publish.server';

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { session } = await context.shopify.authenticate.admin(request);
  const versions = await listPublishedVersions(context.env.DB, session.shop);

  return Response.json({
    versions: versions.map((v, i) => {
      const payload = v.payload as RecordedPayload;
      const widget = payload.widget as { offers?: unknown[] } | undefined;
      return {
        versionHash: v.versionHash,
        publishedAt: v.publishedAt,
        offerCount: widget?.offers?.length ?? 0,
        // The newest row is what the storefront is serving now.
        current: i === 0,
      };
    }),
  });
};

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const { session, admin } = await context.shopify.authenticate.admin(request);

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const { versionHash } = (await request.json()) as { versionHash?: string };
  if (!versionHash) return Response.json({ error: 'Missing version' }, { status: 400 });

  const version = await getPublishedVersion(context.env.DB, session.shop, versionHash);
  if (version === null) return Response.json({ error: 'Not found' }, { status: 404 });

  try {
    const [shop, shopInfo] = await Promise.all([
      getShop(context.env.DB, session.shop),
      getShopInfo(admin),
    ]);

    const discountNodeId = await restoreVersion(
      admin,
      shopInfo.id,
      version.payload as RecordedPayload,
      shop?.discountNodeId ?? null
    );

    if (discountNodeId !== shop?.discountNodeId) {
      await setDiscountNodeId(context.env.DB, session.shop, discountNodeId);
    }

    // Deliberately not re-recorded as a new version. Restoring is a move back
    // through the history, not a new entry in it — recording it would push the
    // version being escaped one step further away each time.
    return Response.json({ ok: true, versionHash });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not restore that version';
    return Response.json({ ok: false, errors: [message] }, { status: 500 });
  }
};
