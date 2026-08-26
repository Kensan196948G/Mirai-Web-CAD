-- Mirai Web CAD MVP initial schema for Neon PostgreSQL.
-- Re-runnable on an empty database. Existing objects are left intact.

create table if not exists projects (
  id text primary key,
  name text not null,
  owner text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists drawings (
  id text primary key,
  project_id text not null references projects(id),
  name text not null,
  unit text not null default 'mm',
  current_version integer not null default 1,
  revision integer not null default 1,
  state text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drawings_state_check check (state in ('draft', 'in_review', 'rejected', 'approved', 'deprecated'))
);

create table if not exists drawing_versions (
  id text primary key,
  drawing_id text not null references drawings(id),
  version_no integer not null,
  state text not null default 'draft',
  content jsonb not null,
  content_hash text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (drawing_id, version_no),
  constraint drawing_versions_state_check check (state in ('draft', 'in_review', 'rejected', 'approved', 'deprecated'))
);

create table if not exists command_events (
  id text primary key,
  drawing_version_id text not null references drawing_versions(id),
  source text not null,
  actor_id text not null,
  label text not null,
  command_payload jsonb not null,
  before_hash text not null,
  after_hash text not null,
  created_at timestamptz not null default now(),
  constraint command_events_source_check check (source in ('user', 'agent', 'system', 'approval'))
);

create table if not exists agent_runs (
  id text primary key,
  drawing_version_id text not null references drawing_versions(id),
  status text not null,
  prompt text not null,
  skill_id text,
  skill_version text,
  proposal jsonb,
  risk text,
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint agent_runs_status_check check (
    status in ('received', 'needs_input', 'planned', 'previewed', 'user_approved', 'executing', 'completed', 'rejected', 'failed', 'rolled_back')
  )
);

create table if not exists reviews (
  id text primary key,
  drawing_version_id text not null references drawing_versions(id),
  status text not null,
  reviewer_id text not null,
  comment text,
  created_at timestamptz not null default now(),
  constraint reviews_status_check check (status in ('submitted', 'commented', 'approved', 'rejected'))
);

create table if not exists audit_logs (
  id text primary key,
  actor_id text not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_drawings_project_id on drawings(project_id);
create index if not exists idx_versions_drawing_id on drawing_versions(drawing_id);
create index if not exists idx_command_events_version_id on command_events(drawing_version_id);
create index if not exists idx_agent_runs_version_id on agent_runs(drawing_version_id);
create index if not exists idx_audit_logs_target on audit_logs(target_type, target_id, created_at desc);
