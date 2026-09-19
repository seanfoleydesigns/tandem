import { defineConfig } from 'vite';

// The Chrome extension, two classic scripts in extension/dist/:
//   vite build --config vite.ext.config.ts --mode content       the agent, as a content script
//   vite build --config vite.ext.config.ts --mode background    the service worker
// An IIFE each: a content script injected twice must not redeclare top-level names, and the worker needs no modules.
export default defineConfig(({ mode }) => {
  const worker = mode === 'background';
  return {
    build: {
      outDir: 'extension/dist',
      emptyOutDir: false,
      lib: {
        entry: worker ? 'extension/background.ts' : 'extension/content.ts',
        name: worker ? 'TandemWorker' : 'TandemContent',
        formats: ['iife'],
        fileName: () => (worker ? 'background.js' : 'content.js'),
      },
    },
  };
});
