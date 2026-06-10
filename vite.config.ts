import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { pathToFileURL } from 'url';
import dotenv from 'dotenv';
import { defineConfig, type Plugin } from 'vite';

// The `api/` directory holds Vercel serverless functions (live gov-data proxies
// + host AI). `vite dev` doesn't run them, so during local dev the live map
// layers were silently dead. This plugin runs each handler as dev middleware —
// same code, same routes as production — and loads the non-VITE secrets from
// .env.local (DATAMALL_ACCOUNT_KEY etc.) into process.env so the proxies work.
function devApi(): Plugin {
  const isBridgeRoute = (pathname: string) =>
    pathname === '/api/join' ||
    pathname === '/api/health' ||
    pathname === '/api/presence' ||
    pathname.startsWith('/api/demo/');

  return {
    name: 'dev-api',
    apply: 'serve',
    configResolved() {
      dotenv.config({ path: path.resolve(__dirname, '.env.local') });
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next();
        const pathname = req.url.split('?')[0];
        if (isBridgeRoute(pathname)) return next();
        const file = path.resolve(__dirname, 'api', pathname.slice('/api/'.length) + '.js');
        try {
          if (req.method && !['GET', 'HEAD'].includes(req.method.toUpperCase())) {
            (req as typeof req & { body?: unknown; rawBody?: string }).rawBody = await readBody(req);
            const raw = (req as typeof req & { rawBody?: string }).rawBody ?? '';
            if (raw) {
              try {
                (req as typeof req & { body?: unknown }).body = JSON.parse(raw);
              } catch {
                (req as typeof req & { body?: unknown }).body = {};
              }
            }
          }
          const mod = await import(pathToFileURL(file).href);
          await mod.default(req, res);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'dev_api_error', route: pathname, message: String(err) }));
        }
      });
    },
  };
}

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 256_000) reject(new Error('request body too large'));
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), devApi()],
    build: {
      rollupOptions: {
        output: {
          // React rarely changes between deploys → its own long-cached chunk.
          // MapLibre GL is split automatically via the lazy import in Shell.tsx.
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        // Realtime routes live on the FastAPI bridge. Native dev → 127.0.0.1:8787;
        // inside the compose network the web container sets KK_BRIDGE_PROXY=http://bridge:8787.
        '/api/join': process.env.KK_BRIDGE_PROXY ?? 'http://127.0.0.1:8787',
        '/api/health': process.env.KK_BRIDGE_PROXY ?? 'http://127.0.0.1:8787',
        '/api/presence': process.env.KK_BRIDGE_PROXY ?? 'http://127.0.0.1:8787',
        '/api/demo': process.env.KK_BRIDGE_PROXY ?? 'http://127.0.0.1:8787',
      },
    },
  };
});
