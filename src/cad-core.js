const EPSILON = 1e-9;

import { transformEntity } from "./cad-advanced.js";

export const DEFAULT_LAYERS = [
  { id: "layer-frame", name: "図枠", color: "#5b6b7a", visible: true, locked: false, printable: true },
  { id: "layer-center", name: "中心線", color: "#d14f4f", visible: true, locked: false, printable: true },
  { id: "layer-structure", name: "構造物", color: "#1574b8", visible: true, locked: false, printable: true },
  { id: "layer-temporary", name: "仮設", color: "#1e946f", visible: true, locked: false, printable: true },
  { id: "layer-annotation", name: "注記", color: "#a26a1d", visible: true, locked: false, printable: true }
];

export const ROLE_POLICIES = {
  viewer: { label: "閲覧者", canEdit: false, canApprove: false, canRunAi: false, canComment: false },
  drafter: { label: "作図者", canEdit: true, canApprove: false, canRunAi: true, canComment: true },
  reviewer: { label: "レビュアー", canEdit: false, canApprove: false, canRunAi: true, canComment: true },
  approver: { label: "承認者", canEdit: false, canApprove: true, canRunAi: false, canComment: true },
  cad_admin: { label: "CAD管理者", canEdit: true, canApprove: true, canRunAi: true, canComment: true }
};

