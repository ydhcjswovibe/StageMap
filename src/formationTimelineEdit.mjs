import { DEFAULT_FORMATION_SEGMENT_SECONDS, TIMELINE_TIME_STEP, clampFormationSpan, clampValue, pointMoveDuration, pointMoveStart, pointTime, quantizeTimelineDelta, quantizeTimelineTime } from "./timelineCore.mjs";

import { applySectionTiming, normalizeFormationSections, sortFormationSections } from "./formationTimeline.mjs";

function blockedFormationEdit(sections, sectionId, statusKind = "blocked", extra = {}) {
  return {
    sections: normalizeFormationSections(sections),
    selectedSectionId: sectionId,
    statusKind,
    ...extra
  };
}

function shiftSection(section, deltaTime) {
  const duration = quantizeTimelineDelta(pointMoveDuration(section));
  const end = quantizeTimelineTime(pointTime(section) + deltaTime);
  return applySectionTiming(section, Math.max(0, end - duration), end);
}

// Action helpers keep all formation-time invariants behind the dispatcher.
function addFormationAfterEdit(normalized, { sectionId, section, time }) {
  const previous = normalized.at(-1) || null;
  const previousEnd = previous ? pointTime(previous) : 0;
  const duration = DEFAULT_FORMATION_SEGMENT_SECONDS;
  const requestedEnd = Number.isFinite(Number(time)) ? quantizeTimelineTime(time) : quantizeTimelineTime(previousEnd + duration);
  const end = quantizeTimelineTime(Math.max(previousEnd + duration, requestedEnd));
  const start = quantizeTimelineTime(end - duration);
  const nextSection = applySectionTiming(section || { id: sectionId }, start, end);
  const nextSections = normalizeFormationSections([...normalized, nextSection]);
  return { sections: nextSections, selectedSectionId: nextSection.id, statusKind: "added" };
}

function trimFormationLeftEdit(normalized, sectionId, index, time) {
  if (index === 0) return blockedFormationEdit(normalized, sectionId);

  const current = normalized[index];
  const end = quantizeTimelineTime(pointTime(current));
  const previousEnd = quantizeTimelineTime(pointTime(normalized[index - 1]));
  const nextStart = quantizeTimelineTime(clampValue(time, previousEnd, end));
  const nextSections = normalized.map((item) => (
    item.id === sectionId ? applySectionTiming(item, nextStart, end) : item
  ));
  return { sections: normalizeFormationSections(nextSections), selectedSectionId: sectionId, statusKind: "updated" };
}

function shiftFollowingSectionsForRightTrim(normalized, index, end, signedDelta) {
  let contiguousCursor = end;
  let shouldPullContiguous = signedDelta < 0;

  return normalized.map((item, itemIndex) => {
    if (itemIndex <= index) return item;
    if (signedDelta > 0) return shiftSection(item, signedDelta);
    if (!shouldPullContiguous) return item;

    const itemStart = quantizeTimelineTime(pointMoveStart(item));
    if (Math.abs(itemStart - contiguousCursor) > TIMELINE_TIME_STEP / 2) {
      shouldPullContiguous = false;
      return item;
    }

    contiguousCursor = quantizeTimelineTime(pointTime(item));
    return shiftSection(item, signedDelta);
  });
}

function trimFormationRightEdit(normalized, sectionId, index, time) {
  const current = normalized[index];
  const start = quantizeTimelineTime(pointMoveStart(current));
  const end = quantizeTimelineTime(pointTime(current));
  const requestedEnd = quantizeTimelineTime(Math.max(start, Number(time) || 0));
  const signedDelta = requestedEnd - end;
  const shiftedFollowing = shiftFollowingSectionsForRightTrim(normalized, index, end, signedDelta);
  const nextSections = shiftedFollowing.map((item, itemIndex) => (
    itemIndex === index ? applySectionTiming(item, start, requestedEnd) : item
  ));

  return { sections: normalizeFormationSections(nextSections), selectedSectionId: sectionId, statusKind: "updated" };
}

