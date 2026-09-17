---
name: oidc-client
description: Add OIDC login+logout (Authorization Code + PKCE) to a page in this project using public/oidc_client.js. Use when the user asks to add login, authentication, sign-in, logout, or "protect this page" for a vanilla JS or React page in this repo, or mentions OIDC/PKCE integration here.
---

# oidc_client.js integration skill

This project has a reusable, dependency-free OIDC Authorization Code + PKCE
client at `public/oidc_client.js`. It does all login/callback/refresh/logout
work and exposes the result as `window` globals + `CustomEvent`s. **Never
write a new OIDC/PKCE flow from scratch in this repo** — reuse this script.
Full reference: `README.md` at the repo root.

## Before writing any code

1. Read `README.md` (root) for the config shape, globals, and event list.
2. Read the closest existing example instead of guessing markup/wiring:
   - Vanilla JS page: `index-vanilla-js.html`
   - React page: `index-react.html` + `src/react/App.jsx` +
     `src/react/SimpleOidcPage.jsx`
   - Richer multi-view vanilla example (login/callback/logged-out screens,
     token status display): `oidc-client.html`
3. Check `vite.config.js` for the `/oidc-proxy/token` dev proxy pattern —
   some IDP clients reject any `fetch()` carrying a browser `Origin`
   header, so `token_endpoint` may need to point at a proxy path instead of
   the IdP directly. Reuse that proxy rather than hitting the IdP straight
   from the browser unless you've confirmed CORS/Origin works.

## Contract (don't re-derive — copy this)

**Config**, define `window.OIDC_CONFIG` *before* loading the script:
```js
window.OIDC_CONFIG = {
  client_id: '...',
  authorization_endpoint: '...',
  token_endpoint: '...',            // may need to be a same-origin proxy path
  end_session_endpoint: '...',
  scope: 'openid profile email',    // optional, this is the default
  redirect_uri: window.location.origin, // optional; defaults to the page's own URL
  refresh_buffer_seconds: 60,       // optional
  autoLogin: true,                  // optional; set false to show a login button instead of auto-redirecting
};
```
Then: `<script src="/oidc_client.js"></script>` (must load and execute
**before** any code that reads the globals below, e.g. before a React
bundle's `<script type="module">`).

**Globals** (read-only from consumer code, except calling the functions):
`window.access_token`, `window.id_token`, `window.oidcUser` (decoded claims
or `null`), `window.login()`, `window.logout()`.

**Events** on `window` (`CustomEvent`): `oidc:authenticated` (`{ user,
expiresAt }`), `oidc:unauthenticated` (`{ loggedOut }`),
`oidc:callbackStart`, `oidc:callbackError` (`{ message }`),
`oidc:tokenRefreshed` (`{ expiresAt }`), `oidc:loggingOut`.

## Implementation pattern

Any consumer — vanilla JS or a framework component — follows the same
shape:

1. Keep local state mirroring `window.oidcUser` (`null` = show a loading /
   logged-out view).
2. On mount/load, sync that state from `window.oidcUser` once immediately
   — `oidc_client.js`'s own bootstrap runs on `DOMContentLoaded` and may
   have already fired before your listener attached.
3. Subscribe to `oidc:authenticated` and `oidc:unauthenticated` to keep
   that state in sync afterwards (unsubscribe on teardown, e.g.
   `componentWillUnmount` / cleanup effect).
4. Render the authenticated view using `user.name || user.preferred_username`
   and `user.email`; wire a logout control to `window.logout()`.
5. Never implement login/redirect/token-exchange logic yourself — only
   call `window.login()` if you need a manual "Log in" button (when
   `autoLogin: false`).

### Vanilla JS page
Mirror `index-vanilla-js.html`: config script → `<script
src="/oidc_client.js">` → a container div → a small script that defines
`render()` reading `window.oidcUser`, registers it on both `oidc:*`
events, and calls it once immediately.

### React page
Mirror `src/react/SimpleOidcPage.jsx` (component holding
`{ user: window.oidcUser }` in state, syncing via the two events in
`componentDidMount`/`componentWillUnmount`) and `src/react/App.jsx` +
`index-react.html` (how the host page loads config + script, then mounts
React into `#root`). If adding a new React entry page, add both a new
`.html` file (own `OIDC_CONFIG`) and a matching entry in
`vite.config.js`'s `build.rollupOptions.input`, following the existing
`main`/`vanilla` pattern.

## Common mistakes to avoid

- Defining `OIDC_CONFIG` after the `<script src="oidc_client.js">` tag —
  it must come first, or the client falls back to `undefined` config
  values.
- Reading `window.oidcUser` only once on load without also subscribing to
  `oidc:authenticated`/`oidc:unauthenticated` — misses login completing
  after a redirect callback or a silent refresh updating the user.
- Building a custom logout button that clears local state directly instead
  of calling `window.logout()` — skips the IdP `end_session_endpoint`
  redirect and leaves an IdP-side session alive.
- Adding a new JSX file with a `.js` extension in this project — Vite's
  configured React plugin only applies the JSX transform to `.jsx`/`.tsx`
  files here (see `src/react/App.jsx`).
