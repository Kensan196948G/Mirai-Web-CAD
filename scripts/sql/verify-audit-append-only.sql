-- 監査ログ追記専用保護(migration 0005)の実効性検査。
--
-- この検査は必ずROLLBACKし、検証用の合成行を一切コミットしない。
-- 以前は検証probe行をコミットしていたため、検証対象が本番DBだった場合に
-- 「トリガーにより削除できない合成監査行」が本番の監査証跡へ恒久的に混入していた
-- (2026-09-18ラウンドで mirai_web_cad への混入を実測確認。Issue #98参照)。
--
-- 検査内容:
--   1. 検証行をINSERTできる(テーブルと列定義が正常)
--   2. UPDATEがトリガーにより拒否される
--   3. DELETEがトリガーにより拒否される
-- UPDATE/DELETEが成功してしまう場合は、明示的に例外を送出して検証を失敗させる。
begin;

insert into audit_logs (id, actor_id, action, target_type, target_id, detail)
values ('audit_trigger_verify_probe', 'verify', 'probe.insert', 'test', 'x', '{}'::jsonb)
on conflict (id) do nothing;

do $$
declare
  rejected boolean;
begin
  rejected := false;
  begin
    update audit_logs set detail = '{}'::jsonb where id = 'audit_trigger_verify_probe';
  exception when others then
    rejected := true;
  end;
  if not rejected then
    raise exception 'audit_logs UPDATE was not rejected';
  end if;

  rejected := false;
  begin
    delete from audit_logs where id = 'audit_trigger_verify_probe';
  exception when others then
    rejected := true;
  end;
  if not rejected then
    raise exception 'audit_logs DELETE was not rejected';
  end if;
end
$$;

rollback;
