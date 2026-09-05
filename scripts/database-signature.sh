#!/usr/bin/env bash
set -euo pipefail

database_url="${DATABASE_SIGNATURE_URL:-${1:-}}"
if [[ -z "$database_url" ]]; then
  echo "DATABASE_SIGNATURE_URL or a database URL argument is required" >&2
  exit 2
fi

pg_bin="${PG_BIN:-$(pg_config --bindir)}"
"${pg_bin}/psql" "$database_url" -v ON_ERROR_STOP=1 -At -F '|' -c "
  select
    (select count(*) from projects),
    (select count(*) from drawings),
    (select count(*) from drawing_versions),
    (select count(*) from audit_logs),
    coalesce((
      select md5(string_agg(
        concat_ws(':', d.id, d.current_version, v.version_no, v.content_hash),
        E'\\n' order by d.id
      ))
      from drawings d
      join drawing_versions v
        on v.drawing_id = d.id and v.version_no = d.current_version
    ), md5(''))
"
