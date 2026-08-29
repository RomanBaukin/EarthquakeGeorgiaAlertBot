CREATE TABLE chat (
  id         INTEGER PRIMARY KEY,
  type       TEXT NOT NULL,
  title      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE subscription (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id        INTEGER NOT NULL UNIQUE REFERENCES chat(id),
  active         INTEGER NOT NULL DEFAULT 1,
  min_magnitude  REAL NOT NULL DEFAULT 0,
  region_keyword TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE earthquake_event (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key      TEXT NOT NULL UNIQUE,
  source_time_raw TEXT NOT NULL,
  source_time     TEXT NOT NULL,
  magnitude       REAL NOT NULL,
  depth_km        REAL,
  latitude        REAL,
  longitude       REAL,
  coordinates_raw TEXT NOT NULL,
  region          TEXT NOT NULL,
  notified_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_earthquake_event_source_time ON earthquake_event(source_time DESC);
CREATE INDEX idx_earthquake_event_pending ON earthquake_event(notified_at);
