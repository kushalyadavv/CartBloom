declare module "*.css";

/**
 * The app's client id, substituted by Vite at build time from
 * shopify.app.toml. Declared global so root.tsx can put it in the App Bridge
 * meta tag without routing it through a loader.
 */
declare const __SHOPIFY_API_KEY__: string;
