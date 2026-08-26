-- Add an atomic optimistic-lock revision separate from the drawing version.

alter table drawings
  add column if not exists revision integer not null default 1;
