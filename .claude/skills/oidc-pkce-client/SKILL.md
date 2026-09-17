---
name: oidc-pkce-client
description: Drop a dependency-free OIDC Authorization Code + PKCE login+logout client into ANY web project (vanilla JS or React), copying the bundled oidc_client.js and wiring it up. Use when a user asks to add login, sign-in, authentication, logout, or OIDC/PKCE integration to a project, page, or component — in any repo, not just this one.
---

# Portable OIDC + PKCE client skill

This skill packages a self-contained, dependency-free OIDC Authorization
Code + PKCE client (`assets/oidc_client.js`) that can be dropped into any
web project — plain HTML, or any JS framework — to add login/logout without
writing a PKCE flow by hand.

**Never hand-write a new OIDC/PKCE flow when this skill applies.** Copy the
bundled script and wire it up per the contract below.

## Setup steps

1. Copy `assets/oidc_client.js` from this skill into the target project's
   static/public asset folder (e.g. `public/oidc_client.js`,
   `static/oidc_client.js`, or wherever that project serves static files
   from) so it's reachable at a URL like `/oidc_client.js`.
2. In the host HTML page, define `window.OIDC_CONFIG` in an inline
   `<script>`, then load the copied file with
   `<script src="/oidc_client.js"></script>` **immediately after** —
   config must exist before the script runs.
3. Pick the matching example under `assets/` for the target stack and
   adapt it:
   - Plain HTML / vanilla JS: `assets/vanilla-example.html`
   - React: `assets/react-example.jsx` (class component reading
     `window.oidcUser`, mounted from a host HTML page — see the comment
     block at the bottom of that file for the host-page wiring)
   - Any other framework (Vue, Svelte, Angular, etc.): follow the same
     "Implementation pattern" below — there's nothing React-specific in
     the contract itself.
4. If the IdP client rejects browser `fetch()` requests to its token
   endpoint (e.g. a IDP client with no "Web Origins" configured
   returns a CORS or "Invalid origin" error), point `token_endpoint` at a
   same-origin server-side proxy that strips the `Origin`/`Referer`
   headers, rather than hitting the IdP directly from the browser.

## Contract (the script's public surface — don't re-derive it, copy this)

**Config** — define `window.OIDC_CONFIG` before loading the script:
```js
window.OIDC_CONFIG = {
  client_id: '...',
  authorization_endpoint: '...',
  token_endpoint: '...',                // may need to be a same-origin proxy path
  end_session_endpoint: '...',
  scope: 'openid profile email',        // optional, this is the default
  redirect_uri: window.location.origin, // optional; defaults to the page's own URL
  refresh_buffer_seconds: 60,           // optional
  autoLogin: true,                      // optional; set false to show a manual login button instead of auto-redirecting
};
```

**Globals** the script exposes on `window` (read; call the two functions):
- `access_token` (`string|null`), `id_token` (`string|null`), `oidcUser`
  (decoded id_token claims, `object|null`)
- `login()` — manually start the PKCE redirect (only needed if
  `autoLogin: false`)
- `logout()` — required logout entry point; always use this, never clear
  state manually

**Events** dispatched on `window` as `CustomEvent`:
| Event | `detail` | When |
|---|---|---|
| `oidc:authenticated` | `{ user, expiresAt }` | After login, or on load with a valid stored session |
| `oidc:unauthenticated` | `{ loggedOut }` | No session (pre auto-redirect, or right after logout) |
| `oidc:callbackStart` | `{}` | An authorization callback (`?code=`) is being processed |
| `oidc:callbackError` | `{ message }` | Callback validation or token exchange failed |
| `oidc:tokenRefreshed` | `{ expiresAt }` | Silent refresh succeeded |
| `oidc:loggingOut` | `{}` | About to redirect to `end_session_endpoint` |

The script uses the host page's own URL (query string stripped) as its
`redirect_uri` target, so no separate `/auth/callback` route is needed —
whatever page loads it becomes its own callback handler.

## Implementation pattern (framework-agnostic)

1. Keep local state mirroring `window.oidcUser` (`null` = show a
   loading/logged-out view).
2. On mount/load, sync that state from `window.oidcUser` once
   immediately — the script's own bootstrap runs on `DOMContentLoaded`
   and may have already fired before your listener attached.
3. Subscribe to `oidc:authenticated` and `oidc:unauthenticated` to keep
   state in sync afterwards; unsubscribe on teardown.
4. Render the authenticated view using
   `user.name || user.preferred_username` and `user.email`; wire a
   logout control to `window.logout()`.
5. Never implement login/redirect/token-exchange logic yourself — only
   call `window.login()` for a manual "Log in" button when
   `autoLogin: false`.

## Common mistakes to avoid

- Defining `OIDC_CONFIG` after the `oidc_client.js` `<script>` tag — it
  must come first, or the client reads `undefined` config values.
- Loading `oidc_client.js` after a framework bundle that reads
  `window.oidcUser` on its own first render — the script must execute
  first so the globals exist.
- Reading `window.oidcUser` only once on load without subscribing to the
  two events — misses login completing after a redirect callback or a
  silent refresh updating the user.
- Building a custom logout button that clears local state directly
  instead of calling `window.logout()` — skips the IdP
  `end_session_endpoint` redirect and leaves an IdP-side session alive.
- Assuming the IdP's token endpoint accepts direct browser `fetch()` —
  some clients (e.g. IDP with no Web Origins configured) reject any
  request carrying an `Origin` header; you may need a same-origin proxy.