export function createDrawing(overrides = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: overrides.id ?? "dwg_demo_001",
    name: overrides.name ?? "道路拡幅 仮設施工図",
    unit: overrides.unit ?? "mm",
    version: overrides.version ?? 1,
    revision: overrides.revision ?? 1,
    state: overrides.state ?? "draft",
    currentRole: overrides.currentRole ?? "drafter",
    layers: structuredClone(DEFAULT_LAYERS),
    entities: [],
    comments: [],
    dimensionStyles: [{ id: "dim-standard", name: "標準", textSize: 180, arrowSize: 120, precision: 0, suffix: "" }],
    layout: { paper: "A3", orientation: "landscape", scale: 100, margin: 10, title: "" },
    commandEvents: [],
    auditLog: [
      {
        id: "audit_seed",
        at: now,
        actor: "system",
        action: "drawing.seeded",
        detail: "Demo drawing created"
      }
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

export function seedDrawing() {
  const drawing = createDrawing({ revision: 0 });
  const entities = [
    line("layer-frame", [0, 0], [12000, 0], { id: "e_frame_1" }),
    line("layer-frame", [12000, 0], [12000, 7000], { id: "e_frame_2" }),
    line("layer-frame", [12000, 7000], [0, 7000], { id: "e_frame_3" }),
    line("layer-frame", [0, 7000], [0, 0], { id: "e_frame_4" }),
    line("layer-center", [500, 3500], [11500, 3500], { id: "e_center_1", lineDash: [18, 12] }),
    rect("layer-structure", [2200, 2400], 3600, 2200, { id: "e_box_1" }),
    circle("layer-temporary", [8200, 3500], 980, { id: "e_crane_1" }),
    polyline("layer-temporary", [[6600, 1800], [9800, 1800], [10800, 5200], [7200, 5600]], {
      id: "e_yard_1",
      closed: true
    }),
    text("layer-annotation", [720, 6500], "Mirai Web CAD / Review Required", {
      id: "e_note_1",
      size: 280
    }),
    text("layer-annotation", [720, 6100], "Scale 1:100 / Unit mm / Draft", { id: "e_note_2", size: 220 })
  ];
  return applyTransaction(drawing, {
    id: "txn_seed_entities",
    source: "system",
    label: "デモ図面初期化",
    commands: entities.map((entity) => ({ op: "add", entity }))
  }).drawing;
}

export function line(layerId, start, end, options = {}) {
  return entityBase("line", layerId, {
    points: [point(start), point(end)],
    ...options
  });
}

export function rect(layerId, origin, width, height, options = {}) {
  return entityBase("rect", layerId, {
    origin: point(origin),
    width,
    height,
    ...options
  });
}

export function circle(layerId, center, radius, options = {}) {
  return entityBase("circle", layerId, {
    center: point(center),
    radius,
    ...options
  });
}

export function arc(layerId, center, radius, startAngle, endAngle, options = {}) {
  return entityBase("arc", layerId, {
    center: point(center),
    radius,
    startAngle: Number(startAngle),
    endAngle: Number(endAngle),
    ...options
  });
}

export function ellipse(layerId, center, radiusX, radiusY, rotation = 0, options = {}) {
  return entityBase("ellipse", layerId, {
    ...options,
    center: point(center),
    radiusX: Number(radiusX),
    radiusY: Number(radiusY),
    rotation: Number(rotation),
    startParameter: Number(options.startParameter ?? 0),
    endParameter: Number(options.endParameter ?? Math.PI * 2)
  });
}

export function spline(layerId, controlPoints, options = {}) {
  const points = controlPoints.map(point);
  const degree = Math.max(1, Math.min(Number(options.degree ?? 3), points.length - 1));
  const knots = Array.isArray(options.knots) ? options.knots.map(Number) : clampedUniformKnots(points.length, degree);
  return entityBase("spline", layerId, {
    ...options,
    controlPoints: points,
    degree,
    knots,
    closed: Boolean(options.closed)
  });
}

export function polyline(layerId, points, options = {}) {
  return entityBase("polyline", layerId, {
    points: points.map(point),
    closed: options.closed ?? false,
    ...options
  });
}

export function text(layerId, at, value, options = {}) {
  return entityBase("text", layerId, {
    at: point(at),
    value,
    size: options.size ?? 240,
    ...options
  });
}

function entityBase(type, layerId, options) {
  return {
    id: options.id ?? `e_${cryptoSafeId()}`,
    type,
    layerId,
    style: {
      strokeWidth: options.strokeWidth ?? 2,
      lineDash: options.lineDash ?? [],
      fill: options.fill ?? "transparent"
    },
    meta: {
      createdBy: options.createdBy ?? "user",
      createdAt: options.createdAt ?? new Date().toISOString()
    },
    ...withoutKeys(options, ["id", "strokeWidth", "lineDash", "fill", "createdBy", "createdAt"])
  };
}

export function applyTransaction(drawing, transaction) {
  const policy = ROLE_POLICIES[drawing.currentRole] ?? ROLE_POLICIES.viewer;
  if (drawing.state === "approved") {
    return fail("承認済み版は直接変更できません。新しい版を作成してください。", drawing);
  }
  const isCommentOnly = transaction.commands.every((command) => command.op === "add_comment");
  const requiredCapability = isCommentOnly ? "canComment" : "canEdit";
  if (!policy[requiredCapability] && transaction.source !== "system" && transaction.source !== "approval") {
    return fail(`${policy.label}は${isCommentOnly ? "コメントを追加" : "図面を変更"}できません。`, drawing);
  }

  const next = structuredClone(drawing);
  next.comments ??= [];
  const warnings = [];
  const beforeHash = stableHash(next.entities);

  for (const command of transaction.commands) {
    if (command.op === "add_layer") {
      const layer = command.layer;
      if (!layer || typeof layer.id !== "string" || typeof layer.name !== "string") {
        return fail("追加レイヤーが不正です。", drawing);
      }
      if (next.layers.some((item) => item.id === layer.id)) {
        warnings.push(`レイヤーは追加済みです: ${layer.name}`);
        continue;
      }
      next.layers.push({
        id: layer.id,
        name: layer.name.slice(0, 80),
        color: /^#[0-9a-f]{6}$/i.test(layer.color) ? layer.color : "#5b6b7a",
        locked: false,
        visible: true,
        printable: layer.printable !== false
      });
    }

    if (command.op === "add") {
      const layer = next.layers.find((item) => item.id === command.entity.layerId);
      if (!layer) {
        return fail(`存在しないレイヤーです: ${command.entity.layerId}`, drawing);
      }
      if (layer.locked) {
        return fail(`ロック中レイヤーへ追加できません: ${layer.name}`, drawing);
      }
      next.entities.push(structuredClone(command.entity));
    }

    if (command.op === "update") {
      const target = next.entities.find((item) => item.id === command.id);
      if (!target) {
        warnings.push(`更新対象が見つかりません: ${command.id}`);
        continue;
      }
      const layer = next.layers.find((item) => item.id === target.layerId);
      if (layer?.locked) {
        return fail(`ロック中レイヤーの図形は変更できません: ${layer.name}`, drawing);
      }
      if (command.patch?.layerId && !next.layers.some((item) => item.id === command.patch.layerId)) {
        return fail(`移動先レイヤーが存在しません: ${command.patch.layerId}`, drawing);
      }
      Object.assign(target, structuredClone(command.patch));
    }

    if (command.op === "delete") {
      const target = next.entities.find((item) => item.id === command.id);
      if (!target) {
        warnings.push(`削除対象が見つかりません: ${command.id}`);
        continue;
      }
      const layer = next.layers.find((item) => item.id === target?.layerId);
      if (layer?.locked) {
        return fail(`ロック中レイヤーの図形は削除できません: ${layer.name}`, drawing);
      }
      next.entities = next.entities.filter((item) => item.id !== command.id);
    }

    if (command.op === "delete_layer") {
      const target = next.layers.find((item) => item.id === command.id);
      if (!target) {
        warnings.push(`削除レイヤーが見つかりません: ${command.id}`);
        continue;
      }
      if (next.layers.length === 1) return fail("最後のレイヤーは削除できません。", drawing);
      if (next.entities.some((entity) => entity.layerId === command.id)) {
        return fail(`図形が残るレイヤーは削除できません: ${target.name}`, drawing);
      }
      next.layers = next.layers.filter((item) => item.id !== command.id);
    }

    if (command.op === "update_layer") {
      const target = next.layers.find((item) => item.id === command.id);
      if (!target) {
        warnings.push(`更新レイヤーが見つかりません: ${command.id}`);
        continue;
      }
      const allowedPatch = {};
      for (const [key, value] of Object.entries(command.patch ?? {})) {
        if (["visible", "locked", "printable"].includes(key) && typeof value === "boolean") allowedPatch[key] = value;
        if (key === "name" && typeof value === "string" && value.trim()) allowedPatch.name = value.trim().slice(0, 80);
        if (key === "color" && typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) allowedPatch.color = value;
      }
      Object.assign(target, structuredClone(allowedPatch));
    }

    if (command.op === "update_layout") {
      const patch = command.patch ?? {};
      next.layout = {
        ...next.layout,
        paper: ["A4", "A3", "A2", "A1"].includes(patch.paper) ? patch.paper : next.layout?.paper ?? "A3",
        orientation: ["portrait", "landscape"].includes(patch.orientation) ? patch.orientation : next.layout?.orientation ?? "landscape",
        scale: Number.isFinite(Number(patch.scale)) && Number(patch.scale) > 0 ? Number(patch.scale) : next.layout?.scale ?? 100,
        margin: Number.isFinite(Number(patch.margin)) && Number(patch.margin) >= 0 ? Number(patch.margin) : next.layout?.margin ?? 10,
        title: typeof patch.title === "string" ? patch.title.slice(0, 100) : next.layout?.title ?? ""
      };
    }

    if (command.op === "update_drawing_meta") {
      const patch = command.patch ?? {};
      if (typeof patch.name === "string" && patch.name.trim()) next.name = patch.name.trim().slice(0, 120);
    }

    if (command.op === "add_comment") {
      const body = sanitizeCommentBody(command.body);
      if (!body) {
        return fail("コメント本文を入力してください。", drawing);
      }
      let entityId = command.entityId ?? null;
      if (entityId && !next.entities.some((entity) => entity.id === entityId)) {
        warnings.push(`コメント対象の図形が見つかりません: ${entityId}`);
        entityId = null;
      }
      next.comments.push({
        id: `comment_${cryptoSafeId()}`,
        body,
        entityId,
        author: transaction.actor ?? next.currentRole,
        at: new Date().toISOString(),
        resolved: false
      });
    }
  }

  next.updatedAt = new Date().toISOString();
  next.revision = (drawing.revision ?? 1) + 1;
  next.commandEvents.push({
    id: transaction.id ?? `txn_${cryptoSafeId()}`,
    at: next.updatedAt,
    label: transaction.label,
    source: transaction.source ?? "user",
    beforeHash,
    afterHash: stableHash(next.entities),
    commands: structuredClone(transaction.commands),
    warnings
  });
  next.auditLog.push({
    id: `audit_${cryptoSafeId()}`,
    at: next.updatedAt,
    actor: transaction.actor ?? next.currentRole,
    action: "drawing.transaction",
    detail: transaction.label
  });
  return { ok: true, drawing: next, warnings };
}

export function createNewVersion(drawing, actor = "approver") {
  const next = structuredClone(drawing);
  next.version += 1;
  next.revision = (drawing.revision ?? 1) + 1;
  next.state = "draft";
  next.updatedAt = new Date().toISOString();
  next.auditLog.push({
    id: `audit_${cryptoSafeId()}`,
    at: next.updatedAt,
    actor,
    action: "drawing.version.created",
    detail: `v${drawing.version}からv${next.version}を作成`
  });
  return next;
}

export function submitForReview(drawing, actor = "drafter") {
  const next = structuredClone(drawing);
  next.state = "in_review";
  next.revision = (drawing.revision ?? 1) + 1;
  next.updatedAt = new Date().toISOString();
  next.auditLog.push({
    id: `audit_${cryptoSafeId()}`,
    at: next.updatedAt,
    actor,
    action: "review.submitted",
    detail: `v${next.version}をレビューへ提出`
  });
  return next;
}

export function approveDrawing(drawing, actor = "approver") {
  const policy = ROLE_POLICIES[drawing.currentRole] ?? ROLE_POLICIES.viewer;
  if (!policy.canApprove) {
    return fail(`${policy.label}は承認できません。`, drawing);
  }
  if (drawing.state !== "in_review") {
    return fail("レビュー中の図面だけを承認できます。", drawing);
  }
  const issues = validateDrawing(drawing).filter((issue) => issue.severity === "critical");
  if (issues.length > 0) {
    return fail(`Critical検査項目が残っています: ${issues.length}件`, drawing);
  }
  const next = structuredClone(drawing);
  next.state = "approved";
  next.revision = (drawing.revision ?? 1) + 1;
  next.updatedAt = new Date().toISOString();
  next.auditLog.push({
    id: `audit_${cryptoSafeId()}`,
    at: next.updatedAt,
    actor,
    action: "review.approved",
    detail: `v${next.version}を承認`
  });
  return { ok: true, drawing: next };
}

export function validateDrawing(drawing) {
  const issues = [];
  const layerIds = new Set(drawing.layers.map((layer) => layer.id));
  const ids = new Set();

  for (const entity of drawing.entities) {
    if (ids.has(entity.id)) {
      issues.push(issue("critical", "duplicate-entity-id", `図形IDが重複しています: ${entity.id}`, entity.id));
    }
    ids.add(entity.id);

    if (!layerIds.has(entity.layerId)) {
      issues.push(issue("critical", "missing-layer", `存在しないレイヤーを参照しています: ${entity.layerId}`, entity.id));
    }

    if (entity.type === "arc" && (!Number.isFinite(entity.startAngle) || !Number.isFinite(entity.endAngle) || arcSweepDegrees(entity) <= EPSILON)) {
      issues.push(issue("critical", "invalid-arc-angle", `円弧角度が不正です: ${entity.id}`, entity.id));
    }
    if ((entity.type === "circle" || entity.type === "arc") && (!Number.isFinite(entity.radius) || entity.radius <= 0)) {
      issues.push(issue("critical", "invalid-radius", `円半径が不正です: ${entity.id}`, entity.id));
    }
    if (entity.type === "ellipse" && (
      !Number.isFinite(entity.radiusX) || entity.radiusX <= 0 ||
      !Number.isFinite(entity.radiusY) || entity.radiusY <= 0 || entity.radiusY > entity.radiusX ||
      !Number.isFinite(entity.rotation) || ellipseSweepRadians(entity) <= EPSILON
    )) {
      issues.push(issue("critical", "invalid-ellipse", `楕円の中心・半径・角度が不正です: ${entity.id}`, entity.id));
    }
    if (entity.type === "spline" && !validSpline(entity)) {
      issues.push(issue("critical", "invalid-spline", `スプラインの制御点・次数・ノット列が不正です: ${entity.id}`, entity.id));
    }

    const bounds = entityBounds(entity);
    if (!bounds) {
      issues.push(issue("major", "invalid-geometry", `図形の形状が不正です: ${entity.id}`, entity.id));
      continue;
    }
    if (bounds.minX < -1 || bounds.minY < -1 || bounds.maxX > 12001 || bounds.maxY > 7001) {
      issues.push(issue("major", "outside-paper", `用紙外の図形です: ${entity.id}`, entity.id));
    }
    if (entity.type === "line" && distance(entity.points[0], entity.points[1]) < EPSILON) {
      issues.push(issue("major", "zero-length-line", `長さ0の線分です: ${entity.id}`, entity.id));
    }
  }

  if (!drawing.entities.some((entity) => entity.type === "text")) {
    issues.push(issue("minor", "missing-title-note", "表題/注記の文字がありません。", drawing.id));
  }

  return issues;
}

export function measurements(drawing) {
  let totalLength = 0;
  let totalArea = 0;
  const counts = {};
  for (const entity of drawing.entities) {
    counts[entity.type] = (counts[entity.type] ?? 0) + 1;
    totalLength += entityLength(entity);
    totalArea += entityArea(entity);
  }
  return {
    entityCount: drawing.entities.length,
    totalLength: round(totalLength),
    totalArea: round(totalArea),
    counts
  };
}

export function buildAiProposal(drawing, prompt) {
  const normalized = prompt.trim();
  const commands = [];
  const warnings = [];
  let label = "AI提案";

  if (!normalized) {
    return {
      status: "needs_input",
      question: "作図・検査・標準化の目的を入力してください。",
      commands,
      warnings
    };
  }

  const lower = normalized.toLowerCase();
  if (normalized.includes("重機") || normalized.includes("クレーン") || lower.includes("crane")) {
    label = "クレーン作業範囲を追加";
    commands.push({
      op: "add",
      entity: circle("layer-temporary", [9300, 3500], 1450, {
        id: `preview_crane_${cryptoSafeId()}`,
        createdBy: "agent",
        strokeWidth: 2,
        lineDash: [10, 8]
      })
    });
    commands.push({
      op: "add",
      entity: text("layer-annotation", [7600, 1500], "AI Preview: crane swing radius R=1450", {
        id: `preview_note_${cryptoSafeId()}`,
        createdBy: "agent",
        size: 180
      })
    });
  } else if (normalized.includes("標準") || normalized.includes("整理") || lower.includes("cleanup")) {
    label = "レイヤー標準化と短線検査";
    const shortLine = drawing.entities.find((entity) => entity.type === "line" && entityLength(entity) < 50);
    if (shortLine) {
      commands.push({ op: "delete", id: shortLine.id });
    } else {
      warnings.push("削除対象の短線は見つかりません。標準レイヤー検査のみ実施します。");
    }
  } else if (normalized.includes("注記") || normalized.includes("寸法") || lower.includes("note")) {
    label = "施工注記を追加";
    commands.push({
      op: "add",
      entity: text("layer-annotation", [2600, 2050], "仮設範囲は現地立会い後に確定", {
        id: `preview_annotation_${cryptoSafeId()}`,
        createdBy: "agent",
        size: 210
      })
    });
  } else {
    return {
      status: "needs_input",
      question: "「重機範囲」「標準整理」「注記追加」のいずれかを具体的に指定してください。",
      commands,
      warnings
    };
  }

  return {
    status: "planned",
    label,
    skill: {
      id: inferSkillId(label),
      version: "0.1.0",
      status: "approved"
    },
    risk: commands.length > 3 ? "major" : "minor",
    impact: {
      add: commands.filter((command) => command.op === "add").length,
      update: commands.filter((command) => command.op === "update").length,
      delete: commands.filter((command) => command.op === "delete").length
    },
    commands,
    warnings,
    postconditions: ["no_locked_layer_change", "geometry_valid", "human_approved"]
  };
}

export function proposalToTransaction(proposal, actor = "agent") {
  return {
    id: `agt_${cryptoSafeId()}`,
    source: "agent",
    actor,
    label: proposal.label,
    commands: proposal.commands
  };
}

export function entityBounds(entity) {
  if (entity.type === "line" || entity.type === "polyline") {
    return boundsFromPoints(entity.points);
  }
  if (entity.type === "rect") {
    return {
      minX: entity.origin.x,
      minY: entity.origin.y,
      maxX: entity.origin.x + entity.width,
      maxY: entity.origin.y + entity.height
    };
  }
  if (entity.type === "circle") {
    if (!isFinitePoint(entity.center) || !Number.isFinite(entity.radius) || entity.radius <= 0) return null;
    return {
      minX: entity.center.x - entity.radius,
      minY: entity.center.y - entity.radius,
      maxX: entity.center.x + entity.radius,
      maxY: entity.center.y + entity.radius
    };
  }
  if (entity.type === "arc") {
    if (!isFinitePoint(entity.center) || !Number.isFinite(entity.radius) || entity.radius <= 0 || arcSweepDegrees(entity) <= EPSILON) return null;
    const points = [arcPointAt(entity, entity.startAngle), arcPointAt(entity, entity.endAngle)];
    for (const angle of [0, 90, 180, 270]) {
      if (angleOnArc(angle, entity.startAngle, entity.endAngle)) points.push(arcPointAt(entity, angle));
    }
    return boundsFromPoints(points);
  }
  if (entity.type === "ellipse") {
    if (!isFinitePoint(entity.center) || !Number.isFinite(entity.radiusX) || entity.radiusX <= 0 || !Number.isFinite(entity.radiusY) || entity.radiusY <= 0) return null;
    return boundsFromPoints(sampleEllipse(entity));
  }
  if (entity.type === "spline") {
    if (!validSpline(entity)) return null;
    return boundsFromPoints(sampleSpline(entity));
  }
  if (entity.type === "text") {
    return {
      minX: entity.at.x,
      minY: entity.at.y - entity.size,
      maxX: entity.at.x + entity.value.length * entity.size * 0.55,
      maxY: entity.at.y
    };
  }
  if (entity.type === "dimension") {
    const [start, end] = entity.points;
    const length = distance(start, end);
    const normal = length
      ? { x: (-(end.y - start.y) / length) * entity.offset, y: ((end.x - start.x) / length) * entity.offset }
      : { x: 0, y: 0 };
    return boundsFromPoints([
      start,
      end,
      { x: start.x + normal.x, y: start.y + normal.y },
      { x: end.x + normal.x, y: end.y + normal.y }
    ]);
  }
  if (entity.type === "hatch") return boundsFromPoints(entity.points);
  if (entity.type === "block") {
    const bounds = (entity.children ?? []).map(entityBounds).filter(Boolean);
    if (!bounds.length) return null;
    const combined = {
      minX: Math.min(...bounds.map((value) => value.minX)), minY: Math.min(...bounds.map((value) => value.minY)),
      maxX: Math.max(...bounds.map((value) => value.maxX)), maxY: Math.max(...bounds.map((value) => value.maxY))
    };
    const corners = [
      { x: combined.minX, y: combined.minY }, { x: combined.maxX, y: combined.minY },
      { x: combined.maxX, y: combined.maxY }, { x: combined.minX, y: combined.maxY }
    ];
    return boundsFromPoints(transformEntity({ points: corners }, {
      dx: entity.insertion?.x ?? 0, dy: entity.insertion?.y ?? 0,
      angle: entity.rotation ?? 0, scale: entity.scale ?? 1, base: { x: 0, y: 0 }
    }).points);
  }
  return null;
}

export function boundsIntersect(a, b) {
  if (!a || !b) return true;
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
}

export function entityLength(entity) {
  if (entity.type === "line") return distance(entity.points[0], entity.points[1]);
  if (entity.type === "polyline") {
    const points = entity.closed ? [...entity.points, entity.points[0]] : entity.points;
    return points.slice(1).reduce((sum, current, index) => sum + distance(points[index], current), 0);
  }
  if (entity.type === "rect") return Math.abs(entity.width * 2) + Math.abs(entity.height * 2);
  if (entity.type === "circle") return 2 * Math.PI * entity.radius;
  if (entity.type === "arc") return (Math.PI * entity.radius * arcSweepDegrees(entity)) / 180;
  if (entity.type === "ellipse") return sampledLength(sampleEllipse(entity), false);
  if (entity.type === "spline") return sampledLength(sampleSpline(entity), Boolean(entity.closed));
  if (entity.type === "dimension") return distance(entity.points[0], entity.points[1]);
  if (entity.type === "hatch") return entityLength({ type: "polyline", points: entity.points, closed: true });
  if (entity.type === "block") return (entity.children ?? []).reduce((sum, child) => sum + entityLength(child) * Math.abs(entity.scale ?? 1), 0);
  return 0;
}

export function entityArea(entity) {
  if (entity.type === "rect") return Math.abs(entity.width * entity.height);
  if (entity.type === "circle") return Math.PI * entity.radius * entity.radius;
  if (entity.type === "ellipse" && ellipseSweepRadians(entity) >= Math.PI * 2 - EPSILON) return Math.PI * entity.radiusX * entity.radiusY;
  if (entity.type === "polyline" && entity.closed) return polygonArea(entity.points);
  if (entity.type === "hatch") return polygonArea(entity.points);
  if (entity.type === "block") return (entity.children ?? []).reduce((sum, child) => sum + entityArea(child) * (entity.scale ?? 1) ** 2, 0);
  return 0;
}

export function hitTest(drawing, worldPoint, tolerance = 80) {
  const visibleLayerIds = new Set(drawing.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  let best = null;
  let bestDistance = Infinity;
  for (const entity of drawing.entities) {
    if (!visibleLayerIds.has(entity.layerId)) continue;
    const currentDistance = distanceToEntity(entity, worldPoint);
    if (currentDistance < tolerance && currentDistance < bestDistance) {
      best = entity;
      bestDistance = currentDistance;
    }
  }
  return best;
}

function distanceToEntity(entity, p) {
  if (entity.type === "line") return pointToSegmentDistance(p, entity.points[0], entity.points[1]);
  if (entity.type === "rect") {
    const o = entity.origin;
    const points = [
      o,
      { x: o.x + entity.width, y: o.y },
      { x: o.x + entity.width, y: o.y + entity.height },
      { x: o.x, y: o.y + entity.height }
    ];
    return Math.min(...points.map((current, index) => pointToSegmentDistance(p, current, points[(index + 1) % 4])));
  }
  if (entity.type === "circle") return Math.abs(distance(p, entity.center) - entity.radius);
  if (entity.type === "arc") {
    const angle = (Math.atan2(p.y - entity.center.y, p.x - entity.center.x) * 180) / Math.PI;
    if (angleOnArc(angle, entity.startAngle, entity.endAngle)) return Math.abs(distance(p, entity.center) - entity.radius);
    return Math.min(distance(p, arcPointAt(entity, entity.startAngle)), distance(p, arcPointAt(entity, entity.endAngle)));
  }
  if (entity.type === "ellipse") return distanceToSampledPath(p, sampleEllipse(entity), false);
  if (entity.type === "spline") return distanceToSampledPath(p, sampleSpline(entity), Boolean(entity.closed));
  if (entity.type === "polyline") {
    const points = entity.closed ? [...entity.points, entity.points[0]] : entity.points;
    return Math.min(...points.slice(1).map((current, index) => pointToSegmentDistance(p, points[index], current)));
  }
  if (entity.type === "text") {
    const bounds = entityBounds(entity);
    return p.x >= bounds.minX && p.x <= bounds.maxX && p.y >= bounds.minY && p.y <= bounds.maxY ? 0 : Infinity;
  }
  if (entity.type === "dimension") return pointToSegmentDistance(p, entity.points[0], entity.points[1]);
  if (entity.type === "hatch") {
    const points = [...entity.points, entity.points[0]];
    return Math.min(...points.slice(1).map((current, index) => pointToSegmentDistance(p, points[index], current)));
  }
  if (entity.type === "block") {
    const bounds = entityBounds(entity);
    return bounds && p.x >= bounds.minX && p.x <= bounds.maxX && p.y >= bounds.minY && p.y <= bounds.maxY ? 0 : Infinity;
  }
  return Infinity;
}

function pointToSegmentDistance(p, a, b) {
  const lengthSquared = distanceSquared(a, b);
  if (lengthSquared < EPSILON) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / lengthSquared));
  return distance(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

export function arcSweepDegrees(entityOrStart, maybeEnd) {
  const start = typeof entityOrStart === "object" ? Number(entityOrStart.startAngle) : Number(entityOrStart);
  const end = typeof entityOrStart === "object" ? Number(entityOrStart.endAngle) : Number(maybeEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const raw = end - start;
  return ((raw % 360) + 360) % 360;
}

export function angleOnArc(angle, startAngle, endAngle) {
  const sweep = arcSweepDegrees(startAngle, endAngle);
  if (sweep <= EPSILON) return false;
  const relative = ((Number(angle) - Number(startAngle)) % 360 + 360) % 360;
  return relative <= sweep + EPSILON;
}

export function arcPointAt(entity, angle) {
  const radians = (Number(angle) * Math.PI) / 180;
  return {
    x: entity.center.x + entity.radius * Math.cos(radians),
    y: entity.center.y + entity.radius * Math.sin(radians)
  };
}

export function ellipsePointAt(entity, parameter) {
  const rotation = (Number(entity.rotation ?? 0) * Math.PI) / 180;
  const localX = entity.radiusX * Math.cos(parameter);
  const localY = entity.radiusY * Math.sin(parameter);
  return {
    x: entity.center.x + localX * Math.cos(rotation) - localY * Math.sin(rotation),
    y: entity.center.y + localX * Math.sin(rotation) + localY * Math.cos(rotation)
  };
}

export function sampleEllipse(entity, segmentCount = 96) {
  const sweep = ellipseSweepRadians(entity);
  if (sweep <= EPSILON) return [];
  const count = Math.max(12, Math.min(256, Math.ceil(segmentCount * sweep / (Math.PI * 2))));
  return Array.from({ length: count + 1 }, (_, index) =>
    ellipsePointAt(entity, Number(entity.startParameter ?? 0) + sweep * index / count)
  );
}

export function sampleSpline(entity, segmentCount = Math.max(32, (entity.controlPoints?.length ?? 0) * 12)) {
  if (!validSpline(entity)) return [];
  const points = entity.controlPoints;
  const degree = entity.degree;
  const knots = entity.knots;
  const start = knots[degree];
  const end = knots[points.length];
  const count = Math.max(8, Math.min(512, segmentCount));
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index === count ? end : start + (end - start) * index / count;
    return deBoor(points, degree, knots, t);
  });
}

export function ellipseSweepRadians(entity) {
  const start = Number(entity.startParameter ?? 0);
  const end = Number(entity.endParameter ?? Math.PI * 2);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const raw = end - start;
  if (Math.abs(raw) >= Math.PI * 2 - EPSILON) return Math.PI * 2;
  return ((raw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}

export function parameterOnEllipse(parameter, entity) {
  const sweep = ellipseSweepRadians(entity);
  if (sweep >= Math.PI * 2 - EPSILON) return true;
  const start = Number(entity.startParameter ?? 0);
  const relative = ((Number(parameter) - start) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  return relative <= sweep + EPSILON;
}

function clampedUniformKnots(pointCount, degree) {
  const knotCount = pointCount + degree + 1;
  const end = pointCount - degree;
  return Array.from({ length: knotCount }, (_, index) => {
    if (index <= degree) return 0;
    if (index >= pointCount) return 1;
    return (index - degree) / end;
  });
}

function validSpline(entity) {
  const points = entity.controlPoints;
  const degree = Number(entity.degree);
  const knots = entity.knots;
  return Array.isArray(points) && points.length >= 2 && points.every(isFinitePoint) &&
    Number.isInteger(degree) && degree >= 1 && degree < points.length &&
    Array.isArray(knots) && knots.length === points.length + degree + 1 &&
    knots.every(Number.isFinite) && knots.every((value, index) => index === 0 || value >= knots[index - 1]) &&
    knots[degree] < knots[points.length];
}

function deBoor(points, degree, knots, parameter) {
  const lastControl = points.length - 1;
  let span = degree;
  if (parameter >= knots[points.length]) span = lastControl;
  else {
    for (let index = degree; index <= lastControl; index += 1) {
      if (parameter >= knots[index] && parameter < knots[index + 1]) {
        span = index;
        break;
      }
    }
  }
  const work = Array.from({ length: degree + 1 }, (_, index) => ({ ...points[span - degree + index] }));
  for (let level = 1; level <= degree; level += 1) {
    for (let index = degree; index >= level; index -= 1) {
      const knotIndex = span - degree + index;
      const denominator = knots[knotIndex + degree - level + 1] - knots[knotIndex];
      const alpha = Math.abs(denominator) <= EPSILON ? 0 : (parameter - knots[knotIndex]) / denominator;
      work[index] = {
        x: (1 - alpha) * work[index - 1].x + alpha * work[index].x,
        y: (1 - alpha) * work[index - 1].y + alpha * work[index].y
      };
    }
  }
  return work[degree];
}

function sampledLength(points, closed) {
  if (points.length < 2) return 0;
  const path = closed ? [...points, points[0]] : points;
  return path.slice(1).reduce((sum, current, index) => sum + distance(path[index], current), 0);
}

function distanceToSampledPath(pointValue, points, closed) {
  if (points.length < 2) return Infinity;
  const path = closed ? [...points, points[0]] : points;
  return Math.min(...path.slice(1).map((current, index) => pointToSegmentDistance(pointValue, path[index], current)));
}

function point(value) {
  return Array.isArray(value) ? { x: Number(value[0]), y: Number(value[1]) } : { x: Number(value.x), y: Number(value.y) };
}

function boundsFromPoints(points) {
  if (!points.length || points.some((value) => !isFinitePoint(value))) return null;
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y))
  };
}

function isFinitePoint(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function polygonArea(points) {
  const area = points.reduce((sum, pointValue, index) => {
    const next = points[(index + 1) % points.length];
    return sum + pointValue.x * next.y - next.x * pointValue.y;
  }, 0);
  return Math.abs(area / 2);
}

function distance(a, b) {
  return Math.sqrt(distanceSquared(a, b));
}

function distanceSquared(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function issue(severity, code, message, entityId) {
  return { severity, code, message, entityId };
}

function fail(message, drawing) {
  return { ok: false, error: message, drawing };
}

function stableHash(value) {
  const raw = JSON.stringify(value, (_key, current) => {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      return Object.fromEntries(Object.entries(current).sort(([left], [right]) => left.localeCompare(right)));
    }
    return current;
  });
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function cryptoSafeId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().slice(0, 8);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function inferSkillId(label) {
  if (label.includes("クレーン")) return "civil-temporary-yard";
  if (label.includes("標準")) return "drawing-cleanup";
  return "dimension-annotation";
}

function sanitizeCommentBody(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, 1000);
}

function withoutKeys(objectValue, keys) {
  return Object.fromEntries(Object.entries(objectValue).filter(([key]) => !keys.includes(key)));
}
