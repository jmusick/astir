CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Browser JWTs identify one revocable server-side session, never a stand-alone credential.
CREATE TABLE browser_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_version INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX browser_sessions_user ON browser_sessions(user_id);

CREATE TABLE email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  claim_id TEXT,
  UNIQUE (user_id, purpose)
);

CREATE TABLE auth_events (
  id INTEGER PRIMARY KEY,
  event_type TEXT NOT NULL,
  email TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX auth_events_ip ON auth_events(event_type, ip, created_at);
CREATE INDEX auth_events_email ON auth_events(event_type, email, created_at);

-- The same atomic lockout applies to registered and unregistered addresses.
CREATE TABLE login_attempts (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
