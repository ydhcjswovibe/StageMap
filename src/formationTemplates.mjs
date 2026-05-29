export const FORMATION_TEMPLATES = [
  { id: "line", label: "Line" },
  { id: "two-line", label: "Two-line" },
  { id: "v", label: "V" },
  { id: "circle", label: "Circle" },
  { id: "diagonal", label: "Diagonal" },
  { id: "block", label: "Block" }
];

const TEMPLATE_BY_ID = new Map(FORMATION_TEMPLATES.map((template) => [template.id, template]));

function clampStage(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function roundStage(value) {
  return Number(clampStage(value).toFixed(2));
}

function performerIds(performers = []) {
  return performers.map((performer) => performer?.id).filter(Boolean);
}

function spreadValue(index, count, min, max) {
  if (count <= 1) return (min + max) / 2;
  return min + ((max - min) * index) / (count - 1);
}

function point(x, y) {
  return { x: roundStage(x), y: roundStage(y) };
}

function mapPositions(ids, positionForIndex) {
  return ids.reduce((positions, id, index) => ({
    ...positions,
    [id]: positionForIndex(index, ids.length)
  }), {});
}

function linePositions(ids) {
  return mapPositions(ids, (index, count) => point(spreadValue(index, count, 18, 82), 50));
}

function twoLinePositions(ids) {
  return mapPositions(ids, (index, count) => {
    const topCount = Math.ceil(count / 2);
    const isTop = index < topCount;
    const rowIndex = isTop ? index : index - topCount;
    const rowCount = isTop ? topCount : count - topCount;
    return point(spreadValue(rowIndex, rowCount, 22, 78), isTop ? 40 : 60);
  });
}

function vPositions(ids) {
  return mapPositions(ids, (index, count) => {
    if (count <= 1) return point(50, 45);
    const center = (count - 1) / 2;
    const distance = Math.abs(index - center) / center;
    return point(spreadValue(index, count, 24, 76), 40 + distance * 36);
  });
}

function circlePositions(ids) {
  return mapPositions(ids, (index, count) => {
    if (count <= 1) return point(50, 50);
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;
    return point(50 + Math.cos(angle) * 32, 50 + Math.sin(angle) * 32);
  });
}

function diagonalPositions(ids) {
  return mapPositions(ids, (index, count) => point(
    spreadValue(index, count, 24, 76),
    spreadValue(index, count, 28, 72)
  ));
}

function blockPositions(ids) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
  const rows = Math.max(1, Math.ceil(ids.length / columns));
  return mapPositions(ids, (index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return point(spreadValue(column, columns, 32, 68), spreadValue(row, rows, 36, 64));
  });
}

const POSITION_BUILDERS = {
  line: linePositions,
  "two-line": twoLinePositions,
  v: vPositions,
  circle: circlePositions,
  diagonal: diagonalPositions,
  block: blockPositions
};

export function buildFormationTemplatePreview(templateId, performers = []) {
  const template = TEMPLATE_BY_ID.get(templateId) || FORMATION_TEMPLATES[0];
  const ids = performerIds(performers);
  const positions = POSITION_BUILDERS[template.id](ids);

  return {
    templateId: template.id,
    label: template.label,
    positions,
    provenance: {
      kind: "template",
      templateId: template.id,
      performerCount: ids.length
    }
  };
}

export function applyTemplatePositionsToSection(section = {}, preview = {}) {
  return {
    ...section,
    positions: {
      ...(section.positions || {}),
      ...(preview.positions || {})
    },
    formationProvenance: { ...(preview.provenance || {}) }
  };
}
