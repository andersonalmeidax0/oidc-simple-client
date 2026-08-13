import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Keycloak's token endpoint doesn't send Access-Control-Allow-Origin for the
// Vite dev origin, so the browser blocks the code/refresh-token exchange
// fetch()es with a CORS error. Proxy them through the dev server (a
// server-to-server request isn't subject to CORS) so local dev works without
// needing IdP-side "Web Origins" config. Production still needs either the
// IdP's CORS enabled for your real origin, or a backend proxy.
const OIDC_ISSUER0 = 'https://usw2.auth.ac/auth/realms/aakeycloackdeploy';
const OIDC_ISSUER = 'http://localhost:3000/realms/default/';


export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        simple: resolve(__dirname, 'simple.html'),
      },
    },
  },
  server: {
    proxy: {
      '/oidc-proxy/token': {
        target: OIDC_ISSUER,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/oidc-proxy\/token/, '/token'),
        configure: (proxy) => {
          // This Keycloak client has no "Web Origins" configured, so it
          // rejects any request carrying an Origin header at all (that's
          // the "Invalid origin" 403), regardless of its value. A real
          // server-to-server call (curl, this proxy) never sends one —
          // only the browser's fetch() adds it — so strip it to match.
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
            proxyReq.removeHeader('referer');
          });
        },
      },
    },
  },
});
