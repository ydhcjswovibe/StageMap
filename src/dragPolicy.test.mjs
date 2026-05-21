import assert from "node:assert/strict";
import test from "node:test";

import { resolveDropAction } from "./dragPolicy.mjs";

const nearCandidate = { id: "p2", gap: 2 };
const nearSwap = { targetId: "p3", gap: 3 };

test("pair move commits only pair movement even when candidates exist", () => {
  const action = resolveDropAction({
    drag: { mode: "pair-move", finalPositions: { p1: { x: 20, y: 20 }, p2: { x: 30, y: 20 } } },
    connectCandidate: nearCandidate,
    swapCandidate: nearSwap
  });

  assert.deepEqual(action, {
    type: "move-pair",
    positions: { p1: { x: 20, y: 20 }, p2: { x: 30, y: 20 } }
  });
});

test("individual token movement prefers same-role swap over connecting a pair", () => {
  const action = resolveDropAction({
    drag: { mode: "token-move", individual: true, performerId: "p1", finalPositions: { p1: { x: 40, y: 40 } } },
    connectCandidate: nearCandidate,
    swapCandidate: nearSwap
  });

  assert.deepEqual(action, {
    type: "swap-same-role",
    performerId: "p1",
    targetId: "p3",
    positions: { p1: { x: 40, y: 40 } }
  });
});

test("plain token movement connects to a nearby token", () => {
  const action = resolveDropAction({
    drag: { mode: "token-move", individual: false, performerId: "p1", finalPositions: { p1: { x: 50, y: 50 } } },
    connectCandidate: nearCandidate
  });

  assert.deepEqual(action, {
    type: "connect-pair",
    performerId: "p1",
    targetId: "p2",
    positions: { p1: { x: 50, y: 50 } }
  });
});

test("token movement without a candidate only moves the token", () => {
  const action = resolveDropAction({
    drag: { mode: "token-move", performerId: "p1", finalPositions: { p1: { x: 60, y: 60 } } }
  });

  assert.deepEqual(action, {
    type: "move-token",
    performerId: "p1",
    positions: { p1: { x: 60, y: 60 } }
  });
});

test("tap movement uses the same action priority as drag movement", () => {
  const action = resolveDropAction({
    drag: { mode: "token-move", source: "tap", performerId: "p1", individual: true, finalPositions: { p1: { x: 70, y: 70 } } },
    connectCandidate: nearCandidate,
    swapCandidate: nearSwap
  });

  assert.equal(action.type, "swap-same-role");
});

test("pull-out movement can connect to an independent token", () => {
  const action = resolveDropAction({
    drag: { mode: "token-move", individual: true, sourcePair: ["p1", "p2"], performerId: "p1", finalPositions: { p1: { x: 50, y: 50 } } },
    connectCandidate: nearCandidate
  });

  assert.deepEqual(action, {
    type: "connect-pair",
    performerId: "p1",
    targetId: "p2",
    sourcePair: ["p1", "p2"],
    positions: { p1: { x: 50, y: 50 } }
  });
});

test("pull-out movement without an allowed target only splits and moves the token", () => {
  const action = resolveDropAction({
    drag: { mode: "token-move", individual: true, sourcePair: ["p1", "p2"], performerId: "p1", finalPositions: { p1: { x: 80, y: 40 } } }
  });

  assert.deepEqual(action, {
    type: "move-token",
    performerId: "p1",
    sourcePair: ["p1", "p2"],
    positions: { p1: { x: 80, y: 40 } }
  });
});
