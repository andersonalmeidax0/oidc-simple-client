/**
 * oidc_client.js — reusable OIDC Authorization Code + PKCE client for plain
 * HTML pages. 
 *
 * Host page contract:
 *   1. Define `window.OIDC_CONFIG` BEFORE including this script.
 *   2. Include a logout control wired as `onclick="logout()"`.
 *
 * Globals this script exposes:
 *   - window.access_token   (string|null) current access token
 *   - window.id_token       (string|null) current raw id token
 *   - window.oidcUser       (object|null) decoded id_token claims
 *   - window.login()                      start the PKCE redirect manually
 *   - window.logout()                     required logout entry point
 *
 * Events dispatched on `window` (CustomEvent):
 *   oidc:authenticated    { user, expiresAt }  — after login or silent refresh
 *   oidc:unauthenticated  {}                   — no session (pre auto-redirect, or after logout)
 *   oidc:callbackStart    {}                   — an authorization callback (?code=) is being processed
 *   oidc:callbackError    { message }          — callback validation or token exchange failed
 *   oidc:tokenRefreshed   { expiresAt }         — silent refresh succeeded
 *   oidc:loggingOut       {}                   — about to redirect to end_session_endpoint
 *
 * This page is self-contained: it uses its own URL (query string stripped)
 * as the redirect_uri, so any page that includes this script becomes its own
 * callback target — no server-side route for a separate /auth/callback path
 * is needed.
 * 
 * Use in react: 
 *  - include  the script in HTML.
 *  - in HTML create window.OIDC_CONFIG  variable
 *  - the script automatically, on page load, will: 
 *      a.calls "initPageStateListener"
 *      b.start the listener: it is responsible for check if has auth cookie, redirects, and responde callback base on url parameters check
 *      c.automatically calls window.logon() if needed
 *  - add your listers to events in React components: authenticated,  then get id_token, oidcUser; unauthenticated: handle properly
 *  - call window.logout() from your react component to implement logout.
 */
