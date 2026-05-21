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
