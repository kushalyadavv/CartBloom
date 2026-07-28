-- CartBloom schema.
--
-- D1 is SQLite. Every table is queried by shop, and `shops` is read on the
-- session path of every admin request -- which is measured against a 10 ms CPU
-- cap, so the primary key lookup has to be the whole cost.

CREATE TABLE IF NOT EXISTS shops (
  shop             TEXT PRIMARY KEY,
  -- Offline and expiring. Non-expiring tokens are rejected by the Admin API.
  access_token     TEXT NOT NULL,
  scope            TEXT,
  -- Cached from the Partner API. Querying it per request would cost more than
  -- the entire CPU budget and add a network round trip to every page load.
  plan             TEXT,
  plan_checked_at  INTEGER,
  -- Exactly one per shop. The 25 automatic-app-discount cap is shared with
  -- every other app the merchant has installed.
  discount_node_id TEXT,
  -- Gates one-time webhook registration so it cannot run twice or be missed.
  webhooks_registered_at INTEGER,
  installed_at     INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  shop          TEXT NOT NULL,
  state         TEXT,
  is_online     INTEGER NOT NULL DEFAULT 0,
  scope         TEXT,
  expires       INTEGER,
  access_token  TEXT,
  user_id       TEXT
);
CREATE INDEX IF NOT EXISTS sessions_by_shop ON sessions(shop);

CREATE TABLE IF NOT EXISTS offers (
  id          TEXT PRIMARY KEY,
  shop        TEXT NOT NULL,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL,   -- DRAFT | PUBLISHED | PAUSED
  -- The verbose offer as JSON. Compact encoding happens at publish; storing it
  -- verbose keeps drafts readable and diffable.
  config      TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS offers_by_shop ON offers(shop, status);

-- Publishing overwrites a live storefront promotion. Keeping versions makes
-- "undo my last publish" a supported action rather than a support ticket.
CREATE TABLE IF NOT EXISTS published_versions (
  shop          TEXT NOT NULL,
  version_hash  TEXT NOT NULL,
  payload       TEXT NOT NULL,
  published_at  INTEGER NOT NULL,
  PRIMARY KEY (shop, version_hash)
);
