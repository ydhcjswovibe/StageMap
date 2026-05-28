export function timeToPercent(time, duration) {
  const safeDuration = Math.max(0, Number(duration) || 0);
  if (!safeDuration) return 0;
  return Math.min(100, Math.max(0, ((Number(time) || 0) / safeDuration) * 100));
}

export function clampValue(value, min, max) {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  return Math.min(safeMax, Math.max(safeMin, value));
}

export const TIMELINE_TIME_STEP = 0.1;

export const DEFAULT_FORMATION_SEGMENT_SECONDS = 4;

export function quantizeTimelineDelta(value, step = TIMELINE_TIME_STEP) {
  const safeStep = Math.max(0.001, Number(step) || TIMELINE_TIME_STEP);
  const numeric = Number(value) || 0;
  const scaled = numeric / safeStep;
  return Number((Math.round(scaled + Math.sign(scaled || 1) * 1e-9) * safeStep).toFixed(6));
}

export function quantizeTimelineTime(value, step = TIMELINE_TIME_STEP) {
  return Math.max(0, quantizeTimelineDelta(value, step));
}

export function timeToPixels(time, pixelsPerSecond) {
  return Math.max(0, Number(time) || 0) * Math.max(1, Number(pixelsPerSecond) || 1);
}

export function pixelsToTime(pixels, pixelsPerSecond) {
  return Math.max(0, Number(pixels) || 0) / Math.max(1, Number(pixelsPerSecond) || 1);
}

export function calculateTimelineMaxScrollX(duration, pixelsPerSecond, viewportWidth) {
  return Math.max(0, timeToPixels(duration, pixelsPerSecond) - Math.max(0, Number(viewportWidth) || 0));
}

export function calculateAnchoredZoomScrollX({ scrollX, cursorViewportX, currentZoom, nextZoom, timelineDuration, viewportWidth }) {
  if (!Number.isFinite(currentZoom) || currentZoom <= 0 || !Number.isFinite(nextZoom) || nextZoom <= 0) {
    return Math.max(0, Number(scrollX) || 0);
  }
  const cursorTime = pixelsToTime((Number(scrollX) || 0) + (Number(cursorViewportX) || 0), currentZoom);
  const nextScrollX = timeToPixels(cursorTime, nextZoom) - (Number(cursorViewportX) || 0);
  return clampValue(nextScrollX, 0, calculateTimelineMaxScrollX(timelineDuration, nextZoom, viewportWidth));
}

export function normalizeWheelDelta(delta, deltaMode) {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * 120;
  return delta;
}

export function pointTime(point) {
  return Number.isFinite(Number(point?.time)) ? Number(point.time) : Number(point?.end) || 0;
}

export function pointMoveDuration(point) {
  if (Number.isFinite(Number(point?.moveDuration))) return Math.max(0, Number(point.moveDuration));
  if (point?.moveMode === "hold") return 0;
  return Math.max(0, (Number(point?.end) || 0) - (Number(point?.start) || 0));
}

export function pointMoveStart(point) {
  return Math.max(0, pointTime(point) - pointMoveDuration(point));
}

export function clampFormationSpan({ start, duration, minStart = 0, maxEnd = 0 }) {
  const safeMinStart = Math.max(0, Number(minStart) || 0);
  const safeMaxEnd = Math.max(safeMinStart, Number(maxEnd) || safeMinStart);
  const safeDuration = Math.min(Math.max(0, Number(duration) || 0), safeMaxEnd - safeMinStart);
  const latestStart = Math.max(safeMinStart, safeMaxEnd - safeDuration);
  const safeStart = clampValue(Number(start) || 0, safeMinStart, latestStart);
  return {
    start: safeStart,
    end: safeStart + safeDuration,
    duration: safeDuration
  };
}
