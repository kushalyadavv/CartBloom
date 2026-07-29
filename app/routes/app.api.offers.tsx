/**
 * Offer list and creation.
 *
 * A JSON resource route rather than server-rendered markup: Task 13 left about
 * 6 ms of CPU per request after session verification, so the admin ships a thin
 * shell and moves data over fetch.
 *
 * `authenticate.admin` is what makes this safe. It verifies the session token
 * and yields the shop, and every query below is scoped to that shop — a
 * merchant cannot reach another shop's offers by guessing an id.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';

import { listOffers, saveOffer } from '../db.server';
import { resolvePlan } from '../lib/plan.server';
import { newDraft, planCaps, type OfferDraft } from '../lib/offer-draft';

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { session, admin } = await context.shopify.authenticate.admin(request);
  const [offers, plan] = await Promise.all([
    listOffers(context.env.DB, session.shop),
    resolvePlan(admin, context.env.DB, session.shop),
  ]);

  return Response.json({
    offers: offers.map((o) => ({
      id: o.id,
      name: o.name,
      status: o.status,
      updatedAt: o.updatedAt,
    })),
    plan,
    caps: planCaps(plan),
  });
};

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const { session } = await context.shopify.authenticate.admin(request);

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const body = (await request.json()) as { name?: string };
  const draft: OfferDraft = newDraft(crypto.randomUUID(), body.name?.trim() || 'Untitled offer');

  await saveOffer(context.env.DB, session.shop, {
    id: draft.id,
    name: draft.name,
    status: 'DRAFT',
    config: draft,
  });

  // Deliberately no plan-cap check here. Caps are on *active* offers and are
  // enforced at publish (spec §10) — blocking draft creation would stop a
  // merchant preparing their next promotion while the current one runs.
  return Response.json({ offer: draft }, { status: 201 });
};
