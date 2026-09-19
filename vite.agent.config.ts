import { defineConfig } from 'vite';

// Standalone build of the agent: one IIFE, dist/agent.js, for injection into other sites.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: 'agent/index.ts',
      name: 'Tandem',
      formats: ['iife'],
      fileName: () => 'agent.js',
    },
  },
});
