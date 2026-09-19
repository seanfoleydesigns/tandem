import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig, normalizePath, type Plugin } from 'vite';

const repo = fileURLToPath(new URL('.', import.meta.url));

// The store loads the agent through one tag: <script type="module" src="/agent.js">.
// In dev that URL is served from agent/index.ts. `npm run build:agent` makes the real file.
// The dev server also serves the agent's states gallery at /gallery.html. It lives in agent/ui/, so
// the store holds nothing of the agent's, and it is not part of any build.
function agentScript(): Plugin {
  const served: Record<string, string> = { '/agent.js': 'agent/index.ts', '/gallery.js': 'agent/ui/gallery.ts' };
  return {
    name: 'tandem-agent-script',
    enforce: 'pre',
    resolveId(id) {
      if (served[id]) return normalizePath(resolve(repo, served[id]!));
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/gallery.html') return next();
        const html = await server.transformIndexHtml(req.url, readFileSync(resolve(repo, 'agent/ui/gallery.html'), 'utf8'));
        res.setHeader('content-type', 'text/html');
        res.end(html);
      });
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
