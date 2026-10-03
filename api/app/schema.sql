PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  homepage TEXT,
  retrieval_method TEXT,
  last_success_at TEXT
);

CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  group_id TEXT NOT NULL,
  unit TEXT NOT NULL,
  frequency TEXT NOT NULL,
  source_id TEXT REFERENCES sources(id),
  status TEXT NOT NULL DEFAULT 'pending',
  parent_id TEXT REFERENCES series(id),
  display_order INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT
);

CREATE TABLE IF NOT EXISTS observations (
  series_id TEXT NOT NULL REFERENCES series(id),
  observed_on TEXT NOT NULL,
  value REAL NOT NULL,
  symbol TEXT,
  source_record_id TEXT,
  published_at TEXT NOT NULL,
  PRIMARY KEY (series_id, observed_on)
);
CREATE INDEX IF NOT EXISTS observations_lookup ON observations (series_id, observed_on DESC);

CREATE TABLE IF NOT EXISTS market_prices (
  ins_code TEXT NOT NULL,
  observed_on TEXT NOT NULL,
  adjustment TEXT NOT NULL CHECK (adjustment IN ('raw', 'adjusted')),
  open REAL,
  high REAL,
  low REAL,
  close REAL NOT NULL,
  final REAL,
  previous_close REAL,
  volume REAL,
  traded_value REAL,
  trades REAL,
  raw_payload TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (ins_code, observed_on, adjustment)
);
CREATE INDEX IF NOT EXISTS market_prices_lookup ON market_prices (ins_code, adjustment, observed_on DESC);

CREATE TABLE IF NOT EXISTS bond_instruments (
  source_instrument_id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  security_title TEXT NOT NULL DEFAULT '',
  bond_type TEXT NOT NULL CHECK (bond_type IN ('treasury', 'coupon')),
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bond_yield_observations (
  source_instrument_id TEXT NOT NULL REFERENCES bond_instruments(source_instrument_id),
  observed_on TEXT NOT NULL,
  jalali_observed_on TEXT NOT NULL,
  last_traded_price REAL NOT NULL,
  maturity_on TEXT NOT NULL,
  jalali_maturity_on TEXT NOT NULL,
  ytm REAL NOT NULL,
  simple_return REAL,
  raw_payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (source_instrument_id, observed_on)
);
CREATE INDEX IF NOT EXISTS bond_yields_lookup ON bond_yield_observations (source_instrument_id, observed_on DESC);

CREATE TABLE IF NOT EXISTS bond_market_history (
  source_instrument_id TEXT NOT NULL REFERENCES bond_instruments(source_instrument_id),
  tsetmc_ins_code TEXT NOT NULL,
  observed_on TEXT NOT NULL,
  jalali_observed_on TEXT NOT NULL,
  last_traded_price REAL NOT NULL,
  maturity_on TEXT NOT NULL,
  jalali_maturity_on TEXT NOT NULL,
  ytm REAL NOT NULL,
  volume REAL NOT NULL DEFAULT 0,
  traded_value REAL NOT NULL DEFAULT 0,
  raw_payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (source_instrument_id, observed_on)
);
CREATE INDEX IF NOT EXISTS bond_market_history_lookup ON bond_market_history (source_instrument_id, observed_on DESC);

CREATE TABLE IF NOT EXISTS macro_observations (
  series_id TEXT NOT NULL REFERENCES series(id),
  observed_on TEXT NOT NULL,
  jalali_date TEXT NOT NULL,
  value REAL NOT NULL,
  source_record_id TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (series_id, observed_on)
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES sources(id),
  ins_code TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  rows_received INTEGER NOT NULL DEFAULT 0,
  rows_accepted INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT,
  event_type TEXT NOT NULL,
  source_url TEXT,
  evidence TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);
