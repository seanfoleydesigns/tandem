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
      // Dev only: the extension's content script on the demo store, without Chrome (extension/dev/harness.ts).
      // /__ext/on sets a cookie and from then on every page of the store loads the harness instead of the page
      // script, so full page loads keep it. /__ext/off goes back. Nothing here is part of any build.
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        if (path === '/__ext/on' || path === '/__ext/off') {
          res.statusCode = 302;
          res.setHeader('set-cookie', `tandem_harness=${path.endsWith('on') ? '1' : '; Max-Age=0'}; Path=/`);
          res.setHeader('location', '/');
          return res.end();
        }
        const wantsPage = req.method === 'GET' && (req.headers.accept ?? '').includes('text/html') && !path.includes('.');
        if (!wantsPage || !/(^|; )tandem_harness=1/.test(req.headers.cookie ?? '')) return next();
        const shell = readFileSync(resolve(repo, 'store/index.html'), 'utf8')
          .replace('<script type="module" src="/agent.js"></script>', `<script type="module" src="/@fs/${normalizePath(resolve(repo, 'extension/dev/harness.ts'))}"></script>`);
        res.setHeader('content-type', 'text/html');
        res.end(await server.transformIndexHtml(req.url ?? '/', shell));
      });
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
