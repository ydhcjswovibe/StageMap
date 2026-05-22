export const COUPLE_MERGE_DISTANCE = 7.0;
export const PULL_OUT_MOVE_THRESHOLD = 0.8;

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function findIndependentMergeCandidate({
  performerId,
  rawPosition,
  positions = {},
  performers = [],
  pairs = [],
  sourcePair = null,
  maxDistance = COUPLE_MERGE_DISTANCE
}) {
  if (!performerId || !rawPosition || sourcePair) return null;
  if (pairs.some((pair) => pair.includes(performerId))) return null;
  let nearest = null;
  performers.forEach((performer) => {
    if (performer.id === performerId) return;
    if (pairs.some((pair) => pair.includes(performer.id))) return;
    const pos = positions?.[performer.id];
    if (!pos) return;
    const gap = distance(rawPosition, pos);
    if (gap <= maxDistance && (!nearest || gap < nearest.gap)) {
      nearest = { id: performer.id, gap };
    }
  });
  return nearest;
}

export function shouldStartPairMemberPullOut(drag, pointer, threshold = PULL_OUT_MOVE_THRESHOLD) {
  if (!drag?.canPullOutMember || drag.source !== "token" || !drag.longPressReady) return false;
  const start = drag.startPointer || drag.pointer;
  if (!start || !pointer) return false;
  return distance(pointer, start) > threshold;
}

export function resolveEmptyStageTap({ selectedPerformerId = "", selectedPairKey = "", tapMoveArmed = false } = {}) {
  if (!tapMoveArmed) return { type: "none", clearSelection: false };
  if (selectedPairKey) return { type: "move-pair", clearSelection: true };
  if (selectedPerformerId) return { type: "move-token", clearSelection: true };
  return { type: "none", clearSelection: true };
}

export function resolveSelectionClick({
  selectedPerformerId = "",
  selectedPairKey = "",
  performerId = "",
  performerPairKey = "",
  pairKey = ""
} = {}) {
  if (pairKey) {
    return selectedPairKey === pairKey ? { type: "clear" } : { type: "select-pair", pairKey };
  }

  if (performerPairKey) {
    return selectedPairKey === performerPairKey ? { type: "clear" } : { type: "select-pair", pairKey: performerPairKey };
  }

  if (performerId && selectedPerformerId === performerId && !selectedPairKey) return { type: "clear" };
  return performerId ? { type: "select-token", performerId } : { type: "none" };
}

export function resolveDropAction({ drag, connectCandidate = null, swapCandidate = null }) {
  if (!drag) return { type: "none" };

  if (drag.mode === "pair-move") {
    return {
      type: "move-pair",
      positions: drag.finalPositions || {}
    };
  }

  if (drag.mode !== "token-move") return { type: "none" };

  const positions = drag.finalPositions || {};
  const sourcePair = Array.isArray(drag.sourcePair) ? [...drag.sourcePair] : null;

  if (drag.individual && swapCandidate?.targetId) {
    return {
      type: "swap-same-role",
      performerId: drag.performerId,
      targetId: swapCandidate.targetId,
      positions
    };
  }

  const targetId = connectCandidate?.id || connectCandidate?.targetId || "";
  if (targetId) {
    return {
      type: "connect-pair",
      performerId: drag.performerId,
      targetId,
      ...(sourcePair ? { sourcePair } : {}),
      positions
    };
  }

  return {
    type: "move-token",
    performerId: drag.performerId,
    ...(sourcePair ? { sourcePair } : {}),
    positions
  };
}
