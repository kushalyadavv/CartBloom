import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />

        {/*
          App Bridge, and it has to be exactly this shape.

          The meta tag and the script must be static markup in <head>, with the
          script ahead of every other script on the page. App Bridge reads the
          key from the meta tag as it initialises, so anything that injects the
          script later — including AppProvider's own `embedded` prop, which
          renders it into <body> through React — configures it too late and
          session tokens intermittently fail to mint.

          The key is a build-time constant rather than loader data for the same
          reason: nothing here may depend on a request having already been
          authenticated, because this is what bootstraps authentication.
        */}
        <meta name="shopify-api-key" content={__SHOPIFY_API_KEY__} />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />

        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
