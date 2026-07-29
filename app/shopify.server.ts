/**
 * Shopify app configuration, built per environment rather than at module scope.
 *
 * The template calls `shopifyApp()` once at import time and reads `process.env`.
 * Neither works on Workers: there is no `process`, and bindings like `env.DB`
 * exist only inside a request. So this exports a factory, and the Worker entry
 * hands it `env` through the load context.
 *
 * The instance is cached per `env` object. Workers reuses an isolate across
 * requests, so the config is built once per isolate rather than per request —
 * which matters against the 10 ms CPU cap that Task 13 measured 3 ms of.
 */

import type { D1Database } from '@cloudflare/workers-types';
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from '@shopify/shopify-app-react-router/server';

import { upsertShop } from './db.server';
import { D1SessionStorage } from './session-storage.server';

export interface Env {
  DB: D1Database;
  SHOPIFY_API_KEY: string;
  SHOPIFY_API_SECRET: string;
  SHOPIFY_APP_URL: string;
  SCOPES?: string;
  /**
   * The app's handle, as it appears in admin URLs (/apps/<handle>). Only used
   * to build the link to Shopify's hosted pricing page. Configurable because
   * getting it wrong sends merchants to a 404 on the one page that takes money.
   */
  SHOPIFY_APP_HANDLE?: string;
  SHOP_CUSTOM_DOMAIN?: string;
}

export const API_VERSION = ApiVersion.July26;

type ShopifyInstance = ReturnType<typeof shopifyApp>;

const cache = new WeakMap<Env, ShopifyInstance>();

export function getShopify(env: Env): ShopifyInstance {
  const existing = cache.get(env);
  if (existing !== undefined) return existing;

  const instance = shopifyApp({
    apiKey: env.SHOPIFY_API_KEY,
    apiSecretKey: env.SHOPIFY_API_SECRET,
    apiVersion: API_VERSION,
    scopes: env.SCOPES?.split(','),
    appUrl: env.SHOPIFY_APP_URL,
    authPathPrefix: '/auth',
    sessionStorage: new D1SessionStorage(env.DB),
    distribution: AppDistribution.AppStore,
    future: {
      // Non-expiring offline tokens are rejected by the Admin API outright.
      expiringOfflineAccessTokens: true,
    },
    hooks: {
      /**
       * Runs on first token acquisition, which under managed installation is
       * the only moment we are guaranteed to see a new shop.
       *
       * Creating the row here rather than lazily on first write means plan
       * state and the discount node id have somewhere to live before the
       * merchant does anything, and an install is visible in the data even if
       * the merchant never opens the app.
       *
       * Deliberately not registering webhooks: all five topics are declared in
       * shopify.app.toml, so Shopify subscribes at the app level on install.
       * Registering them again per shop would duplicate deliveries.
       *
       * Token exchange re-runs this on every refresh, so it must stay
       * idempotent — upsertShop is an INSERT ... ON CONFLICT DO UPDATE.
       */
      afterAuth: async ({ session }) => {
        await upsertShop(env.DB, session.shop, session.accessToken ?? '', session.scope ?? null);
      },
    },
    ...(env.SHOP_CUSTOM_DOMAIN ? { customShopDomains: [env.SHOP_CUSTOM_DOMAIN] } : {}),
  });

  cache.set(env, instance);
  return instance;
}

/** What loaders and actions receive. Populated by the Worker entry. */
export interface AppLoadContext {
  env: Env;
  shopify: ShopifyInstance;
}
