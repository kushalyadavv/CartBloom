/**
 * Shopify session storage backed by Cloudflare D1.
 *
 * Replaces the template's Prisma + SQLite adapter, which does not run on
 * Workers. Implements the same `SessionStorage` contract the Shopify library
 * expects.
 *
 * This sits on the hot path: every embedded admin request loads a session
 * before anything else happens. Task 13 measured the whole floor —
 * verification plus one D1 read plus shell render — at 3 ms CPU against a 10 ms
 * cap, and that budget assumes the session load is a single primary-key
 * lookup. Anything more here is taken out of feature work.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { Session } from '@shopify/shopify-api';
import { Session as ShopifySession } from '@shopify/shopify-api';
import type { SessionStorage } from '@shopify/shopify-app-session-storage';

interface SessionRow {
  id: string;
  shop: string;
  state: string | null;
  is_online: number;
  scope: string | null;
  expires: number | null;
  access_token: string | null;
  user_id: string | null;
}

function toSession(row: SessionRow): Session {
  return new ShopifySession({
    id: row.id,
    shop: row.shop,
    state: row.state ?? '',
    isOnline: row.is_online === 1,
    ...(row.scope !== null ? { scope: row.scope } : {}),
    // Stored as epoch ms; the library wants a Date.
    ...(row.expires !== null ? { expires: new Date(row.expires) } : {}),
    ...(row.access_token !== null ? { accessToken: row.access_token } : {}),
    ...(row.user_id !== null ? { onlineAccessInfo: { associated_user: { id: Number(row.user_id) } } as never } : {}),
  });
}

export class D1SessionStorage implements SessionStorage {
  constructor(private readonly db: D1Database) {}

  async storeSession(session: Session): Promise<boolean> {
    await this.db
      .prepare(
        `INSERT INTO sessions (id, shop, state, is_online, scope, expires, access_token, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           shop = excluded.shop,
           state = excluded.state,
           is_online = excluded.is_online,
           scope = excluded.scope,
           expires = excluded.expires,
           access_token = excluded.access_token,
           user_id = excluded.user_id`
      )
      .bind(
        session.id,
        session.shop,
        session.state ?? null,
        session.isOnline ? 1 : 0,
        session.scope ?? null,
        session.expires === undefined ? null : session.expires.getTime(),
        session.accessToken ?? null,
        session.onlineAccessInfo?.associated_user?.id?.toString() ?? null
      )
      .run();
    return true;
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const row = await this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .bind(id)
      .first<SessionRow>();
    return row === null ? undefined : toSession(row);
  }

  async deleteSession(id: string): Promise<boolean> {
    await this.db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    return true;
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return true;
    const placeholders = ids.map(() => '?').join(',');
    await this.db
      .prepare(`DELETE FROM sessions WHERE id IN (${placeholders})`)
      .bind(...ids)
      .run();
    return true;
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM sessions WHERE shop = ?')
      .bind(shop)
      .all<SessionRow>();
    return results.map(toSession);
  }
}
