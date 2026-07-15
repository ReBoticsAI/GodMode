PRAGMA foreign_keys = ON;

CREATE TABLE departments (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  icon TEXT NOT NULL,
  base_path TEXT NOT NULL UNIQUE,
  built_in INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE divisions (
  id TEXT NOT NULL,
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  icon TEXT NOT NULL,
  base_path TEXT NOT NULL UNIQUE,
  right_sidebar TEXT,
  built_in INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (department_id, id)
);
CREATE TABLE division_pages (
  id TEXT NOT NULL,
  division_id TEXT NOT NULL,
  department_id TEXT NOT NULL,
  label TEXT NOT NULL,
  icon TEXT NOT NULL,
  segment TEXT NOT NULL DEFAULT '',
  page_kind TEXT NOT NULL,
  built_in INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (department_id, division_id, id),
  FOREIGN KEY (department_id, division_id)
    REFERENCES divisions(department_id, id) ON DELETE CASCADE
);
CREATE TABLE ai_agents (id TEXT PRIMARY KEY);
CREATE TABLE ai_agent_assignments (
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  PRIMARY KEY (scope_type, scope_id)
);
CREATE TABLE structure_nodes (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES structure_nodes(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  icon TEXT NOT NULL,
  segment TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'placeholder',
  right_sidebar TEXT,
  agent_id TEXT,
  built_in INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE sc_levels (
  symbol TEXT NOT NULL,
  label TEXT NOT NULL,
  price REAL NOT NULL,
  kind TEXT,
  chart_number INTEGER,
  study_id INTEGER,
  subgraph_index INTEGER,
  ts TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (symbol, label)
);

INSERT INTO departments VALUES ('trading', 'Trading', 'chart', '/trading', 1, 0);
INSERT INTO divisions VALUES
  ('sierra', 'trading', 'Sierra', 'activity', '/trading/sierra', NULL, 1, 0);
INSERT INTO division_pages VALUES
  ('dashboard', 'sierra', 'trading', 'Dashboard', 'layout', '', 'sierra-dashboard', 1, 0),
  ('journal', 'sierra', 'trading', 'Journal', 'book', 'journal', 'journal', 0, 1);
INSERT INTO ai_agents VALUES ('dept-trading'), ('custom-agent');
INSERT INTO ai_agent_assignments VALUES
  ('department', 'trading', 'dept-trading'),
  ('page', 'custom-page', 'custom-agent');
INSERT INTO structure_nodes
  (id, parent_id, label, icon, segment, kind, built_in, sort_order)
VALUES
  ('custom-root', NULL, 'Custom Root', 'star', 'custom', 'custom-page', 0, 99);
INSERT INTO sc_levels
  (symbol, label, price, kind, chart_number, study_id, subgraph_index, ts)
VALUES
  ('ES', 'VWAP', 5500.25, 'study', 2, 10, 0, '2026-01-01T00:00:00Z'),
  ('NQ', 'Prior High', 20100.5, 'reference', 3, 11, 1, '2026-01-01T00:00:01Z');
