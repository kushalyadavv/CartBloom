/**
 * A single offer: read, autosave, delete.
 *
 * Every query is scoped to the shop from the verified session token, so an id
 * from another shop reads as "not found" rather than leaking anything about
 * whether it exists.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';

import { deleteOffer, getOffer, getShop, listOffers, saveOffer } from '../db.server';
import type { OfferRecord } from '../db.server';
import { validateDraft, type OfferDraft } from '../lib/offer-draft';
import { resolvePlan } from '../lib/plan.server';
import { syncStorefront } from '../lib/publish.server';

type OfferRecordStatus = OfferRecord['status'];

export const loader = async ({ request, params, context }: LoaderFunctionArgs) => {
  const { session, admin } = await context.shopify.authenticate.admin(request);
  const record = await getOffer(context.env.DB, session.shop, params.id!);

  if (record === null) return Response.json({ error: 'Not found' }, { status: 404 });

  const draft = record.config as OfferDraft;

  return Response.json({
    offer: draft,
    status: record.status,
    issues: validateDraft(draft, await resolvePlan(admin, context.env.DB, session.shop)),
  });
};

export const action = async ({ request, params, context }: ActionFunctionArgs) => {
  const { session, admin } = await context.shopify.authenticate.admin(request);
  const id = params.id!;

  if (request.method === 'DELETE') {
    await deleteOffer(context.env.DB, session.shop, id);
    return Response.json({ ok: true });
  }

  if (request.method !== 'PUT') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const existing = await getOffer(context.env.DB, session.shop, id);
  if (existing === null) return Response.json({ error: 'Not found' }, { status: 404 });

  const body = (await request.json()) as { offer?: OfferDraft; status?: OfferRecordStatus };

  // A status-only write: activate or pause, without touching the config. Kept
  // separate from autosave so pausing cannot smuggle in a half-edited draft.
  if (body.offer === undefined && body.status !== undefined) {
    if (body.status !== 'PUBLISHED' && body.status !== 'PAUSED') {
      return Response.json({ error: 'Unsupported status' }, { status: 400 });
    }
    await saveOffer(context.env.DB, session.shop, {
      id,
      name: existing.name,
      status: body.status,
      config: existing.config,
    });

    // Then rewrite the storefront from what is published now. Flipping the row
    // alone would leave a "deactivated" offer still running, which is the worst
    // kind of bug in a merchant-facing control: nothing appears to fail.
    try {
      const shop = await getShop(context.env.DB, session.shop);
      const live = (await listOffers(context.env.DB, session.shop))
        .filter((o) => o.status === 'PUBLISHED')
        .map((o) => o.config as OfferDraft);

      await syncStorefront(
        admin,
        context.env.DB,
        session.shop,
        live,
        shop?.discountNodeId ?? null
      );
    } catch (error) {
      // The row is already flipped, so report the half-done state rather than
      // claiming success.
      const message = error instanceof Error ? error.message : 'Could not update the storefront';
      return Response.json(
        { ok: false, status: body.status, errors: [`Saved, but the storefront was not updated: ${message}`] },
        { status: 502 }
      );
    }

    return Response.json({ ok: true, status: body.status });
  }

  const incoming = body.offer;
  if (!incoming || typeof incoming !== 'object') {
    return Response.json({ error: 'Missing offer' }, { status: 400 });
  }

  // The id comes from the URL, never from the body: a draft that could rename
  // its own id would let one autosave overwrite a different offer.
  const draft: OfferDraft = { ...incoming, id };

  await saveOffer(context.env.DB, session.shop, {
    id,
    name: draft.name,
    // Autosave never changes status. Publishing is Task 45's job, and an
    // in-progress edit must not silently take a live offer down.
    status: existing.status,
    config: draft,
  });

  return Response.json({
    ok: true,
    issues: validateDraft(draft, await resolvePlan(admin, context.env.DB, session.shop)),
  });
};
