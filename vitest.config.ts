import { defineConfig } from 'vitest/config';

// Unit tests cover pure logic only and never touch the network.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
});
