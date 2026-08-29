-- Mirai Web CAD: audit_logs を追記専用にするDBレベルの保護。
-- Re-runnable on an empty or already-migrated database.
--
-- 背景 (production-readiness-assessment.md 弱み: 高):
-- 監査ログが追記専用としてDB権限分離されていない -> DB権限保有者による改変を抑止できない。
-- このmigrationはUPDATE/DELETEをトリガーで拒否し、アプリケーションコードやDB接続元の
-- 権限に関わらず、既存の監査ログ行を不変にする。INSERTは従来通り許可する。

create or replace function reject_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs is append-only: % is not permitted (id=%)', tg_op, coalesce(old.id, new.id)
    using errcode = '42501';
end;
$$;

drop trigger if exists audit_logs_no_update on audit_logs;
create trigger audit_logs_no_update
  before update on audit_logs
  for each row
  execute function reject_audit_log_mutation();

drop trigger if exists audit_logs_no_delete on audit_logs;
create trigger audit_logs_no_delete
  before delete on audit_logs
  for each row
  execute function reject_audit_log_mutation();
