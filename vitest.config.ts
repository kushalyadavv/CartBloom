import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['app/**/*.test.ts', 'widget/src/**/*.test.ts'],
    environment: 'node',
  },
});
