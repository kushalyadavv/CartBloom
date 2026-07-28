/**
 * The Worker entry point.
 *
 * Everything server-side hangs off this: `env` only exists inside `fetch`, so
 * this is the one place that can build the Shopify instance and hand it to
 * loaders and actions through the load context. Routes never import a
 * module-scope singleton, because on Workers there is nothing for one to
 * close over.
 */

import { createRequestHandler } from 'react-router';

import { getShopify, type Env } from '../app/shopify.server';

declare module 'react-router' {
  interface AppLoadContext {
    env: Env;
    shopify: ReturnType<typeof getShopify>;
  }
}

const handler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE
);

// Typed with the DOM `Request`/`Response` rather than Cloudflare's
// `ExportedHandler<Env>`. Both describe the same runtime objects, but React
// Router's handler is declared against the DOM ones, and mixing the two
// declarations produces a type conflict with no runtime meaning.
export default {
  fetch(request: Request, env: Env, _ctx: unknown): Promise<Response> {
    return handler(request, {
      env,
      // Cached per `env` inside the factory, so this is one build per isolate
      // rather than one per request — which the 10 ms CPU cap cares about.
      shopify: getShopify(env),
    });
  },
};
