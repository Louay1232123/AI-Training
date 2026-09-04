-- Cricket Polls schema.
-- Channel-agnostic by design: nothing here knows about browsers, bots or apps.
-- A voter is identified by an opaque `voter_id` string namespaced by `channel`.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS polls (
  id          TEXT PRIMARY KEY,
  question    TEXT NOT NULL,
  match_name  TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'live', 'closed')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  closes_at   TEXT,
  closed_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_polls_status_created
  ON polls (status, created_at DESC);

CREATE TABLE IF NOT EXISTS poll_options (
  id        TEXT PRIMARY KEY,
  poll_id   TEXT NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  label     TEXT NOT NULL,
  position  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_poll_options_poll
  ON poll_options (poll_id, position);

CREATE TABLE IF NOT EXISTS votes (
  id         TEXT PRIMARY KEY,
  poll_id    TEXT NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  option_id  TEXT NOT NULL REFERENCES poll_options (id) ON DELETE CASCADE,
  voter_id   TEXT NOT NULL,
  channel    TEXT NOT NULL DEFAULT 'web',
  ip_hash    TEXT,
  created_at TEXT NOT NULL
);

-- The hard double-vote guard: one vote per identity per poll. `channel` is part
-- of the key so the same raw id from two channels (a Telegram user id that
-- happens to collide with a device id) is never treated as the same person.
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_unique_voter
  ON votes (poll_id, channel, voter_id);

CREATE INDEX IF NOT EXISTS idx_votes_poll_option
  ON votes (poll_id, option_id);

-- Soft backup guard: used to count how many votes came from one network on a
-- poll. Deliberately not a unique index -- a whole stand shares one stadium NAT.
CREATE INDEX IF NOT EXISTS idx_votes_poll_ip
  ON votes (poll_id, ip_hash);
