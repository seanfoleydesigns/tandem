import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig, normalizePath, type Plugin } from 'vite';

const repo = fileURLToPath(new URL('.', import.meta.url));

// The store loads the agent through one tag: <script type="module" src="/agent.js">.
// In dev that URL is served from agent/index.ts. `npm run build:agent` makes the real file.
function agentScript(): Plugin {
  return {
    name: 'tandem-agent-script',
    enforce: 'pre',
    resolveId(id) {
      if (id === '/agent.js') return normalizePath(resolve(repo, 'agent/index.ts'));
    },
  };
}

export default defineConfig({
  root: 'store',
  plugins: [agentScript()],
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [repo] },
    proxy: { '/api': 'http://localhost:8787' },
  },
});
