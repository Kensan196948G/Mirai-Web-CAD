-- 案件(project)単位のアクセス制御を追加する。
-- 既存のprojectsは全てaccess_scope='open'のまま据え置き、現行の単一案件運用の
-- 挙動を一切変更しない(認証済みの全ロールが引き続き閲覧可能)。
-- 新規案件をrestrictedで作成した場合のみ、project_membersに登録された利用者
-- (またはcad_admin)だけが図面の閲覧・編集・承認等を行える。

alter table projects
  add column if not exists access_scope text not null default 'open';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'projects_access_scope_check'
  ) then
    alter table projects
      add constraint projects_access_scope_check check (access_scope in ('open', 'restricted'));
  end if;
end $$;

create table if not exists project_members (
  project_id text not null references projects(id) on delete cascade,
  member text not null,
  added_by text not null,
  created_at timestamptz not null default now(),
  primary key (project_id, member)
);

create index if not exists idx_project_members_member on project_members(member);
