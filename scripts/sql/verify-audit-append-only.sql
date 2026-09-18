-- 監査ログ追記専用保護(migration 0005のUPDATE/DELETE、0008のTRUNCATE)の実効性検査。
--
-- この検査は必ずROLLBACKし、検証用の合成行を一切コミットしない。
-- 以前は検証probe行をコミットしていたため、検証対象が本番DBだった場合に
-- 「トリガーにより削除できない合成監査行」が本番の監査証跡へ恒久的に混入していた
-- (2026-09-18ラウンドで mirai_web_cad への混入を実測確認。Issue #98参照)。
--
-- 検査内容:
--   1. 検証行をINSERTできる(テーブルと列定義が正常)
--   2. UPDATEが reject_audit_log_mutation() により拒否される
--   3. DELETEが拒否される
--   4. TRUNCATEが拒否される(migration 0008)
--
-- 拒否理由は「トリガ(audit_logs is append-only)」または「権限不足(permission denied for table
-- audit_logs)」のいずれでもよい。scripts/sql/harden-audit-role.sql で所有権を分離すると権限が
-- 先に拒否するため、トリガによる拒否だけを要求すると正しい状態を「保護が無効」と誤判定する。
-- どちらの理由でも『変更が許可されない』という不変条件は満たされ、成功した場合のみ失敗とする。
--
-- 拒否は「例外が起きたこと」ではなく「migration 0005 が送出する errcode 42501 と
-- メッセージ本文」で判定する。権限不足など別要因の失敗を「保護が効いている」と
-- 誤判定しないため(42501は他経路でも使われ得るため、メッセージまで確認する)。
begin;

insert into audit_logs (id, actor_id, action, target_type, target_id, detail)
values ('audit_trigger_verify_probe', 'verify', 'probe.insert', 'test', 'x', '{}'::jsonb)
on conflict (id) do nothing;

do $$
declare
  v_state text;
  v_message text;
  rejected boolean;
begin
  rejected := false;
  begin
    update audit_logs set detail = '{}'::jsonb where id = 'audit_trigger_verify_probe';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    rejected := (v_state = '42501') and (v_message like 'audit_logs is append-only%' or v_message like 'permission denied for table audit_logs%');
    if not rejected then
      raise exception 'audit_logs UPDATE failed for an unexpected reason: sqlstate=% message=%', v_state, v_message;
    end if;
  end;
  if not rejected then
    raise exception 'audit_logs UPDATE was not rejected';
  end if;

  rejected := false;
  begin
    delete from audit_logs where id = 'audit_trigger_verify_probe';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    rejected := (v_state = '42501') and (v_message like 'audit_logs is append-only%' or v_message like 'permission denied for table audit_logs%');
    if not rejected then
      raise exception 'audit_logs DELETE failed for an unexpected reason: sqlstate=% message=%', v_state, v_message;
    end if;
  end;
  if not rejected then
    raise exception 'audit_logs DELETE was not rejected';
  end if;
end
$$;

-- 3. TRUNCATEが reject_audit_log_mutation() により拒否される(migration 0008)。
--    TRUNCATEは文単位トリガで発火するため、old/newを持たない点に注意する。
--    拒否判定はUPDATE/DELETEと同じくerrcode 42501とメッセージ本文で行う。
do $$
declare
  v_state text;
  v_message text;
begin
  begin
    truncate audit_logs;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if not ((v_state = '42501') and (v_message like 'audit_logs is append-only%' or v_message like 'permission denied for table audit_logs%')) then
      raise exception 'audit_logs TRUNCATE failed for an unexpected reason: sqlstate=% message=%', v_state, v_message;
    end if;
    return;
  end;
  raise exception 'audit_logs TRUNCATE was not rejected';
end
$$;

rollback;
