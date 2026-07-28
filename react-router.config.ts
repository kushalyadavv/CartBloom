import type { Config } from '@react-router/dev/config';

export default {
  ssr: true,
  future: {
    // Required by @cloudflare/vite-plugin: it builds the server into a Worker
    // environment rather than the default Node one.
    v8_viteEnvironmentApi: true,
  },
} satisfies Config;
