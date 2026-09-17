# oidc_client.js

A dependency-free OIDC Authorization Code + PKCE client for plain HTML pages
(`public/oidc_client.js`). It handles the login redirect, the callback
exchange, session storage, and silent token refresh — and exposes the result
as plain globals and `window` events, so any page can consume it: static
HTML, vanilla JS, React, or anything else that runs in a browser.

## Objectives

- No build step, no framework, no dependencies — a single `<script>` tag.
- Implement the Authorization Code + PKCE flow correctly (S256 challenge,
  `state` validation against CSRF, code exchange, refresh_token rotation).
- Make a page's own URL its redirect_uri / callback target, so no separate
  `/auth/callback` route is needed.
- Expose session state as framework-agnostic globals + `CustomEvent`s, so
  the same script backs a plain page and a React (or any other) component
  without duplicating OIDC logic.

## What it does

1. **Login** — `login()` generates a PKCE `code_verifier`/`code_challenge`
   pair and a random `state`, stores them in `sessionStorage`, and redirects
   the browser to `authorization_endpoint`.
2. **Callback handling** — on page load, if the URL has `?code=` or
   `?error=`, it validates `state` against the stored value, exchanges the
   `code` for tokens at `token_endpoint` (with `code_verifier`), and clears
   the query string via `history.replaceState`.
3. **Session storage** — access/refresh/id tokens and the decoded user are
   kept in `sessionStorage` under `oidc_auth` (tab-scoped, cleared on
   logout).
4. **Silent refresh** — schedules a `setTimeout` to call the
   `refresh_token` grant shortly before the access token expires
   (`refresh_buffer_seconds`). On failure, it forces a local logout.
5. **Auto-login** — if a page loads with no stored session (and no
   `logged_out` marker), it immediately starts the login redirect, unless
   `autoLogin: false` is set.
6. **Logout** — clears local session state and redirects to
   `end_session_endpoint`, passing `id_token_hint` and
   `post_logout_redirect_uri` (back to the same page, with `?logged_out=1`
   so auto-login doesn't immediately bounce the user back into the IdP).

## Configuration (`window.OIDC_CONFIG`)

Define this **before** the `<script src="oidc_client.js">` tag:

```js
window.OIDC_CONFIG = {
  client_id: 'demo-client',
  authorization_endpoint: 'https://idp.example.com/authorize',
  token_endpoint: 'https://idp.example.com/token',
  end_session_endpoint: 'https://idp.example.com/logout',
  scope: 'openid profile email',       // default: 'openid profile email'
  redirect_uri: window.location.origin, // optional; defaults to this page's own URL
  refresh_buffer_seconds: 60,          // optional; default 60
  autoLogin: true,                     // optional; default true
};
```

## Globals

| Global               | Type              | Description                                  |
|----------------------|-------------------|-----------------------------------------------|
| `window.access_token`| `string \| null`  | Current access token                          |
| `window.id_token`    | `string \| null`  | Current raw id token                          |
| `window.oidcUser`    | `object \| null`  | Decoded id_token claims (display only)        |
| `window.login()`     | `function`        | Manually start the PKCE redirect              |
| `window.logout()`    | `function`        | Required logout entry point                   |

## Events

All dispatched as `CustomEvent` on `window`:

| Event                   | `detail`                     | When                                                          |
|--------------------------|-------------------------------|----------------------------------------------------------------|
| `oidc:authenticated`     | `{ user, expiresAt }`         | After a successful login or on page load with a valid session |
| `oidc:unauthenticated`   | `{ loggedOut }`               | No session (before auto-redirect, or right after logout)      |
| `oidc:callbackStart`     | `{}`                          | An authorization callback (`?code=`) is being processed       |
| `oidc:callbackError`     | `{ message }`                 | Callback validation or token exchange failed                  |
| `oidc:tokenRefreshed`    | `{ expiresAt }`                | Silent refresh succeeded                                       |
| `oidc:loggingOut`        | `{}`                          | About to redirect to `end_session_endpoint`                    |

## Usage: Vanilla JS

See `index-vanilla-js.html` for the full working example. Minimal shape:

```html
<script>
  window.OIDC_CONFIG = {
    client_id: 'demo-client',
    authorization_endpoint: 'http://localhost:3000/realms/default/authorize',
    token_endpoint: '/oidc-proxy/token',
    end_session_endpoint: 'http://localhost:3000/realms/default/logout',
    scope: 'openid profile email',
    redirect_uri: window.location.origin,
  };
</script>
<script src="/oidc_client.js"></script>

<div id="root"><p>Loading…</p></div>

<script>
  const root = document.getElementById('root');

  function render() {
    const user = window.oidcUser;
    if (!user) {
      root.innerHTML = '<p>Loading…</p>';
      return;
    }
    root.innerHTML = `<h1>Hello, ${user.name || user.preferred_username || 'there'} ${user.email || ''}</h1>`;
    const logoutButton = document.createElement('button');
    logoutButton.textContent = 'Log Out';
    logoutButton.addEventListener('click', () => window.logout());
    root.appendChild(logoutButton);
  }

  window.addEventListener('oidc:authenticated', render);
  window.addEventListener('oidc:unauthenticated', render);
  render(); // in case oidc_client.js's bootstrap already ran before this loaded
</script>
```

Key points:
- The globals (`window.oidcUser`, `window.access_token`, etc.) and events
  are the entire contract — there's no module/import to wire up.
- Call `render()` once on load in case `oidc_client.js`'s own
  `DOMContentLoaded` bootstrap already fired before your listeners were
  attached.
- Wire your logout control to `window.logout()` (e.g. `onclick="logout()"`).

## Usage: React

See `src/react/App.jsx` and `src/react/SimpleOidcPage.jsx` for the full
working example (loaded from `index-react.html`).

```jsx
import React from 'react';

class SimpleOidcPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = { user: window.oidcUser || null };
    this.sync = this.sync.bind(this);
  }

  componentDidMount() {
    window.addEventListener('oidc:authenticated', this.sync);
    window.addEventListener('oidc:unauthenticated', this.sync);
    this.sync(); // in case oidc_client.js's bootstrap already ran before this mounted
  }

  componentWillUnmount() {
    window.removeEventListener('oidc:authenticated', this.sync);
    window.removeEventListener('oidc:unauthenticated', this.sync);
  }

  sync() {
    this.setState({ user: window.oidcUser || null });
  }

  render() {
    const { user } = this.state;
    if (!user) return <p>Loading…</p>;

    return (
      <div>
        <h1>Hello, {user.name || user.preferred_username || 'there'} {user.email}</h1>
        <button onClick={() => window.logout()}>Log Out</button>
      </div>
    );
  }
}

export default SimpleOidcPage;
```

The host page (`index-react.html`) sets `window.OIDC_CONFIG` and loads
`oidc_client.js` as a plain `<script>` **before** the React bundle, then
mounts `<div id="root">` for React to render into:

```html
<script>
  window.OIDC_CONFIG = { /* ... */ };
</script>
<script src="/oidc_client.js"></script>

<div id="root"></div>
<script type="module" src="/src/react/App.jsx"></script>
```

Key points:
- React never talks to the IdP directly — it just mirrors
  `window.oidcUser` into component state via the `oidc:*` events, the same
  pattern as the vanilla version.
- `oidc_client.js` must load and run before the React entry point, since it
  populates the globals React reads on mount.
- Any component tree can subscribe to the same events; nothing here is
  React-specific beyond the `useState`/`setState` glue.
