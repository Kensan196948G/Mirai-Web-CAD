-- Prevent duplicate execution of mutating API requests.

create table if not exists idempotency_keys (
  key text primary key,
  actor_id text not null,
  route text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_idempotency_keys_created_at
  on idempotency_keys(created_at desc);
