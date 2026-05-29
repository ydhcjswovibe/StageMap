import assert from "node:assert/strict";
import test from "node:test";

import {
  FORMATION_TEMPLATES,
  applyTemplatePositionsToSection,
  buildFormationTemplatePreview
} from "./formationTemplates.mjs";

const performers = [
  { id: "lead" },
  { id: "follow" },
  { id: "center" },
  { id: "back" },
  { id: "wing" }
];

function assertBoundedPositions(positions) {
  for (const position of Object.values(positions)) {
    assert.ok(position.x >= 0 && position.x <= 100, `x ${position.x} is bounded`);
    assert.ok(position.y >= 0 && position.y <= 100, `y ${position.y} is bounded`);
  }
}

test("exports the supported deterministic template ids", () => {
  assert.deepEqual(
    FORMATION_TEMPLATES.map((template) => template.id),
    ["line", "two-line", "v", "circle", "diagonal", "block"]
  );
});

test("template previews are deterministic and include stable provenance", () => {
  const first = buildFormationTemplatePreview("v", performers);
  const second = buildFormationTemplatePreview("v", performers);

  assert.deepEqual(first, second);
  assert.equal(first.templateId, "v");
  assert.equal(first.label, "V");
  assert.deepEqual(Object.keys(first.positions), performers.map((performer) => performer.id));
  assert.deepEqual(first.provenance, {
    kind: "template",
    templateId: "v",
    performerCount: performers.length
  });
});

test("templates adapt to roster counts and keep every point inside the stage", () => {
  for (const template of FORMATION_TEMPLATES) {
    const solo = buildFormationTemplatePreview(template.id, performers.slice(0, 1));
    const group = buildFormationTemplatePreview(template.id, performers);

    assert.deepEqual(Object.keys(solo.positions), ["lead"]);
    assert.deepEqual(Object.keys(group.positions), performers.map((performer) => performer.id));
    assertBoundedPositions(solo.positions);
    assertBoundedPositions(group.positions);
  }
});

test("template application patches a section without mutating inputs", () => {
  const section = {
    id: "f1",
    name: "F1",
    positions: {
      lead: { x: 1, y: 2 },
      spare: { x: 99, y: 98 }
    }
  };
  const preview = buildFormationTemplatePreview("line", performers.slice(0, 2));

  const patched = applyTemplatePositionsToSection(section, preview);

  assert.notEqual(patched, section);
  assert.deepEqual(section.positions.lead, { x: 1, y: 2 });
  assert.deepEqual(patched.positions.spare, { x: 99, y: 98 });
  assert.deepEqual(patched.positions.lead, preview.positions.lead);
  assert.deepEqual(patched.formationProvenance, preview.provenance);
});
