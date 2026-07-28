/**
 * Data access, on D1.
 *
 * Replaces the template's Prisma client, which does not run on Workers.
 * Task 13 left roughly 6 ms of CPU for everything the admin actually does, so
 * queries are hand-written and every one is either a primary-key lookup or
 * covered by an index.
 *
 * `env.DB` is only reachable from a request context on Workers, so every
 * function takes the binding as an argument rather than importing a singleton —
 * the pattern Prisma encouraged and Workers does not permit.
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface ShopRecord {
  shop: string;
  accessToken: string;
  scope: string | null;
  plan: string | null;
  planCheckedAt: number | null;
  discountNodeId: string | null;
  webhooksRegisteredAt: number | null;
}

interface ShopRow {
  shop: string;
  access_token: string;
  scope: string | null;
  plan: string | null;
  plan_checked_at: number | null;
  discount_node_id: string | null;
  webhooks_registered_at: number | null;
}

export async function getShop(db: D1Database, shop: string): Promise<ShopRecord | null> {
  const row = await db
    .prepare(
      `SELECT shop, access_token, scope, plan, plan_checked_at,
              discount_node_id, webhooks_registered_at
       FROM shops WHERE shop = ?`
    )
    .bind(shop)
    .first<ShopRow>();

  if (row === null) return null;
  return {
    shop: row.shop,
    accessToken: row.access_token,
    scope: row.scope,
    plan: row.plan,
    planCheckedAt: row.plan_checked_at,
    discountNodeId: row.discount_node_id,
    webhooksRegisteredAt: row.webhooks_registered_at,
  };
}

export async function upsertShop(
  db: D1Database,
  shop: string,
  accessToken: string,
  scope: string | null
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO shops (shop, access_token, scope, installed_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(shop) DO UPDATE SET
         access_token = excluded.access_token,
         scope = excluded.scope,
         updated_at = excluded.updated_at`
    )
    .bind(shop, accessToken, scope, now, now)
    .run();
}

/*
 * There is deliberately no per-shop webhook registration here.
 *
 * All five topics — app/uninstalled, app/scopes_update, and the three
 * compliance topics — are declared in shopify.app.toml, so Shopify subscribes
 * at the app level when a shop installs. That satisfies the requirement to
 * register automatically on install more strongly than code could: there is no
 * first-request race to lose, and no shop that can end up unsubscribed because
 * a registration call failed. The `webhooks_registered_at` column is left in
 * the schema for a future topic that genuinely needs per-shop registration.
 */

export async function setDiscountNodeId(
  db: D1Database,
  shop: string,
  discountNodeId: string
): Promise<void> {
  await db
    .prepare('UPDATE shops SET discount_node_id = ?, updated_at = ? WHERE shop = ?')
    .bind(discountNodeId, Date.now(), shop)
    .run();
}

export async function cachePlan(db: D1Database, shop: string, plan: string): Promise<void> {
  const now = Date.now();
  await db
    .prepare('UPDATE shops SET plan = ?, plan_checked_at = ?, updated_at = ? WHERE shop = ?')
    .bind(plan, now, now, shop)
    .run();
}

// ----------------------------------------------------------------- offers ---

export interface OfferRecord {
  id: string;
  shop: string;
  name: string;
  status: 'DRAFT' | 'PUBLISHED' | 'PAUSED';
  config: unknown;
  updatedAt: number;
}

interface OfferRow {
  id: string;
  shop: string;
  name: string;
  status: OfferRecord['status'];
  config: string;
  updated_at: number;
}

const toOffer = (row: OfferRow): OfferRecord => ({
  id: row.id,
  shop: row.shop,
  name: row.name,
  status: row.status,
  config: JSON.parse(row.config),
  updatedAt: row.updated_at,
});

export async function listOffers(db: D1Database, shop: string): Promise<OfferRecord[]> {
  const { results } = await db
    .prepare('SELECT * FROM offers WHERE shop = ? ORDER BY updated_at DESC')
    .bind(shop)
    .all<OfferRow>();
  return results.map(toOffer);
}

export async function getOffer(
  db: D1Database,
  shop: string,
  id: string
): Promise<OfferRecord | null> {
  const row = await db
    .prepare('SELECT * FROM offers WHERE shop = ? AND id = ?')
    .bind(shop, id)
    .first<OfferRow>();
  return row === null ? null : toOffer(row);
}

export async function saveOffer(
  db: D1Database,
  shop: string,
  offer: { id: string; name: string; status: OfferRecord['status']; config: unknown }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO offers (id, shop, name, status, config, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         status = excluded.status,
         config = excluded.config,
         updated_at = excluded.updated_at`
    )
    .bind(offer.id, shop, offer.name, offer.status, JSON.stringify(offer.config), Date.now())
    .run();
}

export async function deleteOffer(db: D1Database, shop: string, id: string): Promise<void> {
  await db.prepare('DELETE FROM offers WHERE shop = ? AND id = ?').bind(shop, id).run();
}

// --------------------------------------------------------------- versions ---

export async function recordPublish(
  db: D1Database,
  shop: string,
  versionHash: string,
  payload: unknown
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO published_versions (shop, version_hash, payload, published_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(shop, versionHash, JSON.stringify(payload), Date.now())
    .run();
}

/**
 * Erase everything for a shop.
 *
 * Called by `shop/redact` and on uninstall. The privacy policy promises
 * deletion; this is what makes that true rather than aspirational. Batched so
 * a partial purge cannot leave orphaned offers behind a deleted shop row.
 */
export async function purgeShop(db: D1Database, shop: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM published_versions WHERE shop = ?').bind(shop),
    db.prepare('DELETE FROM offers WHERE shop = ?').bind(shop),
    db.prepare('DELETE FROM sessions WHERE shop = ?').bind(shop),
    db.prepare('DELETE FROM shops WHERE shop = ?').bind(shop),
  ]);
}
