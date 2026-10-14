CREATE TABLE users (
  id           INTEGER PRIMARY KEY,
  settings     TEXT    NOT NULL DEFAULT '{}',
  month_target REAL    NOT NULL DEFAULT 100000,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE operations (
  id         TEXT    NOT NULL,
  user_id    INTEGER NOT NULL,
  type       TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
  name       TEXT    NOT NULL,
  amount     REAL    NOT NULL CHECK (amount > 0),
  category   TEXT,
  date       TEXT    NOT NULL,
  source     TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX idx_ops_user_date    ON operations (user_id, date);
CREATE INDEX idx_ops_user_created ON operations (user_id, created_at);

CREATE TABLE processed_updates (
  update_id INTEGER PRIMARY KEY,
  at        INTEGER NOT NULL
);

CREATE TABLE rate_limits (
  user_id INTEGER NOT NULL,
  scope   TEXT    NOT NULL,
  minute  INTEGER NOT NULL,
  count   INTEGER NOT NULL,
  PRIMARY KEY (user_id, scope, minute)
);
