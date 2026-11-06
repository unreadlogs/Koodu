import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const contracts = fileURLToPath(
  new URL('./protocol/src/index.ts', import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      '@koodu/protocol': contracts,
    },
  },
  test: {
    include: ['protocol/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
  },
});
