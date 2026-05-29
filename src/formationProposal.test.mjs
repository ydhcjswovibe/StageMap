import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptFormationProposal,
  applyProposalPositionsToSection,
  validateFormationProposal
} from "./formationProposal.mjs";

const performers = [{ id: "lead" }, { id: "follow" }, { id: "center" }];

test("proposal validation accepts bounded known performer positions", () => {
  const proposal = {
    source: "local-ai",
    prompt: "tight triangle",
    positions: {
      lead: { x: 40, y: 30 },
      follow: { x: 60, y: 30 },
      center: { x: 50, y: 60 }
    }
  };

  assert.deepEqual(validateFormationProposal(proposal, performers), {
    ok: true,
    positions: proposal.positions,
    errors: []
  });
});

test("proposal validation rejects unknown performers and missing required performers", () => {
  const result = validateFormationProposal(
    { positions: { lead: { x: 50, y: 50 }, guest: { x: 30, y: 30 } } },
    performers,
    { requireAllPerformers: true }
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.positions, {});
  assert.deepEqual(result.errors, [
    { code: "unknown-performer", performerId: "guest" },
    { code: "missing-performer", performerId: "follow" },
    { code: "missing-performer", performerId: "center" }
  ]);
});

test("proposal validation rejects non-finite and out-of-bounds coordinates", () => {
  const result = validateFormationProposal(
    {
      positions: {
        lead: { x: Number.NaN, y: 20 },
        follow: { x: 101, y: 50 },
        center: { x: 40, y: -1 }
      }
    },
    performers
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    { code: "non-finite-coordinate", performerId: "lead", axis: "x" },
    { code: "out-of-bounds-coordinate", performerId: "follow", axis: "x", value: 101 },
    { code: "out-of-bounds-coordinate", performerId: "center", axis: "y", value: -1 }
  ]);
});

test("proposal application patches a section without mutating inputs", () => {
  const section = {
    id: "f2",
    positions: {
      lead: { x: 10, y: 10 },
      spare: { x: 90, y: 90 }
    }
  };
  const validation = validateFormationProposal(
    { source: "local-ai", positions: { lead: { x: 35, y: 45 } } },
    performers
  );

  const patched = applyProposalPositionsToSection(section, validation, { acceptedBy: "test" });

  assert.notEqual(patched, section);
  assert.deepEqual(section.positions.lead, { x: 10, y: 10 });
  assert.deepEqual(patched.positions, {
    lead: { x: 35, y: 45 },
    spare: { x: 90, y: 90 }
  });
  assert.deepEqual(patched.formationProvenance, {
    kind: "proposal",
    acceptedBy: "test",
    performerCount: 1
  });
});

test("accept helper validates and applies a proposal with provenance", () => {
  const section = { id: "f3", positions: { lead: { x: 10, y: 10 } } };
  const proposal = { source: "local-ai", positions: { lead: { x: 40, y: 55 }, follow: { x: 60, y: 55 } } };

  const result = acceptFormationProposal(section, proposal, performers);

  assert.equal(result.ok, true);
  assert.deepEqual(result.section.positions, {
    lead: { x: 40, y: 55 },
    follow: { x: 60, y: 55 }
  });
  assert.deepEqual(result.section.formationProvenance, {
    kind: "proposal",
    performerCount: 2,
    source: "local-ai"
  });
});

test("accept helper does not patch invalid proposals", () => {
  const section = { id: "f4", positions: { lead: { x: 10, y: 10 } } };
  const result = acceptFormationProposal(section, { positions: { guest: { x: 10, y: 10 } } }, performers);

  assert.equal(result.ok, false);
  assert.equal(result.section, section);
  assert.deepEqual(result.errors, [{ code: "unknown-performer", performerId: "guest" }]);
});
