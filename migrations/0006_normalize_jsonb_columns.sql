-- postgres.jsへJSON.stringify済み文字列を渡した旧実装で、JSONB列へ文字列として
-- 二重保存された行を本来のobject/arrayへ戻す。既に正常な行には触れない。
update drawing_versions
set content = (content #>> '{}')::jsonb
where jsonb_typeof(content) = 'string';

update command_events
set command_payload = (command_payload #>> '{}')::jsonb
where jsonb_typeof(command_payload) = 'string';

update agent_runs
set proposal = (proposal #>> '{}')::jsonb
where jsonb_typeof(proposal) = 'string';

drop trigger if exists audit_logs_no_update on audit_logs;
drop trigger if exists audit_logs_no_delete on audit_logs;

update audit_logs
set detail = (detail #>> '{}')::jsonb
where jsonb_typeof(detail) = 'string';

create trigger audit_logs_no_update
before update on audit_logs
for each row execute function reject_audit_log_mutation();

create trigger audit_logs_no_delete
before delete on audit_logs
for each row execute function reject_audit_log_mutation();
