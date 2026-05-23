import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  COUPLE_MERGE_DISTANCE,
  findIndependentMergeCandidate,
  resolveEmptyStageTap,
  resolveSelectionClick,
  resolveDropAction,
  shouldStartPairMemberPullOut
} from "./dragPolicy.mjs";

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

test("armed selection moves on the first empty stage tap", () => {
  assert.deepEqual(resolveEmptyStageTap({
    selectedPerformerId: "p1",
    selectedPairKey: "",
    tapMoveArmed: true
  }), {
    type: "move-token",
    clearSelection: true
  });

  assert.deepEqual(resolveEmptyStageTap({
    selectedPerformerId: "",
    selectedPairKey: "p1:p2",
    tapMoveArmed: true
  }), {
    type: "move-pair",
    clearSelection: true
  });
});

test("empty stage tap does not repeat after move disarms selection", () => {
  assert.deepEqual(resolveEmptyStageTap({
    selectedPerformerId: "",
    selectedPairKey: "",
    tapMoveArmed: false
  }), {
    type: "none",
    clearSelection: false
  });
});

test("reclicking a selected independent token clears selection", () => {
  assert.deepEqual(resolveSelectionClick({
    selectedPerformerId: "p1",
    selectedPairKey: "",
    performerId: "p1",
    performerPairKey: ""
  }), {
    type: "clear"
  });
});

test("reclicking a selected pair line or pair member clears pair selection", () => {
  assert.deepEqual(resolveSelectionClick({
    selectedPerformerId: "",
    selectedPairKey: "p1:p2",
    pairKey: "p1:p2"
  }), {
    type: "clear"
  });

  assert.deepEqual(resolveSelectionClick({
    selectedPerformerId: "p1",
    selectedPairKey: "p1:p2",
    performerId: "p1",
    performerPairKey: "p1:p2"
  }), {
    type: "clear"
  });
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

test("merge candidates allow visually overlapping tokens", () => {
  const candidate = findIndependentMergeCandidate({
    performerId: "p1",
    rawPosition: { x: 49.3, y: 50 },
    positions: {
      p1: { x: 50, y: 50 },
      p2: { x: 56.2, y: 50 }
    },
    performers: [{ id: "p1" }, { id: "p2" }],
    pairs: []
  });

  assert.equal(candidate?.id, "p2");
  assert.ok(candidate.gap <= COUPLE_MERGE_DISTANCE);
});

test("nearby but non-overlapping tokens do not create a merge candidate", () => {
  const candidate = findIndependentMergeCandidate({
    performerId: "p1",
    rawPosition: { x: 49.1, y: 50 },
    positions: {
      p1: { x: 50, y: 50 },
      p2: { x: 56.2, y: 50 }
    },
    performers: [{ id: "p1" }, { id: "p2" }],
    pairs: []
  });

  assert.equal(candidate, null);
});

test("snapped closeness alone does not create a merge candidate", () => {
  const candidate = findIndependentMergeCandidate({
    performerId: "p1",
    rawPosition: { x: 49.1, y: 50 },
    positions: {
      p1: { x: 50, y: 50 },
      p2: { x: 56.2, y: 50 }
    },
    performers: [{ id: "p1" }, { id: "p2" }],
    pairs: []
  });

  assert.equal(candidate, null);
});

test("merge candidates require both tokens to be independent", () => {
  const candidate = findIndependentMergeCandidate({
    performerId: "p1",
    rawPosition: { x: 49.3, y: 50 },
    positions: {
      p1: { x: 50, y: 50 },
      p2: { x: 56.2, y: 50 },
      p3: { x: 65, y: 50 }
    },
    performers: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
    pairs: [["p2", "p3"]]
  });

  assert.equal(candidate, null);
});

test("pair member pull-out requires long-press readiness before movement", () => {
  const drag = {
    mode: "pair-move",
    source: "token",
    canPullOutMember: true,
    startPointer: { x: 10, y: 10 }
  };

  assert.equal(shouldStartPairMemberPullOut(drag, { x: 12, y: 10 }), false);
  drag.longPressReady = true;
  assert.equal(shouldStartPairMemberPullOut(drag, { x: 12, y: 10 }), true);
});

test("long-press readiness without movement keeps the pair together", () => {
  const drag = {
    mode: "pair-move",
    source: "token",
    canPullOutMember: true,
    longPressReady: true,
    startPointer: { x: 10, y: 10 }
  };

  assert.equal(shouldStartPairMemberPullOut(drag, { x: 10.2, y: 10.1 }), false);
});

test("completed pointer drags clear the active performer or pair selection", () => {
  const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const finishTokenDrag = appSource.match(/function finishTokenDrag\(\) \{[\s\S]*?function clearDrag/)?.[0] || "";
  const finishPairDrag = appSource.match(/function finishPairDrag\(\) \{[\s\S]*?function onPairPointerDown/)?.[0] || "";

  assert.match(finishTokenDrag, /if \(drag\.moved\) \{[\s\S]*?commitDropAction\(action, drag\);[\s\S]*?clearSelection\(\);[\s\S]*?\}/);
  assert.match(finishPairDrag, /if \(drag\?\.mode === "pair-move" && drag\.finalPositions\) \{[\s\S]*?commitDropAction\(action, drag\);[\s\S]*?clearSelection\(\);[\s\S]*?\}/);
});

test("formation changes clear performer and pair selection", () => {
  const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const jumpTo = appSource.match(/function jumpTo\(section\) \{[\s\S]*?\n  \}/)?.[0] || "";
  const playbackSectionSync = appSource.match(/useEffect\(\(\) => \{[\s\S]*?activeSection\?\.id[\s\S]*?\}, \[isPlaying, activeSection\?\.id\]\);/)?.[0] || "";

  assert.match(jumpTo, /clearSelection\(\);/);
  assert.match(playbackSectionSync, /clearSelection\(\);/);
});
