import { clampValue, pointMoveDuration, pointMoveStart, pointTime, quantizeTimelineDelta, quantizeTimelineTime, timeToPercent, timeToPixels } from "./timelineCore.mjs";

export function sortFormationSections(sections = []) {
  return [...sections].sort((a, b) => pointTime(a) - pointTime(b));
}

export function applySectionTiming(section, start, end) {
  const nextStart = quantizeTimelineTime(start);
  const nextEnd = quantizeTimelineTime(Math.max(nextStart, end));
  return {
    ...section,
    start: nextStart,
    end: nextEnd,
    time: nextEnd,
    moveDuration: quantizeTimelineDelta(nextEnd - nextStart)
  };
}

export function normalizeFormationSections(sections = []) {
  let previousEnd = 0;
  return sortFormationSections(sections).map((section, index) => {
    const rawEnd = quantizeTimelineTime(pointTime(section));
    const rawStart = index === 0 ? 0 : quantizeTimelineTime(pointMoveStart(section));
    const start = quantizeTimelineTime(Math.max(previousEnd, rawStart));
    const end = quantizeTimelineTime(Math.max(start, rawEnd));
    previousEnd = end;
    return applySectionTiming(section, start, end);
  });
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
    sectionId: section?.id,
    isMarker: index === 0,
    leftPx,
    arrivalPx,
    widthPx: index === 0 ? 0 : Math.max(0, arrivalPx - leftPx)
  };
}

export function layoutFormationBlocks(sections = [], pixelsPerSecond, options = {}) {
  const markerWidthPx = Math.max(0, Number(options.markerWidthPx) || 68);
  const markerGapPx = Math.max(0, Number(options.markerGapPx) || 4);
  const minSegmentWidthPx = Math.max(0, Number(options.minSegmentWidthPx) || 0);
  const visualGapPx = Math.max(0, Number(options.visualGapPx) || 0);
  const introAsSegment = options.introAsSegment === true;
  const timelineStartOffsetPx = sections.length > 1 && !introAsSegment ? markerWidthPx + markerGapPx : 0;
  let visualCursorPx = 0;

  return sections.map((section, index) => {
    const block = formationTimelinePixels(section, index, pixelsPerSecond);
    const displayStartTime = index === 0 ? 0 : pointMoveStart(section);
    const displayEndTime = introAsSegment && index === 0
      ? pointTime(section)
      : pointTime(section);
    const introWidthPx = introAsSegment && index === 0
      ? timeToPixels(displayEndTime, pixelsPerSecond)
      : block.widthPx;
    const isMarker = block.isMarker && !(introAsSegment && index === 0);
    const widthPx = Math.max(0, introWidthPx);
    const isTick = !block.isMarker && block.widthPx === 0;
    const hitWidthPx = isMarker
      ? markerWidthPx
      : isTick ? 0 : Math.max(widthPx, minSegmentWidthPx);
    const logicalLeftPx = block.leftPx;
    const baseLeftPx = isMarker ? block.leftPx : block.leftPx + timelineStartOffsetPx;
    const leftPx = minSegmentWidthPx > 0 && !isTick
      ? Math.max(baseLeftPx, visualCursorPx)
      : baseLeftPx;
    if (!isTick) visualCursorPx = Math.max(visualCursorPx, leftPx + hitWidthPx + visualGapPx);
    return {
      ...block,
      isMarker,
      leftPx,
      logicalLeftPx,
      arrivalPx: isMarker ? block.arrivalPx : block.arrivalPx + timelineStartOffsetPx,
      widthPx,
      displayStartTime,
      displayEndTime,
      isTick,
      row: 0,
      hitWidthPx,
      visualRightPx: leftPx + hitWidthPx
    };
  });
}

export function resolveFormationAddTarget(sections, captureTime, options = {}) {
  const existingTolerance = Math.max(0, Number(options.existingTolerance) || 0.15);
  const sortedSections = [...(sections || [])].sort((a, b) => pointTime(a) - pointTime(b));
  const time = Math.max(0, Number(captureTime) || 0);
  const existing = sortedSections.find((section) => Math.abs(pointTime(section) - time) <= existingTolerance);
  if (existing) return { action: "select", section: existing };

  const previous = sortedSections.at(-1) || null;
  return {
    action: "append",
    previous,
    time
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
