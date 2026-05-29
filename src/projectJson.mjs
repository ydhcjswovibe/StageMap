export function createProjectJsonDownload(plan) {
  const title = String(plan?.title || "").trim() || "movemap-project";

  return {
    blob: new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }),
    filename: `${title}.json`
  };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function finiteStageNumber(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

export function validateProjectImport(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return { ok: false, errors: [{ code: "not-object", message: "프로젝트 JSON이 객체가 아닙니다." }] };
  }
  if (typeof value.title !== "string") {
    errors.push({ code: "invalid-title", message: "프로젝트 제목이 없습니다." });
  }
  if (!Array.isArray(value.performers)) {
    errors.push({ code: "invalid-performers", message: "출연자 목록이 없습니다." });
  } else {
    value.performers.forEach((performer, index) => {
      if (!isPlainObject(performer) || typeof performer.id !== "string" || !performer.id.trim()) {
        errors.push({ code: "invalid-performer", index, message: "출연자 id가 올바르지 않습니다." });
      }
    });
  }
  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    errors.push({ code: "invalid-sections", message: "대형 구간이 없습니다." });
  } else {
    value.sections.forEach((section, sectionIndex) => {
      if (!isPlainObject(section)) {
        errors.push({ code: "invalid-section", sectionIndex, message: "대형 구간이 객체가 아닙니다." });
        return;
      }
      if (!isPlainObject(section.positions)) {
        errors.push({ code: "invalid-positions", sectionIndex, message: "대형 위치 데이터가 없습니다." });
        return;
      }
      if (!Number.isFinite(section.time ?? section.end ?? 0) || (section.time ?? section.end ?? 0) < 0) {
        errors.push({ code: "invalid-timing", sectionIndex, message: "대형 도착 시간이 올바르지 않습니다." });
      }
      Object.entries(section.positions).forEach(([performerId, position]) => {
        if (!isPlainObject(position) || !finiteStageNumber(position.x) || !finiteStageNumber(position.y)) {
          errors.push({ code: "invalid-position", sectionIndex, performerId, message: "대형 좌표가 무대 범위를 벗어났습니다." });
        }
      });
    });
  }
  if (value.stage && (!isPlainObject(value.stage) || !Number.isFinite(value.stage.width) || !Number.isFinite(value.stage.height))) {
    errors.push({ code: "invalid-stage", message: "무대 크기 정보가 올바르지 않습니다." });
  }
  if (value.stageReferences && !Array.isArray(value.stageReferences)) {
    errors.push({ code: "invalid-stage-references", message: "무대 기준선 정보가 올바르지 않습니다." });
  }
  return { ok: errors.length === 0, errors };
}

export function withProjectSnapshotMetadata(plan, options = {}) {
  const exportedAt = options.exportedAt || new Date().toISOString();
  return {
    ...plan,
    snapshots: [
      ...(Array.isArray(plan?.snapshots) ? plan.snapshots : []),
      {
        id: options.id || `snapshot-${exportedAt}`,
        kind: options.kind || "manual-export",
        exportedAt,
        sectionCount: Array.isArray(plan?.sections) ? plan.sections.length : 0,
        performerCount: Array.isArray(plan?.performers) ? plan.performers.length : 0
      }
    ]
  };
}