function bodyDragBounds(current, previousSection, nextSection, timelineMax) {
  const duration = quantizeTimelineDelta(pointMoveDuration(current));
  const start = quantizeTimelineTime(pointMoveStart(current));
  const end = quantizeTimelineTime(pointTime(current));
  return {
    duration,
    start,
    end,
    minStart: previousSection ? quantizeTimelineTime(pointTime(previousSection)) : 0,
    maxEnd: nextSection ? quantizeTimelineTime(pointMoveStart(nextSection)) : quantizeTimelineTime(Math.max(Number(timelineMax) || 0, end))
  };
}

function bodyDragReorderPreview(normalized, sectionId, index, rawStart, rawEnd, previousSection, nextSection, thresholdRatio, dragBounds) {
  if (rawStart < dragBounds.minStart && previousSection && index > 1) {
    const previousStart = quantizeTimelineTime(pointMoveStart(previousSection));
    const previousDuration = quantizeTimelineDelta(pointMoveDuration(previousSection));
    const threshold = quantizeTimelineTime(previousStart + previousDuration * (1 - thresholdRatio));
    if (rawStart <= threshold) return blockedFormationEdit(normalized, sectionId, "reorder-preview", { ...dragBounds, toIndex: index - 1 });
  }

  if (rawEnd > dragBounds.maxEnd && nextSection) {
    const nextStart = quantizeTimelineTime(pointMoveStart(nextSection));
    const nextDuration = quantizeTimelineDelta(pointMoveDuration(nextSection));
    const threshold = quantizeTimelineTime(nextStart + nextDuration * thresholdRatio);
    if (rawEnd >= threshold) return blockedFormationEdit(normalized, sectionId, "reorder-preview", { ...dragBounds, toIndex: index + 1 });
  }

  return null;
}

function moveFormationBodyEdit(normalized, sectionId, index, { deltaTime = 0, timelineMax = 0, reorderThresholdRatio = 2 / 3 } = {}) {
  if (index === 0) return blockedFormationEdit(normalized, sectionId);

  const current = normalized[index];
  const previousSection = normalized[index - 1] || null;
  const nextSection = normalized[index + 1] || null;
  const bounds = bodyDragBounds(current, previousSection, nextSection, timelineMax);
  const quantizedDeltaTime = Math.abs(quantizeTimelineDelta(deltaTime));
  const signedDelta = Number(deltaTime) < 0 ? -quantizedDeltaTime : quantizedDeltaTime;
  const rawStart = quantizeTimelineTime(bounds.start + signedDelta);
  const rawEnd = quantizeTimelineTime(bounds.end + signedDelta);
  const thresholdRatio = clampValue(Number(reorderThresholdRatio) || 0, 0, 1);
  const span = clampFormationSpan({ start: rawStart, duration: bounds.duration, minStart: bounds.minStart, maxEnd: bounds.maxEnd });
  const dragBounds = {
    start: span.start,
    end: span.end,
    duration: span.duration,
    minStart: bounds.minStart,
    maxEnd: bounds.maxEnd
  };

  const reorderPreview = bodyDragReorderPreview(normalized, sectionId, index, rawStart, rawEnd, previousSection, nextSection, thresholdRatio, dragBounds);
  if (reorderPreview) return reorderPreview;

  if (span.start !== rawStart || span.end !== rawEnd) {
    return blockedFormationEdit(normalized, sectionId, "blocked", dragBounds);
  }

  const nextSections = normalized.map((item) => (
    item.id === sectionId ? applySectionTiming(item, rawStart, rawEnd) : item
  ));
  return { sections: normalizeFormationSections(nextSections), selectedSectionId: sectionId, statusKind: "updated", start: rawStart, end: rawEnd, duration: bounds.duration };
}

