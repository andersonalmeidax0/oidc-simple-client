// npm install jsonwebtoken
//
// Server-side JWT validation for tokens issued by the IdP configured in
// OIDC_CONFIG. The browser-side oidc_client.js only *decodes* the id_token
// for display — it never verifies anything. Any backend that receives an
// access_token/id_token (e.g. via an `Authorization: Bearer <token>`
// header) must independently verify its signature, issuer, and audience
// before trusting its claims.
const fs = require('fs/promises');
const jwt = require('jsonwebtoken');

const ISSUER = 'https://idp.example.com/realms/default'; // must match the token's "iss" claim exactly
const AUDIENCE = 'demo-client'; // must match the token's "aud" claim (usually the client_id)
const PUBLIC_KEY_PATH = './idp-public-key.pem'; // IdP's RS256 public key, exported to a file

let publicKey; // cached after first read

async function loadPublicKey() {
  if (!publicKey) {
    publicKey = await fs.readFile(PUBLIC_KEY_PATH, 'utf8');
  }
  return publicKey;
}

// Verifies signature, expiry, issuer, and audience; throws if any fail.
async function validateToken(token) {
  const key = await loadPublicKey();
  return jwt.verify(token, key, {
    algorithms: ['RS256'],
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

// Example Express middleware
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  try {
    req.user = await validateToken(token);
    next();
  } catch (err) {
    res.status(401).json({ error: `Invalid token: ${err.message}` });
  }
}

module.exports = { validateToken, requireAuth };
