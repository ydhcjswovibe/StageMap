import { clampValue, pointMoveDuration, pointMoveStart } from "./timelineCore.mjs";

export function clampMovementKeyframeT(value) {
  return clampValue(Number(value) || 0, 0, 1);
}

export function normalizeMovementKeyframes(keyframes = []) {
  return [...keyframes]
    .filter((keyframe) => keyframe && typeof keyframe === "object")
    .map((keyframe) => ({
      ...keyframe,
      t: clampMovementKeyframeT(keyframe.t)
    }))
    .sort((left, right) => left.t - right.t);
}

export function movementKeyframeTime(section, keyframe) {
  return pointMoveStart(section) + pointMoveDuration(section) * clampMovementKeyframeT(keyframe?.t);
}

export function movementKeyframePositions(section, keyframe) {
  return {
    ...(section?.positions || {}),
    ...(keyframe?.positions || {})
  };
}

export function applyMovementKeyframePositionPatch(keyframes = [], keyframeId, fallbackPositions = {}, patch = {}) {
  return normalizeMovementKeyframes(keyframes).map((keyframe) => {
    if (keyframe.id !== keyframeId) return keyframe;
    return {
      ...keyframe,
      positions: {
        ...fallbackPositions,
        ...(keyframe.positions || {}),
        ...patch
      }
    };
  });
}
