-- Mirai Web CAD demo seed.
-- Safe to re-run after migration 0001; rows are upserted by primary key.

insert into projects (id, name, owner, status)
values ('prj_demo_road_001', '道路拡幅デモ案件', 'mirai-demo', 'active')
on conflict (id) do nothing;

insert into drawings (id, project_id, name, unit, current_version, state)
values ('dwg_demo_001', 'prj_demo_road_001', '道路拡幅 仮設施工図', 'mm', 1, 'draft')
on conflict (id) do nothing;

insert into drawing_versions (id, drawing_id, version_no, state, content, content_hash, created_by)
values (
  'ver_demo_001_001',
  'dwg_demo_001',
  1,
  'draft',
  '{
    "unit": "mm",
    "schemaVersion": 1,
    "version": 1,
    "revision": 1,
    "state": "draft",
    "currentRole": "drafter",
    "layers": [
      {"id":"layer-frame","name":"図枠","color":"#5b6b7a","visible":true,"locked":false,"printable":true},
      {"id":"layer-center","name":"中心線","color":"#d14f4f","visible":true,"locked":false,"printable":true},
      {"id":"layer-structure","name":"構造物","color":"#1574b8","visible":true,"locked":false,"printable":true},
      {"id":"layer-temporary","name":"仮設","color":"#1e946f","visible":true,"locked":false,"printable":true},
      {"id":"layer-annotation","name":"注記","color":"#a26a1d","visible":true,"locked":false,"printable":true}
    ],
    "entities": [
      {"id":"e_frame_1","type":"line","layerId":"layer-frame","points":[{"x":0,"y":0},{"x":12000,"y":0}],"style":{"strokeWidth":2,"lineDash":[],"fill":"transparent"},"meta":{"createdBy":"system","createdAt":"2026-08-26T00:00:00.000Z"}},
      {"id":"e_center_1","type":"line","layerId":"layer-center","points":[{"x":500,"y":3500},{"x":11500,"y":3500}],"style":{"strokeWidth":2,"lineDash":[18,12],"fill":"transparent"},"meta":{"createdBy":"system","createdAt":"2026-08-26T00:00:00.000Z"}},
      {"id":"e_box_1","type":"rect","layerId":"layer-structure","origin":{"x":2200,"y":2400},"width":3600,"height":2200,"style":{"strokeWidth":2,"lineDash":[],"fill":"transparent"},"meta":{"createdBy":"system","createdAt":"2026-08-26T00:00:00.000Z"}},
      {"id":"e_crane_1","type":"circle","layerId":"layer-temporary","center":{"x":8200,"y":3500},"radius":980,"style":{"strokeWidth":2,"lineDash":[],"fill":"transparent"},"meta":{"createdBy":"system","createdAt":"2026-08-26T00:00:00.000Z"}}
    ],
    "comments": [],
    "commandEvents": [],
    "auditLog": [{"id":"audit_seed","at":"2026-08-26T00:00:00.000Z","actor":"system","action":"drawing.seeded","detail":"Neon demo seed"}],
    "createdAt": "2026-08-26T00:00:00.000Z",
    "updatedAt": "2026-08-26T00:00:00.000Z"
  }'::jsonb,
  'seed-demo-hash-v1',
  'system'
)
on conflict (id) do nothing;

insert into audit_logs (id, actor_id, action, target_type, target_id, detail)
values (
  'audit_seed_demo_001',
  'system',
  'seed.loaded',
  'drawing',
  'dwg_demo_001',
  '{"source": "seeds/demo.sql", "purpose": "demo"}'::jsonb
)
on conflict (id) do nothing;
