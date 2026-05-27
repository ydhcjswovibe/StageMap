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

function quantizeTimelineDelta(value, step = TIMELINE_TIME_STEP) {
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

export function clampFormationTiming({ sections = [], sectionId, time, moveDuration, timelineMax = 0 }) {
  const sortedSections = [...sections].sort((a, b) => pointTime(a) - pointTime(b));
  const sectionIndex = sortedSections.findIndex((section) => section.id === sectionId);
  const currentSection = sortedSections[sectionIndex] || {};
  const previousTime = sectionIndex > 0 ? pointTime(sortedSections[sectionIndex - 1]) : 0;
  const nextSection = sectionIndex >= 0 ? sortedSections[sectionIndex + 1] : null;
  const fallbackMax = Math.max(previousTime, pointTime(currentSection), Number(timelineMax) || 0);
  const nextMoveStart = nextSection ? pointMoveStart(nextSection) : fallbackMax;
  const requestedMoveDuration = moveDuration === null || moveDuration === undefined
    ? pointMoveDuration(currentSection)
    : Math.max(0, Number(moveDuration) || 0);
  const latestArrival = Math.max(previousTime, nextMoveStart);
  const maxMoveDuration = Math.max(0, latestArrival - previousTime);
  const safeMoveDuration = Math.min(maxMoveDuration, requestedMoveDuration);
  const safeTime = clampValue(Number(time) || 0, previousTime + safeMoveDuration, latestArrival);
  return {
    time: safeTime,
    moveDuration: safeMoveDuration,
    start: Math.max(0, safeTime - safeMoveDuration),
    end: safeTime
  };
}

export function formationTimelineLabel(index) {
  return `F${index + 1}`;
}

export function formationTimelineBlock(section, index, duration) {
  const arrivalTime = pointTime(section);
  const moveStart = Math.min(arrivalTime, pointMoveStart(section));
  const leftTime = index === 0 ? 0 : moveStart;
  const arrivalPercent = index === 0 ? 0 : timeToPercent(arrivalTime, duration);
  const leftPercent = timeToPercent(leftTime, duration);
  return {
    isMarker: index === 0,
    leftPercent,
    arrivalPercent,
    widthPercent: index === 0 ? 0 : Math.max(0, arrivalPercent - leftPercent)
  };
}

export function formationTimelinePixels(section, index, pixelsPerSecond) {
  const arrivalTime = pointTime(section);
  const moveStart = Math.min(arrivalTime, pointMoveStart(section));
  const leftTime = index === 0 ? 0 : moveStart;
  const leftPx = timeToPixels(leftTime, pixelsPerSecond);
  const arrivalPx = index === 0 ? 0 : timeToPixels(arrivalTime, pixelsPerSecond);
  return {
    isMarker: index === 0,
    leftPx,
    arrivalPx,
    widthPx: index === 0 ? 0 : Math.max(0, arrivalPx - leftPx)
  };
}

export function resolveFormationAddTarget(sections, captureTime, options = {}) {
  const existingTolerance = Math.max(0, Number(options.existingTolerance) || 0.15);
  const appendGap = Math.max(0, Number(options.appendGap) || 4);
  const sortedSections = [...(sections || [])].sort((a, b) => pointTime(a) - pointTime(b));
  const time = Math.max(0, Number(captureTime) || 0);
  const existing = sortedSections.find((section) => Math.abs(pointTime(section) - time) <= existingTolerance);
  if (existing) return { action: "select", section: existing };

  const previous = sortedSections.at(-1) || null;
  const previousTime = previous ? pointTime(previous) : 0;
  const arrivalTime = previous && time <= previousTime + existingTolerance ? previousTime + appendGap : time;
  const gap = previous ? Math.max(0, arrivalTime - previousTime) : 0;
  return {
    action: "append",
    previous,
    time: arrivalTime,
    moveDuration: previous ? Math.min(4, gap) : 0
  };
}

export function buildTimelineTicks(duration, options = {}) {
  const safeDuration = Math.max(0, Number(duration) || 0);
  const pixelsPerSecond = Math.max(0, Number(options.pixelsPerSecond) || 0);
  const scrollX = Math.max(0, Number(options.scrollX) || 0);
  const viewportWidth = Math.max(0, Number(options.viewportWidth) || 0);
  const targetPixelSpacing = 88;
  const rawInterval = pixelsPerSecond ? targetPixelSpacing / pixelsPerSecond : 0;
  const interval = pixelsPerSecond
    ? rawInterval <= 0.5 ? 0.5 : rawInterval <= 1 ? 1 : rawInterval <= 2 ? 2 : rawInterval <= 5 ? 5 : rawInterval <= 10 ? 10 : 30
    : safeDuration <= 30 ? 5 : safeDuration <= 90 ? 10 : 30;
  const ticks = [];
  const startTime = pixelsPerSecond && viewportWidth ? Math.max(0, Math.floor(pixelsToTime(scrollX, pixelsPerSecond) / interval) * interval) : 0;
  const endTime = pixelsPerSecond && viewportWidth ? Math.min(safeDuration, pixelsToTime(scrollX + viewportWidth, pixelsPerSecond) + interval) : safeDuration;
  for (let time = startTime; time <= endTime + 0.0001; time += interval) {
    const roundedTime = Math.round(time * 10) / 10;
    ticks.push({
      time: roundedTime,
      label: interval < 1 ? `${roundedTime.toFixed(1)}s` : `${Math.round(roundedTime)}s`,
      percent: timeToPercent(roundedTime, safeDuration),
      pixel: timeToPixels(roundedTime, pixelsPerSecond || safeDuration)
    });
  }
  if (!pixelsPerSecond && !ticks.some((tick) => tick.time === safeDuration)) {
    ticks.push({ time: safeDuration, label: `${Math.round(safeDuration)}s`, percent: 100, pixel: safeDuration });
  }
  return ticks;
}

export function snapFormationTime(rawTime, options = {}) {
  const minTime = Math.max(0, Number(options.minTime) || 0);
  const maxTime = Math.max(minTime, Number(options.maxTime) || minTime);
  const boundedTime = clampValue(quantizeTimelineTime(rawTime), minTime, maxTime);
  if (options.enabled === false) return { time: boundedTime, snapped: false };

  const threshold = Math.max(0, Number(options.threshold) || 0.18);
  const candidates = [];
  const addCandidate = (time, type, priority) => {
    const value = quantizeTimelineTime(time);
    if (!Number.isFinite(value) || value < minTime || value > maxTime) return;
    candidates.push({ time: value, type, priority, distance: Math.abs(value - boundedTime) });
  };

  for (const section of options.sections || []) {
    if (section?.id === options.sectionId) continue;
    addCandidate(pointMoveStart(section), "formation-start", 0);
    addCandidate(pointTime(section), "formation-arrival", 0);
  }
  addCandidate(options.playheadTime, "playhead", 1);
  const gridSize = Math.max(0, Number(options.gridSize) || 0);
  if (gridSize) addCandidate(quantizeTimelineTime(boundedTime, gridSize), "grid", 2);

  const best = candidates
    .filter((candidate) => candidate.distance <= threshold)
    .sort((left, right) => left.distance - right.distance || left.priority - right.priority)[0];
  if (!best) return { time: boundedTime, snapped: false };
  return { time: best.time, snapped: true, snapPoint: { time: best.time, type: best.type } };
}

export function trimFormationSegment({ sections = [], sectionId, edge, time, timelineMax = 0 }) {
  const sortedSections = [...sections].sort((a, b) => pointTime(a) - pointTime(b));
  const index = sortedSections.findIndex((section) => section.id === sectionId);
  if (index <= 0) return sortedSections;

  const section = sortedSections[index];
  const start = quantizeTimelineTime(pointMoveStart(section));
  const end = quantizeTimelineTime(pointTime(section));
  const requestedTime = quantizeTimelineTime(time);

  if (edge === "left") {
    const previousEnd = quantizeTimelineTime(pointTime(sortedSections[index - 1]));
    const nextStart = end;
    const nextStartTime = quantizeTimelineTime(clampValue(requestedTime, previousEnd, nextStart));
    return sortedSections.map((item) => item.id === sectionId
      ? { ...item, time: end, end, start: nextStartTime, moveDuration: quantizeTimelineDelta(end - nextStartTime) }
      : item);
  }

  if (edge !== "right") return sortedSections;

  const nextSection = sortedSections[index + 1] || null;
  const nextStart = nextSection ? quantizeTimelineTime(pointMoveStart(nextSection)) : quantizeTimelineTime(Math.max(Number(timelineMax) || 0, requestedTime, end));
  const nextEndTime = Math.max(start, requestedTime);
  const delta = quantizeTimelineDelta(nextEndTime - end);
  const gapDelta = quantizeTimelineDelta(Math.max(0, nextStart - end));
  const selectedDelta = quantizeTimelineDelta(delta < 0 ? Math.max(delta, -Math.max(0, end - start)) : delta);
  const rippleDelta = quantizeTimelineDelta(Math.max(0, selectedDelta - gapDelta));

  return sortedSections.map((item, itemIndex) => {
    if (itemIndex < index) return item;
    if (itemIndex === index) {
      const updatedEnd = quantizeTimelineTime(end + selectedDelta);
      return { ...item, time: updatedEnd, end: updatedEnd, start, moveDuration: quantizeTimelineDelta(updatedEnd - start) };
    }
    if (rippleDelta <= 0) return item;
    const itemEnd = quantizeTimelineTime(pointTime(item) + rippleDelta);
    const itemDuration = quantizeTimelineDelta(pointMoveDuration(item));
    return {
      ...item,
      time: itemEnd,
      end: itemEnd,
      start: Math.max(0, itemEnd - itemDuration)
    };
  });
}

export function resolveFormationReorderIndex({ sections = [], sectionId, time }) {
  const sortedSections = [...sections].sort((a, b) => pointTime(a) - pointTime(b));
  const currentIndex = sortedSections.findIndex((section) => section.id === sectionId);
  if (currentIndex <= 0) return currentIndex;

  const movable = sortedSections.slice(1).filter((section) => section.id !== sectionId);
  const targetTime = Math.max(0, Number(time) || 0);
  let toIndex = movable.length + 1;
  for (let index = 0; index < movable.length; index += 1) {
    const midpoint = pointMoveStart(movable[index]) + pointMoveDuration(movable[index]) / 2;
    if (targetTime < midpoint) {
      toIndex = index + 1;
      break;
    }
  }
  return toIndex;
}

export function resolveFormationBodyDrag({ sections = [], sectionId, deltaTime = 0, timelineMax = 0, reorderThresholdRatio = 2 / 3 }) {
  const sortedSections = [...sections].sort((a, b) => pointTime(a) - pointTime(b));
  const index = sortedSections.findIndex((section) => section.id === sectionId);
  if (index <= 0) {
    return { action: "blocked", index, start: 0, end: 0, duration: 0, toIndex: null };
  }

  const section = sortedSections[index];
  const duration = quantizeTimelineDelta(pointMoveDuration(section));
  const start = quantizeTimelineTime(pointMoveStart(section));
  const end = quantizeTimelineTime(pointTime(section));
  const previousSection = sortedSections[index - 1] || null;
  const nextSection = sortedSections[index + 1] || null;
  const minStart = previousSection ? quantizeTimelineTime(pointTime(previousSection)) : 0;
  const maxEnd = nextSection ? quantizeTimelineTime(pointMoveStart(nextSection)) : quantizeTimelineTime(Math.max(Number(timelineMax) || 0, end));
  const quantizedDeltaTime = quantizeTimelineDelta(deltaTime);
  const rawStart = quantizeTimelineTime(start + quantizedDeltaTime);
  const rawEnd = quantizeTimelineTime(end + quantizedDeltaTime);
  const span = clampFormationSpan({ start: rawStart, duration, minStart, maxEnd });
  const base = {
    index,
    start: span.start,
    end: span.end,
    duration: span.duration,
    toIndex: null
  };
  const thresholdRatio = clampValue(Number(reorderThresholdRatio) || 0, 0, 1);

  if (rawStart < minStart && previousSection && index > 1) {
    const previousStart = quantizeTimelineTime(pointMoveStart(previousSection));
    const previousDuration = quantizeTimelineDelta(pointMoveDuration(previousSection));
    const threshold = quantizeTimelineTime(previousStart + previousDuration * (1 - thresholdRatio));
    if (rawStart <= threshold) return { ...base, action: "reorder-preview", toIndex: index - 1 };
  }

  if (rawEnd > maxEnd && nextSection) {
    const nextStart = quantizeTimelineTime(pointMoveStart(nextSection));
    const nextDuration = quantizeTimelineDelta(pointMoveDuration(nextSection));
    const threshold = quantizeTimelineTime(nextStart + nextDuration * thresholdRatio);
    if (rawEnd >= threshold) return { ...base, action: "reorder-preview", toIndex: index + 1 };
  }

  if (span.start !== rawStart || span.end !== rawEnd) return { ...base, action: "blocked" };
  return { ...base, action: "move" };
}

export function reorderFormationSegments({ sections = [], sectionId, toIndex }) {
  const sortedSections = [...sections].sort((a, b) => pointTime(a) - pointTime(b));
  const fromIndex = sortedSections.findIndex((section) => section.id === sectionId);
  if (fromIndex <= 0) return sortedSections;

  const first = { ...sortedSections[0], time: 0, start: 0, end: 0, moveDuration: 0 };
  const movable = sortedSections.slice(1);
  const movableFrom = fromIndex - 1;
  const [section] = movable.splice(movableFrom, 1);
  const movableTo = clampValue((Number(toIndex) || 1) - 1, 0, movable.length);
  movable.splice(movableTo, 0, section);

  let cursor = pointTime(first);
  return [
    first,
    ...movable.map((item) => {
      const duration = quantizeTimelineDelta(pointMoveDuration(item));
      const start = quantizeTimelineTime(cursor);
      const end = quantizeTimelineTime(start + duration);
      cursor = end;
      return { ...item, start, end, time: end, moveDuration: duration };
    })
  ];
}

export function buildWaveformBars(count = 96) {
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin(index * 0.55) * 0.5 + Math.sin(index * 0.17) * 0.35;
    return Math.max(0.18, Math.min(1, Math.abs(wave)));
  });
}