(function () {
  'use strict';

  const SELF_URL = window.location.origin + window.location.pathname;
  const STORAGE_KEY = 'oidc_auth';

  const userConfig = window.OIDC_CONFIG || {};
  const CONFIG = {
    client_id: userConfig.client_id,
    redirect_uri: userConfig.redirect_uri,
    post_logout_redirect_uri: SELF_URL + '?logged_out=1',
    authorization_endpoint: userConfig.authorization_endpoint,
    token_endpoint: userConfig.token_endpoint,
    end_session_endpoint: userConfig.end_session_endpoint,
    scope: userConfig.scope || 'openid profile email',
    refresh_buffer_seconds: userConfig.refresh_buffer_seconds || 60,
    autoLogin: userConfig.autoLogin !== false,
  };

  // --- PKCE helpers ---
  function generateRandomString(length = 64) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const values = new Uint8Array(length);
    window.crypto.getRandomValues(values);
    return Array.from(values, (v) => possible[v % possible.length]).join('');
  }

  function base64UrlEncode(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let str = '';
    for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function generateCodeChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return base64UrlEncode(digest);
  }

  // Decodes the id_token payload for display only — not signature
  // verification. Safe here because the token came straight from the token
  // endpoint over TLS in this exchange; never trust an id_token read from
  // elsewhere (e.g. the URL) without verifying it server-side.
  function decodeIdToken(idToken) {
    try {
      const payload = idToken.split('.')[1];
      const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(decodeURIComponent(escape(json)));
    } catch {
      return null;
    }
  }

  // Never log raw tokens — only their length/shape — so a shared console
  // capture or a malicious extension watching devtools can't lift secrets.
  function redactToken(token) {
    return token ? `<redacted, ${token.length} chars>` : token;
  }

  function log(step, detail) {
    if (detail !== undefined) {
      console.log(`[OIDC] ${step}`, detail);
    } else {
      console.log(`[OIDC] ${step}`);
    }
  }

  // Updates the documented globals and fires a CustomEvent on window.
  // access_token is a deliberate global, per the host contract — any script
  // on the page can read it, so don't load untrusted 3rd-party scripts
  // alongside a page that uses this library.
  function dispatch(name, detail, authData) {
    window.access_token = authData ? authData.accessToken : null;
    window.id_token = authData ? authData.idToken : null;
    window.oidcUser = authData ? authData.user : null;
    window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }

  // --- storage ---
  function getStoredAuth() {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  }

  function setStoredAuth(authData) {
    if (authData) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(authData));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }

  // --- auth service ---
  const AuthService = {
    refreshTimer: null,

    async login() {
      log('(1a)1. Login initiated — generating PKCE code_verifier/code_challenge');
      const codeVerifier = generateRandomString(64);
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      const state = generateRandomString(16);
      log('(1b)2. PKCE parameters generated', { code_challenge: codeChallenge, code_challenge_method: 'S256', state });

      sessionStorage.setItem('pkce_code_verifier', codeVerifier);
      sessionStorage.setItem('pkce_state', state);
      log('(1c)3. Stored code_verifier + state in sessionStorage for later validation');

      const params = new URLSearchParams({
        client_id: CONFIG.client_id,
        redirect_uri: CONFIG.redirect_uri,
        response_type: 'code',
        scope: CONFIG.scope,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      const authUrl = `${CONFIG.authorization_endpoint}?${params.toString()}`;
      log('(1d)4. Redirecting to authorization endpoint', authUrl);
      window.location.href = authUrl;
    },

    async handleAuthorizationResponse(searchParams) {
      dispatch('oidc:callbackStart');
      log('(2a)5. Authorization callback received', Object.fromEntries(searchParams));
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const authError = searchParams.get('error');

      const savedVerifier = sessionStorage.getItem('pkce_code_verifier');
      const savedState = sessionStorage.getItem('pkce_state');
      sessionStorage.removeItem('pkce_code_verifier');
      sessionStorage.removeItem('pkce_state');

      if (authError) {
        log('Authorization error returned by IdP', authError);
        throw new Error(searchParams.get('error_description') || authError);
      }
      log('Validating state against stored PKCE state...');
      if (!state || state !== savedState) {
        log('State mismatch! Possible CSRF — aborting.');
        throw new Error('State mismatch error (possible CSRF attack).');
      }
      if (!code || !savedVerifier) {
        throw new Error('Invalid callback: missing code or PKCE verifier.');
      }
      log('State verified OK');

      log('(2b)6. Exchanging authorization_code for tokens (POST token_endpoint)');

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CONFIG.client_id,
        redirect_uri: CONFIG.redirect_uri,
        code,
        code_verifier: savedVerifier,
      });

      const response = await fetch(CONFIG.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (!response.ok) {
        const text = await response.text();
        log('Token endpoint returned an error', { status: response.status, body: text });
        throw new Error(`Token endpoint returned ${response.status}: ${text}`);
      }

      const tokens = await response.json();
      this.handleLoginSuccess(tokens);
    },

    handleLoginSuccess(tokens) {
      const { access_token, refresh_token, id_token, expires_in } = tokens;
      const expiresAt = Date.now() + expires_in * 1000;
      const user = id_token ? decodeIdToken(id_token) : null;
      log('(3a)7. Login success — storing session', {
        access_token: redactToken(access_token),
        refresh_token: redactToken(refresh_token),
        id_token_claims: user,
        expiresAt: new Date(expiresAt).toLocaleTimeString(),
      });

      const authData = { accessToken: access_token, refreshToken: refresh_token, idToken: id_token, user, expiresAt };
      setStoredAuth(authData);
      dispatch('oidc:authenticated', { user, expiresAt }, authData);
      this.scheduleTokenRefresh(expiresAt);
      return authData;
    },

    clearRefreshTimer() {
      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = null;
      }
    },

    scheduleTokenRefresh(expiresAt) {
      this.clearRefreshTimer();

      const bufferMs = (CONFIG.refresh_buffer_seconds || 60) * 1000;
      const delay = Math.max(0, expiresAt - Date.now() - bufferMs);

      log(`8. Scheduling silent refresh in ${Math.round(delay / 1000)}s (expires ${new Date(expiresAt).toLocaleTimeString()})`);
      this.refreshTimer = setTimeout(() => this.performSilentTokenRefresh(), delay);
    },

    async performSilentTokenRefresh() {
      log('9. Silent refresh timer fired');
      const authData = getStoredAuth();
      if (!authData || !authData.refreshToken) {
        log('No refresh token available, forcing logout');
        this.forceLogout();
        return;
      }

      log('10. Requesting new tokens with refresh_token grant');
      log('10b-a:'+JSON.stringify(authData,null,2))
      try {
        const body = new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: CONFIG.client_id,
          refresh_token: authData.refreshToken,
        });

        const response = await fetch(CONFIG.token_endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });

        if (!response.ok) throw new Error('Refresh token request failed');

        const tokens = await response.json();
        log('11. Refresh succeeded, received new tokens', {
          access_token: redactToken(tokens.access_token),
          refresh_token: redactToken(tokens.refresh_token),
          expires_in: tokens.expires_in,
        });
        const newAuthData = this.handleLoginSuccess(tokens);
        dispatch('oidc:tokenRefreshed', { expiresAt: newAuthData.expiresAt }, newAuthData);
      } catch (err) {
        console.error('[OIDC] Silent refresh failed:', err);
        this.forceLogout();
      }
    },

    logout() {
      log('Logout initiated');
      dispatch('oidc:loggingOut');
      this.clearRefreshTimer();
      const idToken = getStoredAuth()?.idToken;
      setStoredAuth(null);
      sessionStorage.clear();
      log('Cleared local session (sessionStorage, refresh timer)');

      const params = new URLSearchParams({
        client_id: CONFIG.client_id,
        post_logout_redirect_uri: CONFIG.post_logout_redirect_uri,
        ...(idToken ? { id_token_hint: idToken } : {}),
      });

      const logoutUrl = `${CONFIG.end_session_endpoint}?${params.toString()}`;
      log('Redirecting to end_session_endpoint', logoutUrl);
      window.location.href = logoutUrl;
    },

    forceLogout() {
      log('Forced logout (missing/invalid refresh token or refresh failure)');
      this.clearRefreshTimer();
      setStoredAuth(null);
      window.history.replaceState({}, '', SELF_URL);
      dispatch('oidc:unauthenticated');
    },
  };

  // --- bootstrap ---
  function initPageStateListener() {
    const params = new URLSearchParams(window.location.search);

    if (params.has('code') || params.has('error')) {
      AuthService.handleAuthorizationResponse(params)
        .then(() => {
          window.history.replaceState({}, '', SELF_URL);
        })
        .catch((err) => {
          dispatch('oidc:callbackError', { message: err.message });
        });
      return;
    }

    // post_logout_redirect_uri (see CONFIG above) always points back here
    // with this marker. A page load carrying it means "the user just
    // deliberately logged out" — auto-login must not immediately bounce
    // them back into the IdP, or a logout button could never show its
    // confirmation state.
    if (params.has('logged_out')) {
      log('Loaded with logged_out marker — suppressing auto-login');
      dispatch('oidc:unauthenticated', { loggedOut: true });
      return;
    }

    const authData = getStoredAuth();
    if (authData) {
      dispatch('oidc:authenticated', { user: authData.user, expiresAt: authData.expiresAt }, authData);
      AuthService.scheduleTokenRefresh(authData.expiresAt);
    } else {
      dispatch('oidc:unauthenticated', { loggedOut: false });
      if (CONFIG.autoLogin) {
        AuthService.login();
      }
    }
  }

  window.login = () => AuthService.login();
  window.logout = () => AuthService.logout();
  window.access_token = getStoredAuth()?.accessToken || null;
  window.id_token = getStoredAuth()?.idToken || null;
  window.oidcUser = getStoredAuth()?.user || null;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPageStateListener);
  } else {
    initPageStateListener();
  }
})();
