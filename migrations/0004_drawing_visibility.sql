-- Make anonymous publication explicit. New and existing drawings remain private by default.

alter table drawings
  add column if not exists visibility text not null default 'private';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'drawings_visibility_check'
  ) then
    alter table drawings
      add constraint drawings_visibility_check check (visibility in ('private', 'public'));
  end if;
end $$;

update drawings
set visibility = 'public',
    name = '道路拡幅 仮設施工図'
where id = 'dwg_demo_001';
