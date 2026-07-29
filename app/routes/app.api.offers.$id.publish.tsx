/**
 * Publish.
 *
 * The only path by which a draft reaches a storefront. Order matters:
 *
 *   1. resolve gift variants, so the checks below can see what is real
 *   2. compile the three payloads
 *   3. run every publish check — nothing is written if one fails
 *   4. write the discount node, then the shop metafield
 *   5. record the version, then mark the offer published
 *
 * A partial publish would leave the function and the widget disagreeing, which
 * is the exact divergence this project exists to prevent. Writes therefore come
 * last and in dependency order, and a failure part-way leaves the previous
 * version recorded so it can be restored.
 */

import type { ActionFunctionArgs } from 'react-router';

import {
  getOffer,
  getShop,
  listOffers,
  recordPublish,
  saveOffer,
  setDiscountNodeId,
} from '../db.server';
import { compile } from '../lib/compile';
import type { OfferDraft } from '../lib/offer-draft';
import { checkPublish } from '../lib/publish-checks';
import {
  ensureDiscountNode,
  getShopInfo,
  resolveVariants,
  writeWidgetConfig,
} from '../lib/publish.server';

export const action = async ({ request, params, context }: ActionFunctionArgs) => {
  const { session, admin } = await context.shopify.authenticate.admin(request);
  const db = context.env.DB;
  const id = params.id!;

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const record = await getOffer(db, session.shop, id);
  if (record === null) return Response.json({ error: 'Not found' }, { status: 404 });

  const draft = record.config as OfferDraft;
  const shopRecord = await getShop(db, session.shop);

  try {
    // 1. Resolve gift variants.
    const variantIds = [
      ...new Set(draft.tiers.flatMap((t) => t.giftPool.map((g) => g.variantId))),
    ];
    const resolved = await resolveVariants(admin, variantIds, draft.giftDisplays);

    // A variant that no longer exists is dropped rather than published: the
    // function would discount a line nobody can add, and the chooser would
    // offer a product that 404s.
    const live: OfferDraft = {
      ...draft,
      tiers: draft.tiers.map((t) => ({
        ...t,
        giftPool: t.giftPool.filter((g) => !resolved.missing.includes(g.variantId)),
      })),
      giftDisplays: resolved.displays,
    };

    // 2. Compile, against every offer that will be live afterwards.
    const shopInfo = await getShopInfo(admin);
    const others = (await listOffers(db, session.shop))
      .filter((o) => o.id !== id && o.status === 'PUBLISHED')
      .map((o) => o.config as OfferDraft);

    const activeDrafts = [...others, live];
    const compiled = compile(activeDrafts, shopInfo.moneyFormat, shopInfo.currency);

    // 3. Check. Nothing has been written yet.
    const check = checkPublish(live, {
      activeDrafts,
      plan: shopRecord?.plan ?? 'free',
      compiled,
      unbuyableVariants: resolved.unbuyable,
    });

    if (!check.ok) {
      return Response.json({ ok: false, errors: check.errors, warnings: check.warnings }, { status: 422 });
    }

    // 4. Write. Discount node first: if the widget config landed first and this
    // failed, shoppers would see rewards the function would not honour.
    const discountNodeId = await ensureDiscountNode(
      admin,
      shopRecord?.discountNodeId ?? null,
      compiled
    );
    if (discountNodeId !== shopRecord?.discountNodeId) {
      await setDiscountNodeId(db, session.shop, discountNodeId);
    }

    await writeWidgetConfig(admin, shopInfo.id, compiled);

    // 5. Record, then mark published.
    await recordPublish(db, session.shop, compiled.version, {
      compact: compiled.compact,
      inputVariables: compiled.inputVariables,
      widget: compiled.widget,
    });

    await saveOffer(db, session.shop, {
      id,
      name: live.name,
      status: 'PUBLISHED',
      config: live,
    });

    return Response.json({
      ok: true,
      version: compiled.version,
      warnings: check.warnings,
      droppedVariants: resolved.missing,
    });
  } catch (error) {
    // Surfaced rather than swallowed: a merchant who clicks Publish and sees
    // nothing happen has no way to tell a validation failure from an outage.
    const message = error instanceof Error ? error.message : 'Publishing failed';
    console.error('publish failed', message);
    return Response.json({ ok: false, errors: [message] }, { status: 500 });
  }
};
