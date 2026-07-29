/**
 * A single offer: read, autosave, delete.
 *
 * Every query is scoped to the shop from the verified session token, so an id
 * from another shop reads as "not found" rather than leaking anything about
 * whether it exists.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';

import { deleteOffer, getOffer, getShop, saveOffer } from '../db.server';
import { validateDraft, type OfferDraft } from '../lib/offer-draft';

export const loader = async ({ request, params, context }: LoaderFunctionArgs) => {
  const { session } = await context.shopify.authenticate.admin(request);
  const record = await getOffer(context.env.DB, session.shop, params.id!);

  if (record === null) return Response.json({ error: 'Not found' }, { status: 404 });

  const shop = await getShop(context.env.DB, session.shop);
  const draft = record.config as OfferDraft;

  return Response.json({
    offer: draft,
    status: record.status,
    issues: validateDraft(draft, shop?.plan ?? 'free'),
  });
};

export const action = async ({ request, params, context }: ActionFunctionArgs) => {
  const { session } = await context.shopify.authenticate.admin(request);
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

  const body = (await request.json()) as { offer?: OfferDraft };
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

  const shop = await getShop(context.env.DB, session.shop);
  return Response.json({ ok: true, issues: validateDraft(draft, shop?.plan ?? 'free') });
};
