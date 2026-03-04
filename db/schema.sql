CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  github_owner VARCHAR(255) NOT NULL,
  github_repo VARCHAR(255) NOT NULL,
  notion_database_id VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  key_name VARCHAR(100) NOT NULL,
  encrypted_value TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, key_name)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  github_issue_number INTEGER NOT NULL,
  task_type TEXT NOT NULL,
  repo_owner VARCHAR(255),
  repo_name VARCHAR(255),
  payload JSONB,
  github_issue_url TEXT,
  github_labels JSONB,
  notion_status TEXT,
  last_event TEXT,
  last_event_at TIMESTAMP,
  notion_page_id VARCHAR(255),
  status TEXT NOT NULL DEFAULT 'pending',
  complexity TEXT,
  plan_text TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_issue_number ON tasks(github_issue_number);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_dedupe ON tasks(project_id, github_issue_number, task_type);

CREATE TABLE IF NOT EXISTS task_logs (
  id SERIAL PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  event TEXT NOT NULL,
  complexity TEXT,
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plan_history (
  id SERIAL PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  plan_text TEXT NOT NULL,
  complexity TEXT,
  attempt_number INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);
