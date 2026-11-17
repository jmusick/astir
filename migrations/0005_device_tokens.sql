-- Native apps sign in through the browser (D28). A handoff is a one-time code the signed-in web
-- page makes for a waiting app; the app redeems it with the PKCE verifier only it holds, within
-- minutes, for a long-lived, revocable device token (D28, D44).
CREATE TABLE app_handoffs (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- base64url SHA-256 of the app's verifier.
  challenge TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX app_handoffs_user ON app_handoffs(user_id);

-- Like browser_sessions: the token is a JWT naming one row, checked on every request, so revoking
-- the row or bumping users.token_version (password reset) cuts the device off.
CREATE TABLE device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_version INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX device_tokens_user ON device_tokens(user_id);
