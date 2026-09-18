-- Mirai Web CAD: 監査ログの追記専用保護をTRUNCATEまで広げ、保護の存在を再保証する。
-- Re-runnable on an empty or already-migrated database.
--
-- 背景(改善台帳P0-78、2026-09-18の独立監査で確定):
-- 1. migration 0005 は UPDATE/DELETE を拒否するが TRUNCATE を拒否しない。
--    アプリ用ロールは `create database ... owner mirai_web_cad_app` のため audit_logs の
--    所有者でもあり、TRUNCATE と `alter table ... disable trigger` が可能だった。
--    → TRUNCATE を拒否する文(ステートメント)トリガを追加する。
-- 2. migration 0006 は audit_logs.detail を正規化するため追記専用トリガを一時 drop する。
--    `db:verify`は`psql -1`(単一トランザクション)で適用するため中間状態はコミットされないが、
--    手動適用など中断し得る経路では保護が欠けたまま残り得る。
--    → 本migrationの最後で3トリガすべてを冪等に再作成し、後続の適用で必ず回復させる。
--
-- 注意(残余リスク): 所有者権限を持つロールは `alter table ... disable trigger` を実行できる。
-- トリガではDDLを防げないため、これは別ロールへの所有権移動と権限分離で対処する
-- (`scripts/sql/harden-audit-role.sql` を参照。DB管理者の承認が必要な運用操作)。

create or replace function reject_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs is append-only: % is not permitted (id=%)', tg_op, coalesce(old.id, new.id)
    using errcode = '42501';
end;
$$;

-- TRUNCATEは行単位ではなく文単位で発火するため for each statement を使う。
-- old/new は存在しないので、上記関数の coalesce(old.id, new.id) は NULL になるが、
-- メッセージの接頭辞 `audit_logs is append-only` と errcode 42501 は同じまま保たれる。
drop trigger if exists audit_logs_no_truncate on audit_logs;
create trigger audit_logs_no_truncate
  before truncate on audit_logs
  for each statement
  execute function reject_audit_log_mutation();

-- UPDATE/DELETE の保護を冪等に再保証する(0006中断時の回復経路)。
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
