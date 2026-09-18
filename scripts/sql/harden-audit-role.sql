-- 監査ログの所有権分離(改善台帳P0-78)。**DB管理者が一度だけ実行する運用操作**であり、
-- 通常のmigrationチェーンには含めない(所有権変更とロール作成は環境固有で、
-- 本番接続ロールに権限が無いため。docs/deployment-local.md の「ローカルPostgreSQL初期化」参照)。
--
-- なぜ必要か:
--   migration 0005/0008 のトリガは UPDATE/DELETE/TRUNCATE を**ロールを問わず**拒否する
--   (スーパーユーザでの実行でも拒否されることを実測確認済み)。
--   しかし所有者は `alter table audit_logs disable trigger ...` や `drop trigger ...` を
--   実行できる。トリガはDDLを止められないため、所有者権限そのものを分離する必要がある。
--   現在は `create database mirai_web_cad owner mirai_web_cad_app` のためアプリ用ロールが
--   audit_logs の所有者でもある。
--
-- 実行方法(例。ロール名は環境に合わせる):
--   sudo -u postgres psql -d mirai_web_cad \
--     -v app_role=mirai_web_cad_app \
--     -v owner_role=mirai_web_cad_audit_owner \
--     -f scripts/sql/harden-audit-role.sql
--
-- 実行後の確認:
--   npm run db:check   # audit_logs の所有者が接続ロールと異なれば警告が出ない
--
-- ロールバック:
--   alter table audit_logs owner to <app_role>;

\set ON_ERROR_STOP on

-- 専用の所有者ロール(ログイン不可。所有権の保持のみを目的とする)。
-- 注意: psql変数(`:'owner_role'`)はドル引用文字列(`$$...$$`)の内側では展開されない。
-- そのためDOブロックではなく format() + \gexec で条件付きDDLを組み立てる。
select format('create role %I nologin', :'owner_role')
where not exists (select 1 from pg_roles where rolname = :'owner_role')
\gexec

-- 監査ログの所有者を専用ロールへ移す。
alter table audit_logs owner to :"owner_role";

-- アプリ用ロールには読み取りと追記のみを許可する(変更・削除・切詰めを許可しない)。
revoke all on audit_logs from :"app_role";
grant select, insert on audit_logs to :"app_role";

-- 既定権限も絞る(将来このロールが作るオブジェクトに広い権限を付けない)。
alter default privileges for role :"owner_role" in schema public
  revoke all on tables from :"app_role";

-- 保護が有効であることを最後に確認する(変数を使わないためDOブロックでよい)。
do $$
declare
  v_enabled integer;
begin
  select count(*) into v_enabled
  from pg_trigger
  where tgrelid = 'audit_logs'::regclass and not tgisinternal and tgname like 'audit_logs_no_%' and tgenabled = 'O';
  if v_enabled <> 3 then
    raise exception 'audit_logs append-only triggers are not all enabled (found=%)', v_enabled;
  end if;
end
$$;
