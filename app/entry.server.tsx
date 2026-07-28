/**
 * Server rendering, on Workers.
 *
 * The template shipped `renderToPipeableStream` over a Node `PassThrough`.
 * Neither exists here, so this uses the web-streams renderer instead. The
 * observable behaviour is the same; the runtime is not.
 */

import { isbot } from 'isbot';
import { renderToReadableStream } from 'react-dom/server';
import { ServerRouter, type AppLoadContext, type EntryContext } from 'react-router';

export const streamTimeout = 5000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
  loadContext: AppLoadContext
) {
  // Frame-ancestors for the admin iframe. Without this the embedded app is
  // blocked by the browser rather than by Shopify, which reads as a bug in the
  // app rather than a missing header.
  loadContext.shopify.addDocumentResponseHeaders(request, responseHeaders);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), streamTimeout + 1000);

  let didError = false;
  const stream = await renderToReadableStream(
    <ServerRouter context={reactRouterContext} url={request.url} />,
    {
      signal: controller.signal,
      onError(error: unknown) {
        didError = true;
        console.error(error);
      },
    }
  );

  // Bots want the whole document; browsers want the shell as early as possible.
  if (isbot(request.headers.get('user-agent') ?? '')) {
    await stream.allReady;
  }

  stream.allReady.then(
    () => clearTimeout(timeout),
    () => clearTimeout(timeout)
  );

  responseHeaders.set('Content-Type', 'text/html');
  return new Response(stream, {
    headers: responseHeaders,
    status: didError ? 500 : responseStatusCode,
  });
}