function reorderFormationEdit(normalized, sectionId, index, toIndex) {
  if (index === 0) return blockedFormationEdit(normalized, sectionId);

  const movable = [...normalized];
  const [moving] = movable.splice(index, 1);
  const targetIndex = clampValue(Number(toIndex) || 0, 1, movable.length);
  movable.splice(targetIndex, 0, moving);
  let cursor = 0;
  const nextSections = movable.map((item, itemIndex) => {
    const duration = itemIndex === 0
      ? quantizeTimelineDelta(pointTime(item))
      : quantizeTimelineDelta(pointMoveDuration(item));
    const startTime = itemIndex === 0 ? 0 : cursor;
    const endTime = quantizeTimelineTime(startTime + duration);
    cursor = endTime;
    return applySectionTiming(item, startTime, endTime);
  });
  return { sections: nextSections, selectedSectionId: sectionId, statusKind: "updated" };
}

// Dispatcher is the only supported entry point for formation timeline edits.
export function applyFormationTimelineEdit({
  sections = [],
  action,
  sectionId,
  time,
  deltaTime = 0,
  toIndex,
  section = null,
  timelineMax = 0,
  reorderThresholdRatio = 2 / 3
} = {}) {
  const normalized = normalizeFormationSections(sections);
  const index = normalized.findIndex((item) => item.id === sectionId);

  if (action === "add-after") {
    return addFormationAfterEdit(normalized, { sectionId, section, time });
  }

  if (index < 0) return blockedFormationEdit(normalized, sectionId);

  if (action === "trim-left") {
    return trimFormationLeftEdit(normalized, sectionId, index, time);
  }

  if (action === "trim-right") {
    return trimFormationRightEdit(normalized, sectionId, index, time);
  }

  if (action === "move-body") {
    return moveFormationBodyEdit(normalized, sectionId, index, { deltaTime, timelineMax, reorderThresholdRatio });
  }

  if (action === "reorder") {
    return reorderFormationEdit(normalized, sectionId, index, toIndex);
  }

  return blockedFormationEdit(normalized, sectionId);
}

// Compatibility wrappers preserve the older test/import surface while delegating to the dispatcher.
export function trimFormationSegment({ sections = [], sectionId, edge, time, timelineMax = 0 }) {
  const action = edge === "left" ? "trim-left" : edge === "right" ? "trim-right" : "";
  return applyFormationTimelineEdit({ sections, action, sectionId, time, timelineMax }).sections;
}

export function resolveFormationReorderIndex({ sections = [], sectionId, time }) {
  const sortedSections = [...sections].sort((a, b) => pointTime(a) - pointTime(b));
  const currentIndex = sortedSections.findIndex((section) => section.id === sectionId);
  if (currentIndex < 0) return currentIndex;
  if (currentIndex === 0) return 0;

  const movable = sortedSections.filter((section) => section.id !== sectionId);
  const targetTime = Math.max(0, Number(time) || 0);
  let toIndex = movable.length;
  for (let index = 0; index < movable.length; index += 1) {
    const midpoint = pointMoveStart(movable[index]) + pointMoveDuration(movable[index]) / 2;
    if (targetTime < midpoint) {
      toIndex = index;
      break;
    }
  }
  return toIndex;
}

export function resolveFormationBodyDrag({ sections = [], sectionId, deltaTime = 0, timelineMax = 0, reorderThresholdRatio = 2 / 3 }) {
  const normalized = normalizeFormationSections(sections);
  const index = normalized.findIndex((section) => section.id === sectionId);
  if (index < 0) {
    return { action: "blocked", index, start: 0, end: 0, duration: 0, toIndex: null };
  }

  const result = applyFormationTimelineEdit({
    sections: normalized,
    action: "move-body",
    sectionId,
    deltaTime,
    timelineMax,
    reorderThresholdRatio
  });
  const section = result.sections.find((item) => item.id === sectionId) || normalized[index];
  return {
    action: result.statusKind === "updated" ? "move" : result.statusKind,
    index,
    start: result.start ?? quantizeTimelineTime(pointMoveStart(section)),
    end: result.end ?? quantizeTimelineTime(pointTime(section)),
    duration: result.duration ?? quantizeTimelineDelta(pointMoveDuration(section)),
    toIndex: result.toIndex ?? null
  };
}

export function reorderFormationSegments({ sections = [], sectionId, toIndex }) {
  return applyFormationTimelineEdit({ sections, action: "reorder", sectionId, toIndex }).sections;
}
