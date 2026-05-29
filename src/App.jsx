import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { STAGE_GRID_X, STAGE_GRID_Y, findPairGridPlacement, pairPlacementCollides } from "./pairLayout.mjs";
import { loadCloudProject, loadCloudProjectByEditToken, saveCloudProject, saveCloudProjectByEditToken } from "./cloudProject.mjs";
import { authRedirectTo, authRequest, createMovemapSupabaseClient, getAuthSession, onAuthStateChange, signInWithGoogle, signInWithGoogleIdentity, signOut } from "./authClient.mjs";
import { findIndependentMergeCandidate, resolveDropAction, resolveEmptyStageTap, resolveSelectionClick, shouldStartPairMemberPullOut } from "./dragPolicy.mjs";
import { createProjectJsonDownload, validateProjectImport, withProjectSnapshotMetadata } from "./projectJson.mjs";
import { partnerSetIdForAddedSection } from "./sectionPolicy.mjs";
import { canCreateLink, canOwnCloudProject, canUseAiProposal, planCapabilities } from "./planCapabilities.mjs";
import { createEditShareUrl, createShareUrl } from "./shareUrl.mjs";
import { LINK_TYPES, authorizeShareRoute, createEditLinkToken, linkModeFromLocation, projectWithShareLink, projectWithShareLinkEnabled } from "./shareLinks.mjs";
import { alignSelectedPerformers, deleteSelectionTarget, duplicateSelectionTarget, moveSelectedPerformers, performerIdsForRole, togglePerformerSelection } from "./formationTools.mjs";
import { buildTransitionPaths, longDistanceWarnings, overlapWarnings, transitionPathStyle } from "./transitionView.mjs";
import { defaultStageReferences, normalizeStageReferences, renderStageReferenceSvg, stageReferenceRenderItems } from "./stageReference.mjs";
import { FORMATION_TEMPLATES, applyTemplatePositionsToSection, buildFormationTemplatePreview } from "./formationTemplates.mjs";
import { acceptFormationProposal, validateFormationProposal } from "./formationProposal.mjs";
import { buildStage3dProjection } from "./stage3dProjection.mjs";
import { MOVEMAP_AUDIO_BUCKET, audioPublicUrl, audioUploadErrorMessage, nextAudioSourceCandidate } from "./audioStorage.mjs";
import {
  applyFormationTimelineEdit,
  applyMovementKeyframePositionPatch,
  buildTimelineTicks,
  buildWaveformBars,
  calculateAnchoredZoomScrollX,
  calculateTimelineMaxScrollX,
  clampValue,
  formationTimelineLabel,
  layoutFormationBlocks,
  movementKeyframeTime,
  movementKeyframePositions,
  normalizeWheelDelta,
  normalizeMovementKeyframes,
  pixelsToTime,
  pointMoveDuration,
  pointMoveStart,
  pointTime,
  quantizeTimelineTime,
  resolveFormationAddTarget,
  snapFormationTime
} from "./timelinePolicy.mjs";

const STORAGE_KEY = "movemap-project";
const LEGACY_STORAGE_KEY = "choreo-stage-planner-project";
const STAGE_WIDTH = 900;
const STAGE_HEIGHT = 560;
const ROLE_COLORS = {
  groupA: ["#2457c5", "#3478f6", "#3b82f6", "#60a5fa", "#1d4ed8"],
  groupB: ["#c0265f", "#e84a7f", "#f9739a", "#fb7185", "#be185d"],
  other: ["#6d5dfc", "#14b8a6", "#f59e0b", "#64748b"]
};

const PERFORMANCE_TYPES = {
  shine: "솔로/그룹",
  pair: "페어/파트너",
  mixed: "혼합 대형"
};

const MOVE_MODES = {
  hold: "고정",
  smooth: "부드럽게 이동",
  late: "늦게 이동"
};
const HISTORY_LIMIT = 50;
const MAGNET_DISTANCE = 4.8;
const LONG_PRESS_MS = 450;
const TOKEN_RADIUS = 4.2;
const SELECTED_RING_RADIUS = 5.35;
const PAIR_RING_RADIUS = 4.45;
const SELECTED_PAIR_RING_RADIUS = 4.9;
const GRID_X = STAGE_GRID_X;
const GRID_Y = STAGE_GRID_Y;

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function formatTime(seconds = 0) {
  const safe = quantizeTimelineTime(seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.round((safe % 1) * 10);
  return `${mins}:${String(secs).padStart(2, "0")}.${tenths}`;
}

function formatClockTime(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function parseNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clonePlan(plan) {
  return plan ? JSON.parse(JSON.stringify(plan)) : plan;
}

function plansEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function escapeSvgText(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeFilename(value = "") {
  return String(value || "untitled")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function hashString(value = "") {
  let hash = 5381;
  for (const char of String(value)) {
    hash = ((hash << 5) + hash) ^ char.codePointAt(0);
  }
  return (hash >>> 0).toString(36);
}

function safeStorageSegment(value = "", fallback = "file") {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  const ascii = normalized
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return ascii || `${fallback}-${hashString(value)}`;
}

function audioStorageName(file, fingerprint) {
  const originalName = file.name || "audio";
  const dotIndex = originalName.lastIndexOf(".");
  const baseName = dotIndex > 0 ? originalName.slice(0, dotIndex) : originalName;
  const extension = dotIndex > 0 ? originalName.slice(dotIndex + 1) : "audio";
  return [
    safeStorageSegment(baseName, "audio"),
    safeStorageSegment(fingerprint, "audio"),
    safeStorageSegment(extension, "audio")
  ].join(".");
}

function resolveAudioUrl(audio) {
  if (!audio) return "";
  return audio.publicUrl || audioPublicUrl(audio.storagePath, supabaseConfig());
}

function audioFingerprint(file) {
  return [
    safeStorageSegment(file.name || "audio", "audio"),
    file.size || 0,
    file.lastModified || 0
  ].join("-");
}

function audioMatchesFile(audio, file, fingerprint = audioFingerprint(file)) {
  if (!audio || !file) return false;
  if (audio.fingerprint && audio.fingerprint === fingerprint) return true;
  return audio.fileName === file.name && audio.size === file.size && (!audio.type || audio.type === (file.type || "audio/*"));
}

function audioMetadataFromFile(file, storagePath, fingerprint) {
  return {
    fileName: file.name,
    size: file.size,
    type: file.type || "audio/*",
    lastModified: file.lastModified || 0,
    fingerprint,
    storagePath,
    bucket: MOVEMAP_AUDIO_BUCKET,
    publicUrl: audioPublicUrl(storagePath, supabaseConfig()),
    uploadedAt: new Date().toISOString()
  };
}

function interpolate(a, b, progress) {
  return {
    x: a.x + (b.x - a.x) * progress,
    y: a.y + (b.y - a.y) * progress
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pairKey(pair) {
  return [...pair].sort().join(":");
}

function tokenName(performer) {
  const value = String(performer.name || "").trim();
  return value || performer.label;
}

function tokenShortName(performer) {
  const value = tokenName(performer);
  const hasKorean = /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(value);
  return Array.from(value.replace(/\s+/g, "")).slice(0, hasKorean ? 2 : 3).join("");
}

function tokenFontSize(performer) {
  const length = Array.from(tokenShortName(performer)).length;
  if (length <= 1) return 3.8;
  if (length === 2) return 3.35;
  return 2.85;
}

function hexToRgb(hex) {
  const value = String(hex || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

function blendHexColors(first, second, fallback = "#7f1d1d") {
  const left = hexToRgb(first);
  const right = hexToRgb(second);
  if (!left || !right) return fallback;
  return rgbToHex({
    r: (left.r + right.r) / 2,
    g: (left.g + right.g) / 2,
    b: (left.b + right.b) / 2
  });
}

function performerColorForPair(plan, pair) {
  const first = plan.performers.find((performer) => performer.id === pair?.[0]);
  const second = plan.performers.find((performer) => performer.id === pair?.[1]);
  return blendHexColors(first?.color, second?.color);
}

function pairForPerformerId(pairs = [], performerId) {
  return pairs.find((pair) => pair.includes(performerId)) || null;
}

function snapPoint(point, enabled) {
  if (!enabled) return point;
  const nearest = (value, points) => points.reduce((best, item) => (
    Math.abs(item - value) < Math.abs(best - value) ? item : best
  ), points[0]);
  return {
    x: nearest(point.x, GRID_X),
    y: nearest(point.y, GRID_Y)
  };
}

function sectionsTimingSignature(sections) {
  return sections.map((section) => [
    section.id,
    quantizeTimelineTime(pointMoveStart(section)),
    quantizeTimelineTime(pointTime(section)),
    quantizeTimelineTime(pointMoveDuration(section))
  ].join(":")).join("|");
}

function normalizeSection(section) {
  const time = pointTime(section);
  const moveDuration = pointMoveDuration(section);
  return {
    ...section,
    time,
    moveDuration,
    start: Math.max(0, time - moveDuration),
    end: time,
    moveMode: section.moveMode || "smooth",
    movementKeyframes: normalizeMovementKeyframes(section.movementKeyframes)
  };
}

function normalizePlan(plan) {
  if (!plan?.sections) return plan;
  return {
    ...plan,
    localProjectId: plan.localProjectId || uid("project"),
    owner: plan.owner || { sessionId: "", createdAt: "" },
    account: { plan: plan.account?.plan || "guest" },
    shareLinks: {
      view: { projectId: "", token: "", enabled: true, ...(plan.shareLinks?.view || {}) },
      edit: { projectId: "", token: "", enabled: true, ...(plan.shareLinks?.edit || {}) }
    },
    stageReferences: normalizeStageReferences(plan.stageReferences, plan.frontZone),
    sections: plan.sections.map(normalizeSection).sort((a, b) => pointTime(a) - pointTime(b))
  };
}

function defaultSections(performers) {
  const firstPositions = {};
  const count = Math.max(1, performers.length);
  performers.forEach((performer, index) => {
    const col = index % Math.ceil(count / 2);
    const row = Math.floor(index / Math.ceil(count / 2));
    firstPositions[performer.id] = {
      x: 18 + col * (64 / Math.max(1, Math.ceil(count / 2) - 1 || 1)),
      y: row === 0 ? 70 : 42
    };
  });

  return [
    {
      id: uid("sec"),
      name: "Intro",
      time: 4,
      moveDuration: 4,
      start: 0,
      end: 4,
      notes: "첫 대형을 잡고 관객에게 전체 인원을 보여줍니다.",
      moveMode: "hold",
      positions: firstPositions,
      frontFocus: performers.slice(0, Math.min(4, performers.length)).map((p) => p.id),
      partnerSetId: ""
    }
  ];
}

function createProject({ title, performanceType, groupACount, groupBCount, names }) {
  const performers = [];
  for (let i = 0; i < groupACount; i += 1) {
    performers.push({
      id: uid("a"),
      label: `A${i + 1}`,
      name: names?.groupA?.[i] || `A${i + 1}`,
      role: "groupA",
      color: ROLE_COLORS.groupA[i % ROLE_COLORS.groupA.length]
    });
  }
  for (let i = 0; i < groupBCount; i += 1) {
    performers.push({
      id: uid("b"),
      label: `B${i + 1}`,
      name: names?.groupB?.[i] || `B${i + 1}`,
      role: "groupB",
      color: ROLE_COLORS.groupB[i % ROLE_COLORS.groupB.length]
    });
  }

  return {
    title: title || "새 Movemap 프로젝트",
    performanceType,
    performers,
    sections: defaultSections(performers),
    partnerSets: [],
    stage: { width: 100, height: 100 },
    frontZone: { y: 70 },
    stageReferences: defaultStageReferences({ y: 70 }),
    localProjectId: uid("project"),
    owner: { sessionId: "", createdAt: "" },
    account: { plan: "guest" },
    shareLinks: {
      view: { projectId: "", token: "", enabled: true },
      edit: { projectId: "", token: "", enabled: true }
    },
    updatedAt: new Date().toISOString()
  };
}

function createSampleProject() {
  const project = createProject({
    title: "리허설 데모 프로젝트",
    performanceType: "mixed",
    groupACount: 4,
    groupBCount: 4,
    names: {
      groupA: ["A1", "A2", "A3", "A4"],
      groupB: ["B1", "B2", "B3", "B4"]
    }
  });

  const [a, b] = project.sections;
  const pause = {
    ...b,
    id: uid("sec"),
    name: "Pause",
    time: 22,
    moveDuration: 0,
    start: 22,
    end: 22,
    notes: "포즈. 역할 B 라인을 앞쪽에 두고 역할 A는 뒤에서 프레임.",
    moveMode: "hold"
  };
  const c = {
    ...a,
    id: uid("sec"),
    name: "Partnerwork",
    time: 59,
    moveDuration: 6,
    start: 53,
    end: 59,
    notes: "페어/파트너 구간. 대형 변화는 크게 만들지 않음.",
    moveMode: "late",
    positions: b.positions
  };
  project.sections = [
    { ...a, name: "A", time: 0, moveDuration: 0, start: 0, end: 0, notes: "넓게 시작하는 오프닝 위치 잡기.", moveMode: "hold" },
    pause,
    c,
    {
      ...b,
      id: uid("sec"),
      name: "A prime",
      time: 108,
      moveDuration: 18,
      start: 90,
      end: 108,
      notes: "중앙으로 모이며 전환. 역할 B 이동선을 크게 보여줌.",
      moveMode: "smooth"
    }
  ].sort((left, right) => pointTime(left) - pointTime(right));
  return project;
}

function findSectionIndex(sections, time) {
  if (!sections.length) return -1;
  const index = sections.findIndex((section, currentIndex) => {
    const next = sections[currentIndex + 1];
    return time < (next ? pointMoveStart(next) : Infinity);
  });
  if (index >= 0) return index;
  if (time < pointMoveStart(sections[0])) return 0;
  return sections.length - 1;
}

function displayPositions(plan, sectionIndex, time, playing) {
  const points = plan.sections;
  if (!points.length) return {};
  if (!playing) {
    return (points[sectionIndex] || points[0])?.positions || {};
  }
  let targetIndex = points.findIndex((point, index) => index > 0 && time >= pointMoveStart(point) && time < pointTime(point));
  if (targetIndex < 0) {
    targetIndex = findSectionIndex(points, time);
  }
  const section = points[targetIndex] || points[sectionIndex] || points[0];
  if (!section) return {};
  if (!playing || targetIndex === 0 || time >= pointTime(section) || pointMoveDuration(section) === 0) return section.positions;
  const prev = points[targetIndex - 1];
  const progress = clamp((time - pointMoveStart(section)) / Math.max(0.01, pointMoveDuration(section)), 0, 1);
  const anchors = [
    { t: 0, positions: prev?.positions || section.positions },
    ...normalizeMovementKeyframes(section.movementKeyframes)
      .filter((keyframe) => keyframe.positions)
      .map((keyframe) => ({ t: keyframe.t, positions: keyframe.positions })),
    { t: 1, positions: section.positions }
  ].sort((left, right) => left.t - right.t);
  const nextAnchorIndex = anchors.findIndex((anchor) => progress <= anchor.t);
  const toAnchor = anchors[nextAnchorIndex >= 0 ? nextAnchorIndex : anchors.length - 1];
  const fromAnchor = anchors[Math.max(0, (nextAnchorIndex >= 0 ? nextAnchorIndex : anchors.length - 1) - 1)];
  const localProgress = toAnchor.t === fromAnchor.t ? 1 : clamp((progress - fromAnchor.t) / (toAnchor.t - fromAnchor.t), 0, 1);
  const positions = {};
  plan.performers.forEach((performer) => {
    const fallback = section.positions[performer.id] || prev?.positions?.[performer.id] || { x: 50, y: 50 };
    const from = fromAnchor.positions?.[performer.id] || fallback;
    const to = toAnchor.positions?.[performer.id] || fallback;
    positions[performer.id] = interpolate(from, to, localProgress);
  });
  return positions;
}

function exposureCounts(plan) {
  const counts = {};
  plan.performers.forEach((performer) => {
    counts[performer.id] = 0;
  });
  plan.sections.forEach((section) => {
    plan.performers.forEach((performer) => {
      const pos = section.positions?.[performer.id];
      if ((pos && pos.y >= plan.frontZone.y) || section.frontFocus?.includes(performer.id)) {
        counts[performer.id] += 1;
      }
    });
  });
  return counts;
}

function supabaseConfig() {
  return {
    url: import.meta.env.VITE_SUPABASE_URL,
    key: import.meta.env.VITE_SUPABASE_ANON_KEY
  };
}

function googleClientId() {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
}

function shareUrlForProject(projectId) {
  return createShareUrl(projectId, {
    publicShareOrigin: import.meta.env.VITE_PUBLIC_SHARE_ORIGIN,
    currentOrigin: window.location.origin
  });
}

function editShareUrlForProject(projectId, editToken = "") {
  return createEditShareUrl(projectId, {
    publicShareOrigin: import.meta.env.VITE_PUBLIC_SHARE_ORIGIN,
    currentOrigin: window.location.origin,
    editToken
  });
}

async function uploadAudioToSupabase(file, projectKey, fingerprint = audioFingerprint(file), auth = {}) {
  const { url, key } = supabaseConfig();
  if (!url || !key) throw new Error("Supabase 환경변수가 없습니다.");
  if (!auth.accessToken) throw new Error("음악 업로드는 Google 로그인 후 사용할 수 있습니다.");
  const path = `projects/${safeStorageSegment(projectKey || "local", "project")}/audio/${audioStorageName(file, fingerprint)}`;
  const response = await fetch(`${url}/storage/v1/object/${MOVEMAP_AUDIO_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": file.type || "application/octet-stream"
    },
    body: file
  });
  if (!response.ok) {
    const errorText = await response.text();
    if ((response.status === 400 || response.status === 409) && /already exists|duplicate|exists/i.test(errorText)) {
      return audioMetadataFromFile(file, path, fingerprint);
    }
    throw new Error(audioUploadErrorMessage(errorText));
  }
  return audioMetadataFromFile(file, path, fingerprint);
}

function buildStageSvg(plan, sectionIndex, options = {}) {
  const section = plan.sections[sectionIndex];
  const prev = plan.sections[sectionIndex - 1];
  const positions = section?.positions || {};
  const selectedId = options.selectedId || "";
  const readonly = Boolean(options.readonly);
  const pairs = plan.partnerSets.find((set) => set.id === section?.partnerSetId)?.pairs || [];
  const referenceSvg = renderStageReferenceSvg(plan.stageReferences, {
    frontZone: plan.frontZone,
    visible: options.showStageReferences !== false,
    showLabels: options.showStageReferenceLabels !== false
  });
  const warnings = longDistanceWarnings(buildTransitionPaths({
    performers: plan.performers,
    previousSection: prev,
    currentSection: section
  }), plan.performers);
  const overlaps = overlapWarnings(section, plan.performers);
  const token = (performer, pos, ghost = false) => {
    const dim = selectedId && selectedId !== performer.id;
    const performerPair = ghost ? null : pairForPerformerId(pairs, performer.id);
    const pairColor = performerPair ? performerColorForPair(plan, performerPair) : "";
    const shortName = escapeSvgText(tokenShortName(performer));
    const fullName = escapeSvgText(tokenName(performer));
    const fontSize = tokenFontSize(performer);
    return `
      <g opacity="${ghost ? 0.22 : dim ? 0.35 : 1}">
        <title>${fullName}</title>
        ${performerPair ? `<circle cx="${pos.x}" cy="${pos.y}" r="${PAIR_RING_RADIUS}" fill="none" stroke="${pairColor}" stroke-width="0.65" opacity="0.62" />` : ""}
        <circle cx="${pos.x}" cy="${pos.y}" r="${ghost ? 2.5 : TOKEN_RADIUS}" fill="${ghost ? "#475569" : performer.color}" stroke="#f8fafc" stroke-width="0.8" />
        ${ghost ? "" : `<text x="${pos.x}" y="${pos.y + fontSize * 0.34}" text-anchor="middle" font-size="${fontSize}" fill="#ffffff" font-family="Arial" font-weight="700" pointer-events="none" style="user-select:none">${shortName}</text>`}
      </g>`;
  };
  const arrows = plan.performers
    .map((performer) => {
      const from = prev?.positions?.[performer.id];
      const to = positions[performer.id];
      if (!from || !to || (Math.abs(from.x - to.x) < 1 && Math.abs(from.y - to.y) < 1)) return "";
      const opacity = selectedId && selectedId !== performer.id ? 0.12 : 0.65;
      return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${performer.color}" stroke-width="0.9" opacity="${opacity}" marker-end="url(#arrow)" />`;
    })
    .join("");
  const pairLines = pairs
    .map(([a, b]) => {
      const from = positions[a];
      const to = positions[b];
      if (!from || !to) return "";
      const color = performerColorForPair(plan, [a, b]);
      return `
        <line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#ffffff" stroke-width="4.8" opacity="0.9" stroke-linecap="round" />
        <line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${color}" stroke-width="2.1" opacity="0.74" stroke-linecap="round" />`;
    })
    .join("");
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${STAGE_WIDTH}" height="${STAGE_HEIGHT}" role="img" aria-label="무대 대형">
      <defs>
        <marker id="arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
          <path d="M0,0 L5,2.5 L0,5 Z" fill="#334155" />
        </marker>
      </defs>
      <rect x="0" y="0" width="100" height="100" fill="#f8fafc" rx="2" />
      <rect x="0" y="${plan.frontZone.y}" width="100" height="${100 - plan.frontZone.y}" fill="#fee2e2" opacity="0.72" />
      <text x="50" y="96" text-anchor="middle" font-size="3.5" fill="#991b1b" font-family="Arial" font-weight="700">관객 방향 / 앞줄</text>
      <path d="M8 92 H92" stroke="#991b1b" stroke-width="0.5" marker-end="url(#arrow)" />
      <g stroke="#cbd5e1" stroke-width="0.16">
        ${GRID_X.map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="100" />`).join("")}
        ${GRID_Y.map((y) => `<line x1="0" y1="${y}" x2="100" y2="${y}" />`).join("")}
      </g>
      <g>${referenceSvg}</g>
      ${plan.performers.map((performer) => prev?.positions?.[performer.id] ? token(performer, prev.positions[performer.id], true) : "").join("")}
      ${arrows}
      ${pairLines}
      ${plan.performers.map((performer) => positions[performer.id] ? token(performer, positions[performer.id]) : "").join("")}
      <text x="4" y="7" font-size="4" fill="#0f172a" font-family="Arial" font-weight="700">${escapeSvgText(section?.name || "")} ${section ? `도착 ${formatTime(pointTime(section))} / 이동 ${pointMoveDuration(section)}초` : ""}</text>
      ${warnings.length ? `<text x="4" y="13" font-size="2.8" fill="#92400e" font-family="Arial" font-weight="700">먼 이동 주의: ${escapeSvgText(warnings.map((warning) => warning.name).join(", "))}</text>` : ""}
      ${overlaps.length ? `<text x="4" y="${warnings.length ? 17 : 13}" font-size="2.8" fill="#92400e" font-family="Arial" font-weight="700">겹침 주의: ${escapeSvgText(overlaps.map((warning) => warning.names.join(" / ")).join(", "))}</text>` : ""}
      ${readonly ? `<text x="4" y="${warnings.length || overlaps.length ? 21 : 12}" font-size="2.8" fill="#475569" font-family="Arial">${escapeSvgText(section?.notes || "")}</text>` : ""}
    </svg>`;
}

function Wizard({ onCreate }) {
  const [title, setTitle] = useState("새 Movemap 프로젝트");
  const [performanceType, setPerformanceType] = useState("mixed");
  const [groupACount, setGroupACount] = useState(4);
  const [groupBCount, setGroupBCount] = useState(4);
  const groupANames = Array.from({ length: groupACount }, (_, index) => `A${index + 1}`);
  const groupBNames = Array.from({ length: groupBCount }, (_, index) => `B${index + 1}`);

  return (
    <div className="wizard">
      <div className="wizard-card">
        <p className="eyebrow">Movemap</p>
        <h1>음악과 큐에 맞춰 대형과 동선을 설계하세요.</h1>
        <div className="wizard-grid">
          <label>
            공연명
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            공연 타입
            <select value={performanceType} onChange={(event) => setPerformanceType(event.target.value)}>
              {Object.entries(PERFORMANCE_TYPES).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            역할 A
            <input type="number" min="0" max="16" value={groupACount} onChange={(event) => setGroupACount(parseNumber(event.target.value, 0))} />
          </label>
          <label>
            역할 B
            <input type="number" min="0" max="16" value={groupBCount} onChange={(event) => setGroupBCount(parseNumber(event.target.value, 0))} />
          </label>
        </div>
        <div className="wizard-actions">
          <button className="primary" onClick={() => onCreate(createProject({ title, performanceType, groupACount, groupBCount, names: { groupA: groupANames, groupB: groupBNames } }))}>
            빈 프로젝트 시작
          </button>
          <button onClick={() => onCreate(createSampleProject())}>샘플로 시작</button>
        </div>
      </div>
    </div>
  );
}

function Stage3dPreview({ projection }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f8fafc");
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    camera.position.set(0, 92, 112);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(mount.clientWidth || 320, mount.clientHeight || 220);
    mount.replaceChildren(renderer.domElement);

    scene.add(new THREE.HemisphereLight("#ffffff", "#cbd5e1", 2.6));
    const directional = new THREE.DirectionalLight("#ffffff", 1.5);
    directional.position.set(30, 80, 40);
    scene.add(directional);

    const grid = new THREE.GridHelper(100, 10, "#94a3b8", "#cbd5e1");
    grid.position.y = -0.02;
    scene.add(grid);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshStandardMaterial({ color: "#eef2ff", roughness: 0.9, metalness: 0 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.08;
    scene.add(floor);

    const front = new THREE.Mesh(
      new THREE.BoxGeometry(100, 0.35, 1.2),
      new THREE.MeshStandardMaterial({ color: "#b91c1c" })
    );
    front.position.set(0, 0.25, -20);
    scene.add(front);

    projection.paths.forEach((path) => {
      const material = new THREE.LineBasicMaterial({ color: path.context === "next" ? "#64748b" : "#334155", transparent: true, opacity: 0.46 });
      const points = [
        new THREE.Vector3(path.from.x, 0.45, path.from.z),
        new THREE.Vector3(path.to.x, 0.45, path.to.z)
      ];
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
    });

    projection.tokens.forEach((token) => {
      const material = new THREE.MeshStandardMaterial({ color: token.color, roughness: 0.58, metalness: 0.05 });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(token.focused ? 2.6 : 2.1, 24, 16), material);
      mesh.position.set(token.point.x, token.focused ? 2.7 : 2.2, token.point.z);
      scene.add(mesh);
    });

    const handleResize = () => {
      const width = mount.clientWidth || 320;
      const height = mount.clientHeight || 220;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      renderer.render(scene, camera);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    renderer.render(scene, camera);

    return () => {
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      mount.replaceChildren();
    };
  }, [projection]);

  return <div className="stage-3d-preview" ref={mountRef} aria-label="3D 대형 미리보기" />;
}

function App() {
  const linkMode = linkModeFromLocation(window.location);
  const shareId = linkMode.projectId;
  const linkType = linkMode.linkType;
  const isEditLinkRoute = linkType === LINK_TYPES.edit;
  const supabaseClient = useMemo(() => {
    try {
      return createMovemapSupabaseClient(supabaseConfig());
    } catch {
      return null;
    }
  }, []);
  const [authSession, setAuthSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabaseClient));
  const [editLinkAuthorized, setEditLinkAuthorized] = useState(false);
  const readonly = linkMode.readonly && !editLinkAuthorized;
  const [plan, setPlan] = useState(null);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [selectedPerformerId, setSelectedPerformerId] = useState("");
  const [selectedPerformerIds, setSelectedPerformerIds] = useState([]);
  const [shareRouteBlocked, setShareRouteBlocked] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioSrc, setAudioSrc] = useState("");
  const [audioUploadStatus, setAudioUploadStatus] = useState("idle");
  const [shareUrl, setShareUrl] = useState("");
  const [editShareUrl, setEditShareUrl] = useState("");
  const [status, setStatus] = useState("");
  const [statusRecovery, setStatusRecovery] = useState("");
  const [localSavedAt, setLocalSavedAt] = useState("");
  const [magnetCandidateId, setMagnetCandidateId] = useState("");
  const [dragHint, setDragHint] = useState("");
  const [selectedPairKey, setSelectedPairKey] = useState("");
  const [tapMoveArmed, setTapMoveArmed] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [dragPositions, setDragPositions] = useState(null);
  const [isToolDrawerOpen, setIsToolDrawerOpen] = useState(false);
  const [isShareMenuOpen, setIsShareMenuOpen] = useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [isBottomSheetExpanded, setIsBottomSheetExpanded] = useState(false);
  const [isStageFocus, setIsStageFocus] = useState(false);
  const [timelinePixelsPerSecond, setTimelinePixelsPerSecond] = useState(56);
  const [timelineScrollX, setTimelineScrollX] = useState(0);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
  const [timelineSnapTime, setTimelineSnapTime] = useState(null);
  const [timelineReorderPreview, setTimelineReorderPreview] = useState(null);
  const [timelineBlockedEdge, setTimelineBlockedEdge] = useState(null);
  const [selectedMovementKeyframeId, setSelectedMovementKeyframeId] = useState("");
  const [showAllTransitionPaths, setShowAllTransitionPaths] = useState(false);
  const [showStageReferences, setShowStageReferences] = useState(true);
  const [showStageReferenceLabels, setShowStageReferenceLabels] = useState(true);
  const [stageViewMode, setStageViewMode] = useState("2d");
  const [selectedTemplateId, setSelectedTemplateId] = useState("line");
  const [formationPreview, setFormationPreview] = useState(null);
  const [transitionPathFilter, setTransitionPathFilter] = useState("auto");
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const audioRef = useRef(null);
  const svgRef = useRef(null);
  const timelineViewportRef = useRef(null);
  const dragStateRef = useRef(null);
  const interactiveEditSnapshotRef = useRef(null);
  const ignoreNextStageTapRef = useRef(false);
  const ignoreNextFormationClickRef = useRef(false);
  const longPressTimerRef = useRef(null);
  const localAudioUrlRef = useRef("");
  const rejectedAudioUrlsRef = useRef(new Set());

  useEffect(() => {
    if (!supabaseClient) {
      setAuthLoading(false);
      return;
    }
    let mounted = true;
    getAuthSession(supabaseClient)
      .then((session) => {
        if (mounted) setAuthSession(session);
      })
      .finally(() => {
        if (mounted) setAuthLoading(false);
      });
    const unsubscribe = onAuthStateChange(supabaseClient, (session) => {
      setAuthSession(session);
      setAuthLoading(false);
      if (session) {
        setStatus(`로그인되었습니다: ${session.user?.email || "Google 계정"}`);
        window.setTimeout(() => {
          setStatus((current) => current.startsWith("로그인되었습니다:") ? "" : current);
        }, 2400);
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [supabaseClient]);

  function currentAuthRequest() {
    return authRequest(authSession);
  }

  async function signInOwner() {
    if (!supabaseClient) {
      setStatus("Supabase Auth 환경변수를 먼저 설정해 주세요.");
      return;
    }
    const directGoogleClientId = googleClientId();
    setStatus(directGoogleClientId ? "Movemap Google 로그인 창을 엽니다..." : "Movemap Google 로그인으로 이동합니다...");
    const { error } = directGoogleClientId
      ? await signInWithGoogleIdentity(supabaseClient, { clientId: directGoogleClientId })
      : await signInWithGoogle(supabaseClient, { redirectTo: authRedirectTo(window.location, "/") });
    if (error) {
      setStatus(`로그인 시작 실패: ${error.message}`);
      return;
    }
    if (directGoogleClientId) {
      setStatus("Google 로그인 확인 중...");
    }
  }

  async function signOutOwner() {
    if (!supabaseClient) return;
    const { error } = await signOut(supabaseClient);
    if (error) {
      setStatus(`로그아웃 실패: ${error.message}`);
      return;
    }
    setAuthSession(null);
    setStatus("로그아웃했습니다. 로컬 데모 편집은 계속할 수 있습니다.");
  }

  function restoreAudioFromPlan(nextPlan, options = {}) {
    const restoredAudioUrl = resolveAudioUrl(nextPlan?.audio);
    rejectedAudioUrlsRef.current = new Set();
    if (!restoredAudioUrl) {
      if (options.clearWhenMissing) {
        setAudioSrc("");
        setAudioUploadStatus("idle");
      }
      return false;
    }
    if (localAudioUrlRef.current) {
      URL.revokeObjectURL(localAudioUrlRef.current);
      localAudioUrlRef.current = "";
    }
    setAudioSrc(restoredAudioUrl);
    setAudioUploadStatus("uploaded");
    return true;
  }

  useEffect(() => {
    if (shareId) {
      const loadShared = isEditLinkRoute && linkMode.editToken
        ? loadCloudProjectByEditToken(shareId, linkMode.editToken, supabaseConfig())
            .catch(() => loadCloudProject(shareId, supabaseConfig()))
        : loadCloudProject(shareId, supabaseConfig());
      loadShared
        .then((loaded) => {
          const normalized = normalizePlan(loaded);
          const routeAuth = authorizeShareRoute({
            shareLinks: normalized.shareLinks,
            linkType,
            token: linkMode.editToken,
            projectId: shareId
          });
          const editAuthorized = isEditLinkRoute && routeAuth.editable;
          setEditLinkAuthorized(editAuthorized);
          setShareRouteBlocked(routeAuth.reason);
          if (routeAuth.reason === "disabled-view-link") {
            setStatus("소유자가 이 보기 링크를 꺼두었습니다.");
            return;
          }
          setPlan(normalized);
          setSelectedSectionId(normalized.sections[0]?.id || "");
          setShareUrl(shareUrlForProject(normalized.shareLinks?.view?.projectId || shareId));
          setEditShareUrl(editShareUrlForProject(normalized.shareLinks?.edit?.projectId || shareId, normalized.shareLinks?.edit?.token || ""));
          if (isEditLinkRoute && !editAuthorized) {
            setStatus("편집 링크 토큰이 맞지 않아 보기 링크로 열었습니다.");
          }
          restoreAudioFromPlan(normalized, { clearWhenMissing: true });
        })
        .catch((error) => setStatus(error.message));
      return;
    }
    for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
      const saved = localStorage.getItem(key);
      if (!saved) continue;
      try {
        const loaded = JSON.parse(saved);
        if (validateProjectImport(loaded).ok) {
          const normalized = normalizePlan(loaded);
          setPlan(normalized);
          setSelectedSectionId(normalized.sections[0]?.id || "");
          setLocalSavedAt(loaded.updatedAt || "");
          restoreAudioFromPlan(normalized, { clearWhenMissing: true });
          break;
        } else {
          localStorage.removeItem(key);
          continue;
        }
      } catch {
        localStorage.removeItem(key);
        continue;
      }
    }
  }, [shareId, isEditLinkRoute, linkMode.editToken, linkType]);

  useEffect(() => {
    if (!plan || readonly || shareId) return;
    const updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...plan, updatedAt }));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    setLocalSavedAt(updatedAt);
  }, [plan, readonly, shareId]);

  useEffect(() => () => {
    if (localAudioUrlRef.current) URL.revokeObjectURL(localAudioUrlRef.current);
  }, []);

  useEffect(() => {
    let frame;
    const tick = () => {
      if (audioRef.current && isPlaying) {
        setCurrentTime(audioRef.current.currentTime);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying]);

  useEffect(() => {
    const viewport = timelineViewportRef.current;
    if (!viewport) return undefined;
    const updateViewportWidth = () => setTimelineViewportWidth(viewport.getBoundingClientRect().width || 0);
    updateViewportWidth();
    if (!window.ResizeObserver) {
      window.addEventListener("resize", updateViewportWidth);
      return () => window.removeEventListener("resize", updateViewportWidth);
    }
    const observer = new ResizeObserver(updateViewportWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const sortedSections = useMemo(() => plan ? [...plan.sections].map(normalizeSection).sort((a, b) => pointTime(a) - pointTime(b)) : [], [plan]);
  const timeSectionIndex = useMemo(() => findSectionIndex(sortedSections, currentTime), [sortedSections, currentTime]);
  const selectedSectionIndex = useMemo(() => {
    const index = sortedSections.findIndex((section) => section.id === selectedSectionId);
    return index >= 0 ? index : Math.max(0, timeSectionIndex);
  }, [sortedSections, selectedSectionId, timeSectionIndex]);
  const activeSectionIndex = isPlaying ? timeSectionIndex : selectedSectionIndex;
  const timelineMax = useMemo(() => {
    const lastSectionEnd = Math.max(...sortedSections.map((section) => pointTime(section)), 0);
    return Math.max(duration || 0, lastSectionEnd || 120);
  }, [duration, sortedSections]);
  const sliderTime = clamp(currentTime, 0, timelineMax);
  const timelineFormationBlocks = useMemo(() => layoutFormationBlocks(sortedSections, timelinePixelsPerSecond, {
    introAsSegment: true,
    markerWidthPx: 132,
    markerGapPx: 8
  }), [sortedSections, timelinePixelsPerSecond]);
  const timelineReorderGuide = useMemo(() => {
    if (!timelineReorderPreview) return null;
    const projectedSections = applyFormationTimelineEdit({
      sections: sortedSections,
      action: "reorder",
      sectionId: timelineReorderPreview.sectionId,
      toIndex: timelineReorderPreview.toIndex
    }).sections;
    const projectedIndex = projectedSections.findIndex((section) => section.id === timelineReorderPreview.sectionId);
    if (projectedIndex <= 0) return null;
    const previousSection = projectedSections[projectedIndex - 1];
    const previousCurrentIndex = sortedSections.findIndex((section) => section.id === previousSection.id);
    const previousCurrentBlock = timelineFormationBlocks[previousCurrentIndex];
    if (!previousCurrentBlock) return null;
    const nextSection = projectedSections[projectedIndex + 1];
    const slotLabel = nextSection
      ? `${previousSection.name} 뒤, ${nextSection.name} 앞`
      : `${previousSection.name} 뒤`;
    return {
      leftPx: previousCurrentBlock.visualRightPx,
      isEndSlot: !nextSection,
      slotLabel
    };
  }, [sortedSections, timelineFormationBlocks, timelineReorderPreview]);
  const timelineContentWidth = Math.max(
    620,
    timelineViewportWidth,
    timelineMax * timelinePixelsPerSecond,
    ...timelineFormationBlocks.map((block) => block.visualRightPx + 80),
    timelineReorderGuide ? timelineReorderGuide.leftPx + 160 : 0
  );
  const timelineMaxScrollX = calculateTimelineMaxScrollX(timelineMax, timelinePixelsPerSecond, timelineViewportWidth);
  const timelineTicks = useMemo(() => buildTimelineTicks(timelineMax, {
    pixelsPerSecond: timelinePixelsPerSecond,
    scrollX: timelineScrollX,
    viewportWidth: timelineViewportWidth
  }), [timelineMax, timelinePixelsPerSecond, timelineScrollX, timelineViewportWidth]);
  const waveformBars = useMemo(() => buildWaveformBars(96), []);
  const playheadPixel = sliderTime * timelinePixelsPerSecond - timelineScrollX;
  const snapPixel = timelineSnapTime === null ? null : timelineSnapTime * timelinePixelsPerSecond - timelineScrollX;
  const selectedSection = sortedSections[selectedSectionIndex];
  const selectedMovementKeyframe = selectedSection
    ? normalizeMovementKeyframes(selectedSection.movementKeyframes).find((keyframe) => keyframe.id === selectedMovementKeyframeId) || null
    : null;
  const canAddMovementKeyframe = Boolean(
    selectedSection &&
    selectedSectionIndex > 0 &&
    pointMoveDuration(selectedSection) > 0 &&
    sliderTime >= pointMoveStart(selectedSection) &&
    sliderTime <= pointTime(selectedSection)
  );
  const selectedMovementKeyframeTime = selectedSection && selectedMovementKeyframe
    ? movementKeyframeTime(selectedSection, selectedMovementKeyframe)
    : null;
  const stageEditTargetLabel = selectedMovementKeyframe
    ? `중간 keyframe ${formatTime(selectedMovementKeyframeTime)}`
    : "도착 대형";
  const activeSection = sortedSections[activeSectionIndex];
  const stageReferenceItems = useMemo(() => plan ? stageReferenceRenderItems(plan.stageReferences, {
    frontZone: plan.frontZone,
    visible: showStageReferences,
    showLabels: showStageReferenceLabels
  }) : [], [plan, showStageReferences, showStageReferenceLabels]);
  const selectedTemplatePreview = useMemo(() => plan
    ? buildFormationTemplatePreview(selectedTemplateId, plan.performers)
    : null, [plan, selectedTemplateId]);
  const counts = useMemo(() => plan ? exposureCounts({ ...plan, sections: sortedSections }) : {}, [plan, sortedSections]);

  useEffect(() => {
    setTimelineScrollX((value) => clampValue(value, 0, timelineMaxScrollX));
  }, [timelineMaxScrollX]);
  const visiblePositions = useMemo(() => {
    const base = plan ? displayPositions({ ...plan, sections: sortedSections }, activeSectionIndex, currentTime, isPlaying) : {};
    const editBase = !isPlaying && selectedSection && selectedMovementKeyframe
      ? movementKeyframePositions(selectedSection, selectedMovementKeyframe)
      : base;
    return dragPositions ? { ...editBase, ...dragPositions } : editBase;
  }, [plan, sortedSections, activeSectionIndex, currentTime, isPlaying, dragPositions, selectedSection, selectedMovementKeyframe]);
  const stage3dProjection = useMemo(() => buildStage3dProjection({
    performers: plan?.performers || [],
    positions: visiblePositions,
    transitionPaths: plan ? buildTransitionPaths({
      performers: plan.performers,
      previousSection: sortedSections[activeSectionIndex - 1],
      currentSection: activeSection,
      nextSection: sortedSections[activeSectionIndex + 1],
      selectedPerformerId
    }) : [],
    selectedPerformerId
  }), [plan, visiblePositions, sortedSections, activeSectionIndex, activeSection, selectedPerformerId]);

  useEffect(() => {
    if (isPlaying && activeSection?.id) {
      setSelectedSectionId(activeSection.id);
      clearSelection();
    }
  }, [isPlaying, activeSection?.id]);

  useEffect(() => {
    if (selectedMovementKeyframeId && !selectedMovementKeyframe) {
      setSelectedMovementKeyframeId("");
    }
  }, [selectedMovementKeyframeId, selectedMovementKeyframe]);

  function resetTransientEditState() {
    clearLongPressTimer();
    setMagnetCandidateId("");
    setDragHint("");
    setDragPositions(null);
    setTimelineReorderPreview(null);
    setTimelineBlockedEdge(null);
    dragStateRef.current = null;
  }

  function normalizeSelectionForPlan(nextPlan) {
    const sections = nextPlan?.sections || [];
    if (!sections.length) {
      setSelectedSectionId("");
      setSelectedPerformerId("");
      setSelectedPerformerIds([]);
      setSelectedPairKey("");
      return;
    }
    if (!sections.some((section) => section.id === selectedSectionId)) {
      setSelectedSectionId(sections[0].id);
    }
    if (selectedPerformerId && !nextPlan.performers?.some((performer) => performer.id === selectedPerformerId)) {
      setSelectedPerformerId("");
    }
    setSelectedPerformerIds((ids) => ids.filter((id) => nextPlan.performers?.some((performer) => performer.id === id)));
    const hasSelectedPair = nextPlan.partnerSets?.some((set) => set.pairs?.some((pair) => pairKey(pair) === selectedPairKey));
    if (selectedPairKey && !hasSelectedPair) {
      setSelectedPairKey("");
    }
  }

  function updatePlan(updater, options = {}) {
    const { history = true } = options;
    setPlan((current) => {
      const next = updater(current);
      if (!current || !next || plansEqual(current, next)) return next;
      if (history && !readonly) {
        const snapshot = clonePlan(current);
        setUndoStack((stack) => [...stack.slice(-(HISTORY_LIMIT - 1)), snapshot]);
        setRedoStack([]);
      }
      return next;
    });
  }

  function undoPlan() {
    if (readonly || !undoStack.length || !plan) return;
    resetTransientEditState();
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack.slice(-(HISTORY_LIMIT - 1)), clonePlan(plan)]);
    setPlan(clonePlan(previous));
    normalizeSelectionForPlan(previous);
    restoreAudioFromPlan(previous, { clearWhenMissing: true });
    setStatus("되돌렸습니다.");
  }

  function redoPlan() {
    if (readonly || !redoStack.length || !plan) return;
    resetTransientEditState();
    const next = redoStack[redoStack.length - 1];
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack.slice(-(HISTORY_LIMIT - 1)), clonePlan(plan)]);
    setPlan(clonePlan(next));
    normalizeSelectionForPlan(next);
    restoreAudioFromPlan(next, { clearWhenMissing: true });
    setStatus("다시 실행했습니다.");
  }

  function updateSection(sectionId, patch, options = {}) {
    updatePlan((current) => ({
      ...current,
      sections: current.sections.map((section) => section.id === sectionId ? { ...section, ...patch } : section)
    }), options);
  }

  function updateSectionTiming(sectionId, time, moveDuration = null, options = {}) {
    const firstPass = applyFormationTimelineEdit({
      sections: sortedSections,
      action: "trim-right",
      sectionId,
      time,
      timelineMax
    }).sections;
    const current = firstPass.find((section) => section.id === sectionId);
    const nextSections = moveDuration === null || !current
      ? firstPass
      : applyFormationTimelineEdit({
        sections: firstPass,
        action: "trim-left",
        sectionId,
        time: pointTime(current) - moveDuration,
        timelineMax
      }).sections;
    replaceSections(nextSections, options);
  }

  function replaceSections(nextSections, options = {}) {
    updatePlan((current) => ({
      ...current,
      sections: nextSections
    }), options);
  }

  function updateMovementKeyframes(sectionId, updater, options = {}) {
    updatePlan((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        if (section.id !== sectionId) return section;
        return {
          ...section,
          movementKeyframes: normalizeMovementKeyframes(updater(normalizeMovementKeyframes(section.movementKeyframes)))
        };
      })
    }), options);
  }

  function beginInteractiveEdit() {
    interactiveEditSnapshotRef.current = clonePlan(plan);
  }

  function finishInteractiveEdit(changed) {
    const snapshot = interactiveEditSnapshotRef.current;
    interactiveEditSnapshotRef.current = null;
    if (!changed || readonly || !snapshot) return;
    setUndoStack((stack) => [...stack.slice(-(HISTORY_LIMIT - 1)), snapshot]);
    setRedoStack([]);
  }

  function sectionEditPositions(section, keyframeId = selectedMovementKeyframeId) {
    const keyframe = normalizeMovementKeyframes(section?.movementKeyframes).find((item) => item.id === keyframeId);
    return keyframe ? movementKeyframePositions(section, keyframe) : { ...(section?.positions || {}) };
  }

  function sectionWithPositionPatch(section, patch, keyframeId = selectedMovementKeyframeId, sectionPatch = {}) {
    const keyframe = normalizeMovementKeyframes(section?.movementKeyframes).find((item) => item.id === keyframeId);
    if (!keyframe) {
      return {
        ...section,
        ...sectionPatch,
        positions: {
          ...(section.positions || {}),
          ...patch
        }
      };
    }
    return {
      ...section,
      movementKeyframes: applyMovementKeyframePositionPatch(section.movementKeyframes, keyframe.id, section.positions, patch)
    };
  }

  function isKeyframeEdit(section, keyframeId = selectedMovementKeyframeId) {
    return Boolean(normalizeMovementKeyframes(section?.movementKeyframes).some((keyframe) => keyframe.id === keyframeId));
  }

  function addMovementKeyframeAtCurrentTime() {
    if (!canAddMovementKeyframe) return;
    const durationSeconds = pointMoveDuration(selectedSection);
    if (!durationSeconds) return;
    const t = clamp((sliderTime - pointMoveStart(selectedSection)) / durationSeconds, 0, 1);
    const id = uid("mkf");
    updateMovementKeyframes(selectedSection.id, (keyframes) => [
      ...keyframes,
      {
        id,
        sectionId: selectedSection.id,
        t,
        positions: visiblePositions,
        easing: "linear"
      }
    ]);
    setSelectedMovementKeyframeId(id);
    setStatus(`${selectedSection.name} 이동 keyframe을 추가했습니다.`);
  }

  function deleteSelectedMovementKeyframe() {
    if (!selectedSection || !selectedMovementKeyframeId) return;
    updateMovementKeyframes(selectedSection.id, (keyframes) => keyframes.filter((keyframe) => keyframe.id !== selectedMovementKeyframeId));
    setSelectedMovementKeyframeId("");
    setStatus(`${selectedSection.name} 이동 keyframe을 삭제했습니다.`);
  }

  function seekTimelineToTime(nextTime) {
    const safeTime = clamp(nextTime, 0, timelineMax);
    setCurrentTime(safeTime);
    if (audioRef.current) audioRef.current.currentTime = safeTime;
  }

  function timeFromTimelineClientX(clientX) {
    const viewport = timelineViewportRef.current;
    const rect = viewport?.getBoundingClientRect();
    if (!rect?.width) return 0;
    return pixelsToTime(clientX - rect.left + timelineScrollX, timelinePixelsPerSecond);
  }

  function snapTimelineTime(rawTime, section, minTime, maxTime) {
    return snapFormationTime(rawTime, {
      enabled: snapEnabled,
      sections: sortedSections,
      sectionId: section?.id,
      playheadTime: sliderTime,
      gridSize: 0.1,
      threshold: 10 / timelinePixelsPerSecond,
      minTime,
      maxTime
    });
  }

  function onTimelineWheel(event) {
    const viewport = timelineViewportRef.current;
    const rect = viewport?.getBoundingClientRect();
    if (!rect?.width) return;
    event.preventDefault();
    const delta = normalizeWheelDelta(event.deltaY, event.deltaMode);
    if (event.ctrlKey || event.metaKey) {
      const nextZoom = clampValue(timelinePixelsPerSecond * (delta > 0 ? 0.88 : 1.14), 14, 160);
      const nextScrollX = calculateAnchoredZoomScrollX({
        scrollX: timelineScrollX,
        cursorViewportX: event.clientX - rect.left,
        currentZoom: timelinePixelsPerSecond,
        nextZoom,
        timelineDuration: timelineMax,
        viewportWidth: rect.width
      });
      setTimelinePixelsPerSecond(nextZoom);
      setTimelineScrollX(nextScrollX);
      return;
    }
    setTimelineScrollX((value) => clampValue(value + delta, 0, calculateTimelineMaxScrollX(timelineMax, timelinePixelsPerSecond, rect.width)));
  }

  function onTimelineScrubPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const updateFromClientX = (clientX) => seekTimelineToTime(timeFromTimelineClientX(clientX));
    updateFromClientX(event.clientX);
    const onPointerMove = (moveEvent) => {
      moveEvent.preventDefault();
      updateFromClientX(moveEvent.clientX);
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  function onFormationPointerDown(event, section, index, mode) {
    if (readonly) return;
    event.preventDefault();
    event.stopPropagation();
    ignoreNextFormationClickRef.current = true;
    setSelectedSectionId(section.id);
    beginInteractiveEdit();

    const startClientX = event.clientX;
    const startArrival = pointTime(section);
    const startMoveStart = pointMoveStart(section);
    const previousArrival = index > 0 ? pointTime(sortedSections[index - 1]) : 0;
    let lastSectionsSignature = sectionsTimingSignature(sortedSections);
    let hasDragged = false;
    let hasEdited = false;
    let reorderTargetIndex = null;

    const replaceSectionsIfChanged = (nextSections) => {
      const nextSignature = sectionsTimingSignature(nextSections);
      if (nextSignature === lastSectionsSignature) return false;
      replaceSections(nextSections, { history: false });
      lastSectionsSignature = nextSignature;
      hasEdited = true;
      return true;
    };

    const commit = (clientX) => {
      const deltaTime = (clientX - startClientX) / timelinePixelsPerSecond;
      if (Math.abs(clientX - startClientX) >= 4) hasDragged = true;

      if (mode === "left") {
        const rawStart = startMoveStart + deltaTime;
        const snap = snapTimelineTime(rawStart, section, previousArrival, startArrival);
        setTimelineSnapTime(snap.snapped ? snap.time : null);
        const result = applyFormationTimelineEdit({
          sections: sortedSections,
          action: "trim-left",
          sectionId: section.id,
          time: snap.time,
          timelineMax
        });
        replaceSectionsIfChanged(result.sections);
        setTimelineBlockedEdge(rawStart < previousArrival ? { sectionId: section.id, edge: "left" } : null);
        return;
      }

      if (mode === "right") {
        const rawEnd = startArrival + deltaTime;
        const rightLimit = Math.max(timelineMax, rawEnd);
        const snap = snapTimelineTime(rawEnd, section, startMoveStart, rightLimit);
        setTimelineSnapTime(snap.snapped ? snap.time : null);
        const result = applyFormationTimelineEdit({
          sections: sortedSections,
          action: "trim-right",
          sectionId: section.id,
          time: snap.time,
          timelineMax: Math.max(timelineMax, snap.time)
        });
        replaceSectionsIfChanged(result.sections);
        setTimelineBlockedEdge(null);
        return;
      }

      const dragResult = applyFormationTimelineEdit({
        sections: sortedSections,
        action: "move-body",
        sectionId: section.id,
        deltaTime,
        timelineMax
      });
      reorderTargetIndex = dragResult.toIndex;
      setTimelineReorderPreview(dragResult.statusKind === "reorder-preview" ? { sectionId: section.id, toIndex: dragResult.toIndex } : null);
      setTimelineSnapTime(null);
      setTimelineBlockedEdge(dragResult.statusKind === "blocked" ? { sectionId: section.id, edge: deltaTime < 0 ? "left" : "right" } : null);
      replaceSectionsIfChanged(dragResult.sections);
    };
    const onPointerMove = (moveEvent) => {
      moveEvent.preventDefault();
      commit(moveEvent.clientX);
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      setTimelineSnapTime(null);
      setTimelineReorderPreview(null);
      setTimelineBlockedEdge(null);
      if (!hasDragged && mode === "body") {
        finishInteractiveEdit(false);
        jumpTo(section);
        return;
      }
      if (mode === "body" && reorderTargetIndex !== null && reorderTargetIndex !== index) {
        replaceSections(applyFormationTimelineEdit({
          sections: sortedSections,
          action: "reorder",
          sectionId: section.id,
          toIndex: reorderTargetIndex
        }).sections, { history: false });
        finishInteractiveEdit(true);
        setStatus(`${section.name} 순서를 변경했습니다.`);
        return;
      }
      finishInteractiveEdit(hasEdited);
      const action = mode === "left" ? "이동 시작" : mode === "right" ? "도착 시각" : "구간";
      setStatus(`${section.name} ${action}을 조정했습니다.`);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  function onMovementKeyframePointerDown(event, section, keyframe) {
    if (readonly) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedSectionId(section.id);
    setSelectedMovementKeyframeId(keyframe.id);
    beginInteractiveEdit();
    const startClientX = event.clientX;
    const startT = Number(keyframe.t) || 0;
    const durationSeconds = Math.max(0.01, pointMoveDuration(section));
    let hasDragged = false;
    const onPointerMove = (moveEvent) => {
      moveEvent.preventDefault();
      if (Math.abs(moveEvent.clientX - startClientX) >= 3) hasDragged = true;
      const deltaT = (moveEvent.clientX - startClientX) / timelinePixelsPerSecond / durationSeconds;
      const absoluteTime = clampValue(
        quantizeTimelineTime(pointMoveStart(section) + pointMoveDuration(section) * clamp(startT + deltaT, 0, 1)),
        pointMoveStart(section),
        pointTime(section)
      );
      const nextT = clamp((absoluteTime - pointMoveStart(section)) / durationSeconds, 0, 1);
      updateMovementKeyframes(section.id, (keyframes) => keyframes.map((item) => item.id === keyframe.id ? { ...item, t: nextT } : item), { history: false });
      setTimelineSnapTime(absoluteTime);
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      setTimelineSnapTime(null);
      finishInteractiveEdit(hasDragged);
      if (hasDragged) {
        setStatus(`${section.name} 이동 keyframe 위치를 조정했습니다.`);
      } else {
        seekTimelineToTime(movementKeyframeTime(section, keyframe));
      }
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  function clientToStagePoint(event) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const screenMatrix = svg.getScreenCTM();
    if (screenMatrix) {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const svgPoint = point.matrixTransform(screenMatrix.inverse());
      return {
        x: clamp(svgPoint.x, 0, 100),
        y: clamp(svgPoint.y, 0, 100)
      };
    }
    const rect = svg.getBoundingClientRect();
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100)
    };
  }

  function captureStagePointer(event) {
    const target = svgRef.current || event.currentTarget;
    if (!target?.setPointerCapture) return;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Browser may reject capture if the pointer was already released.
    }
  }

  function getPartnerSetForSection(section) {
    return plan.partnerSets.find((set) => set.id === section?.partnerSetId);
  }

  function pairForPerformer(pairs = [], performerId) {
    return pairForPerformerId(pairs, performerId);
  }

  function performerById(performerId) {
    return plan.performers.find((performer) => performer.id === performerId);
  }

  function clearSelection() {
    setSelectedPerformerId("");
    setSelectedPerformerIds([]);
    setSelectedPairKey("");
    setTapMoveArmed(false);
  }

  function selectPerformer(performerId) {
    setSelectedPerformerId(performerId);
    setSelectedPerformerIds(performerId ? [performerId] : []);
    setSelectedPairKey("");
    setTapMoveArmed(Boolean(performerId));
  }

  function selectPair(nextPairKey, performerId = "") {
    setSelectedPerformerId(performerId);
    setSelectedPerformerIds(performerId ? [performerId] : []);
    setSelectedPairKey(nextPairKey);
    setTapMoveArmed(Boolean(nextPairKey));
  }

  function applySelectionClick(action) {
    if (action.type === "clear") {
      clearSelection();
      return;
    }
    if (action.type === "select-pair") {
      selectPair(action.pairKey);
      return;
    }
    if (action.type === "select-token") {
      selectPerformer(action.performerId);
    }
  }

  function pairGridPlacement(currentPlan, section, firstId, secondId, point, extraPositions = {}, excludeIds = [firstId, secondId]) {
    return findPairGridPlacement({
      plan: currentPlan,
      firstId,
      secondId,
      point,
      positions: { ...(section?.positions || {}), ...extraPositions },
      excludeIds
    });
  }

  function findIndependentMagnetCandidate(performerId, rawPosition, positions, pairs = [], sourcePair = null) {
    return findIndependentMergeCandidate({
      performerId,
      rawPosition,
      positions,
      performers: plan.performers,
      pairs,
      sourcePair
    })?.id || "";
  }

  function findSameRoleSwapCandidate(performerId, nextPosition, positions, pairs = []) {
    const performer = performerById(performerId);
    if (!performer) return null;
    const sourcePair = pairForPerformer(pairs, performerId);
    if (!sourcePair) return null;
    let nearest = null;
    pairs.forEach((pair) => {
      if (pair.includes(performerId)) return;
      const sameRoleId = pair.find((id) => performerById(id)?.role === performer.role);
      if (!sameRoleId) return;
      const sameRolePosition = positions?.[sameRoleId];
      const pairPositions = pair.map((id) => positions?.[id]).filter(Boolean);
      if (!sameRolePosition || !pairPositions.length) return;
      const center = {
        x: pairPositions.reduce((sum, pos) => sum + pos.x, 0) / pairPositions.length,
        y: pairPositions.reduce((sum, pos) => sum + pos.y, 0) / pairPositions.length
      };
      const gap = Math.min(distance(nextPosition, sameRolePosition), distance(nextPosition, center));
      if (gap <= MAGNET_DISTANCE * 2 && (!nearest || gap < nearest.gap)) {
        nearest = { targetId: sameRoleId, pair, gap };
      }
    });
    return nearest;
  }

  function swapSameRolePair(sectionId, performerId, targetId) {
    const sourcePerformer = performerById(performerId);
    const targetPerformer = performerById(targetId);
    const setId = selectedSection?.partnerSetId;
    if (!setId || !sourcePerformer || !targetPerformer || sourcePerformer.role !== targetPerformer.role) return false;
    const currentSet = plan.partnerSets.find((set) => set.id === setId);
    const sourcePairIndex = currentSet?.pairs?.findIndex((pair) => pair.includes(performerId)) ?? -1;
    const targetPairIndex = currentSet?.pairs?.findIndex((pair) => pair.includes(targetId)) ?? -1;
    if (sourcePairIndex < 0 || targetPairIndex < 0 || sourcePairIndex === targetPairIndex) return false;
    updatePlan((current) => ({
      ...current,
      partnerSets: current.partnerSets.map((set) => {
        if (set.id !== setId) return set;
        if (sourcePairIndex < 0 || targetPairIndex < 0 || sourcePairIndex === targetPairIndex) return set;
        return {
          ...set,
          pairs: set.pairs.map((pair, index) => {
            if (index === sourcePairIndex) return pair.map((id) => id === performerId ? targetId : id);
            if (index === targetPairIndex) return pair.map((id) => id === targetId ? performerId : id);
            return pair;
          })
        };
      }),
      sections: current.sections.map((section) => section.id === sectionId ? { ...section } : section)
    }));
    setSelectedPairKey("");
    setStatus(`${sourcePerformer.name || sourcePerformer.label}와 ${targetPerformer.name || targetPerformer.label}를 교체했습니다.`);
    return true;
  }

  function connectPair(sectionId, firstId, secondId, center = null) {
    if (!firstId || !secondId || firstId === secondId) return;
    updatePlan((current) => {
      const section = current.sections.find((item) => item.id === sectionId);
      if (!section) return current;
      const keyframeId = selectedMovementKeyframe?.id || "";
      const editingKeyframe = isKeyframeEdit(section, keyframeId);
      const currentPositions = sectionEditPositions(section, keyframeId);
      const editSection = { ...section, positions: currentPositions };
      const setId = section.partnerSetId || uid("partners");
      const existing = current.partnerSets.find((set) => set.id === setId);
      const baseSet = existing || { id: setId, name: `${section.name} 파트너`, pairs: [] };
      const pairs = [
        ...baseSet.pairs.filter((pair) => !pair.includes(firstId) && !pair.includes(secondId)),
        [firstId, secondId]
      ];
      const firstPosition = currentPositions?.[firstId];
      const secondPosition = currentPositions?.[secondId];
      const pairCenter = center || (firstPosition && secondPosition
        ? { x: (firstPosition.x + secondPosition.x) / 2, y: (firstPosition.y + secondPosition.y) / 2 }
        : firstPosition || secondPosition || { x: 50, y: 50 });
      const pairPositions = pairGridPlacement(current, editSection, firstId, secondId, pairCenter);
      if (!pairPositions) return current;
      const nextPositions = {
        ...currentPositions,
        ...pairPositions
      };
      return {
        ...current,
        partnerSets: editingKeyframe
          ? current.partnerSets
          : existing
          ? current.partnerSets.map((set) => set.id === setId ? { ...set, pairs } : set)
          : [...current.partnerSets, { ...baseSet, pairs }],
        sections: current.sections.map((item) => item.id === sectionId
          ? sectionWithPositionPatch(item, nextPositions, keyframeId, editingKeyframe ? {} : { partnerSetId: setId })
          : item)
      };
    });
    setSelectedPairKey(pairKey([firstId, secondId]));
    setStatus("파트너가 연결되었습니다.");
  }

  function commitDropAction(action, drag) {
    if (!action || action.type === "none") return;
    updatePlan((current) => {
      const section = current.sections.find((item) => item.id === drag.sectionId);
      if (!section) return current;
      const keyframeId = drag.keyframeId || "";
      const editingKeyframe = isKeyframeEdit(section, keyframeId);
      const currentPositions = sectionEditPositions(section, keyframeId);
      const editSection = { ...section, positions: currentPositions };
      const basePositions = { ...currentPositions, ...(action.positions || {}) };

      if (action.type === "connect-pair") {
        const setId = section.partnerSetId || uid("partners");
        const existing = current.partnerSets.find((set) => set.id === setId);
        const baseSet = existing || { id: setId, name: `${section.name} 파트너`, pairs: [] };
        const dragged = basePositions[action.performerId];
        const target = basePositions[action.targetId] || currentPositions[action.targetId];
        const center = dragged && target
          ? snapPoint({ x: (dragged.x + target.x) / 2, y: (dragged.y + target.y) / 2 }, snapEnabled)
          : drag.pointer;
        const pairPositions = pairGridPlacement(current, editSection, action.performerId, action.targetId, center);
        if (!pairPositions) return current;
        const nextPositions = {
          ...basePositions,
          ...pairPositions
        };
        const pairs = [
          ...baseSet.pairs.filter((pair) => !pair.includes(action.performerId) && !pair.includes(action.targetId)),
          [action.performerId, action.targetId]
        ];
        return {
          ...current,
          partnerSets: editingKeyframe
            ? current.partnerSets
            : existing
            ? current.partnerSets.map((set) => set.id === setId ? { ...set, pairs } : set)
            : [...current.partnerSets, { ...baseSet, pairs }],
          sections: current.sections.map((item) => item.id === drag.sectionId
            ? sectionWithPositionPatch(item, nextPositions, keyframeId, editingKeyframe ? {} : { partnerSetId: setId })
            : item)
        };
      }

      if (action.type === "swap-same-role") {
        const setId = section.partnerSetId;
        const currentSet = current.partnerSets.find((set) => set.id === setId);
        const sourcePairIndex = currentSet?.pairs?.findIndex((pair) => pair.includes(action.performerId)) ?? -1;
        const targetPairIndex = currentSet?.pairs?.findIndex((pair) => pair.includes(action.targetId)) ?? -1;
        if (!setId || sourcePairIndex < 0 || targetPairIndex < 0 || sourcePairIndex === targetPairIndex) {
          return {
            ...current,
            sections: current.sections.map((item) => item.id === drag.sectionId ? sectionWithPositionPatch(item, basePositions, keyframeId) : item)
          };
        }
        const nextPairs = currentSet.pairs.map((pair, index) => {
          if (index === sourcePairIndex) return pair.map((id) => id === action.performerId ? action.targetId : id);
          if (index === targetPairIndex) return pair.map((id) => id === action.targetId ? action.performerId : id);
          return pair;
        });
        const centerForPair = (pair) => {
          const pairPositions = pair.map((id) => currentPositions?.[id]).filter(Boolean);
          if (!pairPositions.length) return { x: 50, y: 50 };
          return {
            x: pairPositions.reduce((sum, pos) => sum + pos.x, 0) / pairPositions.length,
            y: pairPositions.reduce((sum, pos) => sum + pos.y, 0) / pairPositions.length
          };
        };
        const sourcePair = nextPairs[sourcePairIndex];
        const targetPair = nextPairs[targetPairIndex];
        const sourcePositions = pairGridPlacement(
          current,
          editSection,
          sourcePair[0],
          sourcePair[1],
          centerForPair(currentSet.pairs[sourcePairIndex]),
          {},
          [...sourcePair, ...targetPair]
        );
        if (!sourcePositions) return current;
        const targetPositions = pairGridPlacement(
          current,
          editSection,
          targetPair[0],
          targetPair[1],
          centerForPair(currentSet.pairs[targetPairIndex]),
          sourcePositions,
          targetPair
        );
        if (!targetPositions) return current;
        const nextPositions = {
          ...basePositions,
          ...sourcePositions,
          ...targetPositions
        };
        return {
          ...current,
          partnerSets: editingKeyframe ? current.partnerSets : current.partnerSets.map((set) => {
            if (set.id !== setId) return set;
            return {
              ...set,
              pairs: nextPairs
            };
          }),
          sections: current.sections.map((item) => item.id === drag.sectionId ? sectionWithPositionPatch(item, nextPositions, keyframeId) : item)
        };
      }

      if (action.type === "move-pair") {
        const movingIds = Object.keys(action.positions || {});
        if (pairPlacementCollides(currentPositions, action.positions || {}, movingIds)) return current;
        return {
          ...current,
          sections: current.sections.map((item) => item.id === drag.sectionId ? sectionWithPositionPatch(item, basePositions, keyframeId) : item)
        };
      }

      const sourcePairKey = action.sourcePair ? pairKey(action.sourcePair) : "";
      return {
        ...current,
        partnerSets: !editingKeyframe && sourcePairKey && section.partnerSetId
          ? current.partnerSets.map((set) => set.id === section.partnerSetId
            ? { ...set, pairs: set.pairs.filter((pair) => pairKey(pair) !== sourcePairKey) }
            : set)
          : current.partnerSets,
        sections: current.sections.map((item) => item.id === drag.sectionId ? sectionWithPositionPatch(item, basePositions, keyframeId) : item)
      };
    });

    if (action.type === "connect-pair") {
      setSelectedPairKey(pairKey([action.performerId, action.targetId]));
      setStatus("파트너가 연결되었습니다.");
    } else if (action.type === "swap-same-role") {
      const source = performerById(action.performerId);
      const target = performerById(action.targetId);
      setSelectedPairKey("");
      setStatus(`${source?.name || source?.label || "출연자"}와 ${target?.name || target?.label || "출연자"}를 교체했습니다.`);
    } else if (action.sourcePair) {
      setSelectedPairKey("");
    setStatus("페어를 해제하고 토큰을 이동했습니다.");
    }
  }

  function removePairByKey(targetKey) {
    const setId = selectedSection?.partnerSetId;
    if (!setId || !targetKey) return;
    updatePlan((current) => ({
      ...current,
      partnerSets: current.partnerSets.map((set) => set.id === setId
        ? { ...set, pairs: set.pairs.filter((pair) => pairKey(pair) !== targetKey) }
        : set)
    }));
    setSelectedPairKey("");
    setStatus("파트너 연결을 해제했습니다.");
  }

  function addSection() {
    const captureTime = audioRef.current ? audioRef.current.currentTime || currentTime : currentTime;
    const target = resolveFormationAddTarget(sortedSections, captureTime);
    if (target.action === "select") {
      setSelectedSectionId(target.section.id);
      jumpTo(target.section);
      setStatus(`${target.section.name} 대형을 선택했습니다.`);
      return;
    }
    const time = target.time;
    const previous = target.previous;
    const positions = previous?.positions || Object.fromEntries(plan.performers.map((p, index) => [p.id, { x: 18 + index * 8, y: 55 }]));
    const section = {
      id: uid("sec"),
      name: "새 대형",
      notes: "음악을 들으며 현재 시각에 저장한 대형입니다.",
      moveMode: "smooth",
      positions: JSON.parse(JSON.stringify(positions)),
      frontFocus: [],
      partnerSetId: partnerSetIdForAddedSection(previous)
    };
    const result = applyFormationTimelineEdit({
      sections: sortedSections,
      action: "add-after",
      time,
      section
    });
    const addedSection = result.sections.find((item) => item.id === section.id) || section;
    const nextSections = result.sections.map((item) => item.id === section.id
      ? { ...item, name: `대형 ${formatTime(pointTime(addedSection))}` }
      : item);
    updatePlan((current) => ({ ...current, sections: nextSections }));
    setSelectedSectionId(section.id);
    setStatus(`${formatTime(pointTime(addedSection))}에 대형 지점을 추가했습니다. 이제 무대에서 위치를 수정하세요.`);
  }

  function previewTemplate() {
    if (!selectedTemplatePreview) return;
    setFormationPreview({ kind: "template", ...selectedTemplatePreview });
    setStatus(`${selectedTemplatePreview.label} 템플릿을 미리 봅니다. 적용 전까지 프로젝트는 바뀌지 않습니다.`);
  }

  function previewLocalProposal() {
    if (!selectedTemplatePreview || !plan) return;
    const capabilities = planCapabilities(currentAuthRequest().userId ? plan.account?.plan || "free" : "guest");
    if (!canUseAiProposal(capabilities, 0)) {
      setFormationPreview(null);
      setStatus("AI 후보는 로그인한 Free 이상 플랜에서 안전 검증 후 사용할 수 있습니다.");
      return;
    }
    const proposal = {
      source: `local-${selectedTemplatePreview.templateId}`,
      positions: selectedTemplatePreview.positions
    };
    const validation = validateFormationProposal(proposal, plan.performers, { requireAllPerformers: true });
    if (!validation.ok) {
      setFormationPreview(null);
      setStatus(`AI 후보가 안전 검사를 통과하지 못했습니다: ${validation.errors.map((error) => error.code).join(", ")}`);
      return;
    }
    setFormationPreview({
      kind: "proposal",
      label: `${selectedTemplatePreview.label} AI 후보`,
      proposal,
      positions: validation.positions
    });
    setStatus("AI 후보를 안전 검증했습니다. 적용 전까지 프로젝트는 바뀌지 않습니다.");
  }

  function applyFormationPreviewToCurrent() {
    if (!selectedSection || !formationPreview) return;
    const nextSection = formationPreview.kind === "proposal"
      ? acceptFormationProposal(selectedSection, formationPreview.proposal, plan.performers, { requireAllPerformers: true }).section
      : applyTemplatePositionsToSection(selectedSection, formationPreview);
    updatePlan((current) => ({
      ...current,
      sections: current.sections.map((section) => section.id === selectedSection.id ? nextSection : section)
    }));
    setFormationPreview(null);
    setStatus(`${selectedSection.name}에 ${formationPreview.label} 배치를 적용했습니다.`);
  }

  function createSectionFromFormationPreview() {
    if (!formationPreview || !plan) return;
    const captureTime = audioRef.current ? audioRef.current.currentTime || currentTime : currentTime;
    const target = resolveFormationAddTarget(sortedSections, captureTime);
    if (target.action === "select") {
      setSelectedSectionId(target.section.id);
      jumpTo(target.section);
      setStatus(`${target.section.name} 대형을 선택했습니다. 선택 지점에 적용하려면 다시 적용하세요.`);
      return;
    }
    const baseSection = {
      id: uid("sec"),
      name: `${formationPreview.label} 대형`,
      notes: "템플릿/AI 후보에서 명시적으로 적용한 대형입니다.",
      moveMode: "smooth",
      positions: {},
      frontFocus: [],
      partnerSetId: partnerSetIdForAddedSection(target.previous)
    };
    const section = formationPreview.kind === "proposal"
      ? acceptFormationProposal(baseSection, formationPreview.proposal, plan.performers, { requireAllPerformers: true }).section
      : applyTemplatePositionsToSection(baseSection, formationPreview);
    const result = applyFormationTimelineEdit({
      sections: sortedSections,
      action: "add-after",
      time: target.time,
      section
    });
    const addedSection = result.sections.find((item) => item.id === section.id) || section;
    updatePlan((current) => ({
      ...current,
      sections: result.sections.map((item) => item.id === section.id
        ? { ...item, name: `${formationPreview.label} ${formatTime(pointTime(addedSection))}` }
        : item)
    }));
    setSelectedSectionId(section.id);
    setFormationPreview(null);
    setStatus(`${formatTime(pointTime(addedSection))}에 ${formationPreview.label} 대형을 추가했습니다.`);
  }

  function duplicateSection() {
    if (!selectedSection) return;
    const copiedPartnerSet = selectedSection.partnerSetId
      ? plan.partnerSets.find((set) => set.id === selectedSection.partnerSetId)
      : null;
    const copiedPartnerSetId = copiedPartnerSet ? uid("partners") : "";
    const section = {
      ...JSON.parse(JSON.stringify(selectedSection)),
      id: uid("sec"),
      name: `${selectedSection.name} 복사`,
      partnerSetId: copiedPartnerSetId
    };
    const result = applyFormationTimelineEdit({
      sections: sortedSections,
      action: "add-after",
      section
    });
    updatePlan((current) => ({
      ...current,
      partnerSets: copiedPartnerSet
        ? [...current.partnerSets, { ...JSON.parse(JSON.stringify(copiedPartnerSet)), id: copiedPartnerSetId, name: `${section.name} 파트너` }]
        : current.partnerSets,
      sections: result.sections
    }));
    setSelectedSectionId(duplicateSelectionTarget(result.sections, section.id));
    setSelectedPairKey("");
    setSelectedPerformerIds([]);
  }

  function deleteSection() {
    if (!selectedSection) return;
    const target = deleteSelectionTarget(sortedSections, selectedSection.id);
    if (target.disabled) {
      setStatus("마지막 대형은 삭제할 수 없습니다.");
      return;
    }
    const nextSections = sortedSections.filter((section) => section.id !== selectedSection.id);
    updatePlan((current) => ({ ...current, sections: current.sections.filter((section) => section.id !== selectedSection.id) }));
    setSelectedSectionId(target.nextSectionId || nextSections[0]?.id || "");
    setSelectedPairKey("");
    setSelectedPerformerIds([]);
  }

  function resetSelectedFormation() {
    if (readonly || !selectedSection) return;
    const confirmed = window.confirm("선택한 대형의 토큰 위치와 페어 연결을 기본 배치로 초기화할까요?");
    if (!confirmed) return;
    const resetPositions = defaultSections(plan.performers)[0].positions;
    updatePlan((current) => ({
      ...current,
      sections: current.sections.map((section) => section.id === selectedSection.id
        ? {
            ...section,
            positions: JSON.parse(JSON.stringify(resetPositions)),
            partnerSetId: ""
          }
        : section)
    }));
    setSelectedPerformerId("");
    setSelectedPairKey("");
    setMagnetCandidateId("");
    setDragPositions(null);
    dragStateRef.current = null;
    setStatus(`${selectedSection.name} 대형을 기본 배치로 초기화했습니다.`);
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function onStagePointerDown(event, performerId) {
    if (readonly || !selectedSection) return;
    event.preventDefault();
    ignoreNextStageTapRef.current = false;
    if (event.shiftKey || event.metaKey) {
      const nextSelection = togglePerformerSelection(selectedPerformerIds, performerId, true);
      setSelectedPerformerIds(nextSelection);
      setSelectedPerformerId(performerId);
      setSelectedPairKey("");
      setTapMoveArmed(false);
      setStatus(`${nextSelection.length}명을 선택했습니다.`);
      return;
    }
    captureStagePointer(event);
    setIsBottomSheetExpanded(false);
    const pointer = clientToStagePoint(event);
    const editPositions = sectionEditPositions(selectedSection);
    const editKeyframeId = selectedMovementKeyframe?.id || "";
    const token = editPositions?.[performerId] || { x: pointer.x, y: pointer.y };
    const partnerSet = getPartnerSetForSection(selectedSection);
    const performerPair = pairForPerformer(partnerSet?.pairs || [], performerId);
    const performerPairKey = performerPair ? pairKey(performerPair) : "";
    const selectionAction = resolveSelectionClick({
      selectedPerformerId,
      selectedPairKey,
      performerId,
      performerPairKey
    });
    if (selectionAction.type === "clear") {
      clearSelection();
      setDragPositions(null);
      clearLongPressTimer();
      return;
    }
    selectPerformer(performerId);
    if (performerPair) {
      const [firstId, secondId] = performerPair;
      const firstStart = { ...(editPositions[firstId] || { x: pointer.x, y: pointer.y }) };
      const secondStart = { ...(editPositions[secondId] || { x: pointer.x, y: pointer.y }) };
      dragStateRef.current = {
        mode: "pair-move",
        source: "token",
        draggedPerformerId: performerId,
        canPullOutMember: true,
        longPressReady: false,
        pair: [...performerPair],
        sectionId: selectedSection.id,
        keyframeId: editKeyframeId,
        pointerId: event.pointerId,
        pointer,
        startPointer: pointer,
        moved: false,
        startPositions: {
          [firstId]: firstStart,
          [secondId]: secondStart
        },
        finalPositions: {
          [firstId]: firstStart,
          [secondId]: secondStart
        }
      };
      selectPair(performerPairKey, performerId);
      setDragPositions(dragStateRef.current.finalPositions);
      clearLongPressTimer();
      longPressTimerRef.current = setTimeout(() => {
        const activeDrag = dragStateRef.current;
        if (activeDrag?.mode === "pair-move" && activeDrag.pointerId === event.pointerId) {
          activeDrag.longPressReady = true;
          setDragHint("해제 후 이동 준비");
        }
        longPressTimerRef.current = null;
      }, LONG_PRESS_MS);
      return;
    }
    dragStateRef.current = {
      mode: "token-move",
      performerId,
      performerIds: selectedPerformerIds.includes(performerId) && selectedPerformerIds.length > 1 ? selectedPerformerIds : [performerId],
      sectionId: selectedSection.id,
      keyframeId: editKeyframeId,
      pointerId: event.pointerId,
      individual: false,
      sourcePair: performerPair ? [...performerPair] : null,
      offsetX: token.x - pointer.x,
      offsetY: token.y - pointer.y,
      pointer,
      startPointer: pointer,
      moved: false,
      finalPositions: {
        [performerId]: token
      }
    };
    setDragPositions({ [performerId]: token });
  }

  function shouldPullOutPairMember(drag, pointer) {
    return Boolean(drag.draggedPerformerId) && shouldStartPairMemberPullOut(drag, pointer);
  }

  function convertPairDragToMemberPullOut(drag, pointer) {
    const performerId = drag.draggedPerformerId;
    const currentToken = drag.startPositions?.[performerId];
    const basePointer = drag.startPointer || drag.pointer;
    if (!performerId || !currentToken || !basePointer) return;
    drag.mode = "token-move";
    drag.performerId = performerId;
    drag.individual = true;
    drag.sourcePair = [...(drag.pair || [])];
    drag.offsetX = currentToken.x - basePointer.x;
    drag.offsetY = currentToken.y - basePointer.y;
    drag.pointer = pointer;
    drag.startPointer = basePointer;
    drag.moved = true;
    drag.finalPositions = { [performerId]: currentToken };
    setSelectedPairKey("");
    setDragHint("놓으면 페어 해제");
  }

  function onStagePointerMove(event) {
    if (readonly || !selectedSection) return;
    const drag = dragStateRef.current;
    if (!drag || drag.sectionId !== selectedSection.id || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const pointer = clientToStagePoint(event);
    if (drag.mode === "pair-move") {
      if (distance(pointer, drag.startPointer || drag.pointer) > 0.8) {
        drag.moved = true;
        clearLongPressTimer();
      }
      if (shouldPullOutPairMember(drag, pointer)) {
        convertPairDragToMemberPullOut(drag, pointer);
      } else {
        updatePairDrag(event, drag, pointer);
        return;
      }
    }
    const performerId = drag.performerId;
    if (!performerId) return;
    clearLongPressTimer();
    if (distance(pointer, drag.startPointer || drag.pointer) > 0.8) {
      drag.moved = true;
    }
    const rawPosition = {
      x: clamp(pointer.x + drag.offsetX, 4, 96),
      y: clamp(pointer.y + drag.offsetY, 5, 95)
    };
    const snapped = snapPoint(rawPosition, snapEnabled && !event.altKey);
    const nextPosition = {
      x: clamp(snapped.x, 4, 96),
      y: clamp(snapped.y, 5, 95)
    };
    const partnerSet = getPartnerSetForSection(selectedSection);
    const pairs = partnerSet?.pairs || [];
    const editPositions = sectionEditPositions(selectedSection, drag.keyframeId);
    const groupIds = Array.isArray(drag.performerIds) ? drag.performerIds.filter((id) => editPositions[id]) : [performerId];
    const groupDelta = {
      x: nextPosition.x - (editPositions[performerId]?.x || nextPosition.x),
      y: nextPosition.y - (editPositions[performerId]?.y || nextPosition.y)
    };
    const movedGroupPositions = groupIds.length > 1
      ? Object.fromEntries(groupIds.map((id) => [id, moveSelectedPerformers(editPositions, [id], groupDelta)[id]]))
      : { [performerId]: nextPosition };
    const nextPositions = { ...editPositions, ...movedGroupPositions };
    const swapCandidate = drag.individual && drag.sourcePair
      ? findSameRoleSwapCandidate(performerId, nextPosition, nextPositions, pairs)
      : null;
    const candidateId = groupIds.length > 1 || swapCandidate
      ? ""
      : findIndependentMagnetCandidate(performerId, rawPosition, nextPositions, pairs, drag.sourcePair);
    drag.candidateId = candidateId;
    drag.swapCandidate = swapCandidate;
    drag.pointer = pointer;
    drag.finalPositions = movedGroupPositions;
    setDragHint(swapCandidate
      ? `놓으면 ${(performerById(swapCandidate.targetId)?.name || performerById(swapCandidate.targetId)?.label || "대상")}와 교체`
      : drag.individual
        ? "개별 조정 중"
        : candidateId
          ? "놓으면 파트너 연결"
          : "");
    setMagnetCandidateId(candidateId);
    setDragPositions(drag.finalPositions);
  }

  function finishTokenDrag() {
    clearLongPressTimer();
    const drag = dragStateRef.current;
    if (drag?.moved) ignoreNextStageTapRef.current = true;
    if (drag?.mode === "pair-move") {
      finishPairDrag();
      return;
    }
    if (drag?.mode === "token-move") {
      if (drag.moved) {
        const action = resolveDropAction({
          drag,
          connectCandidate: drag.candidateId ? { id: drag.candidateId } : null,
          swapCandidate: drag.swapCandidate
        });
        commitDropAction(action, drag);
        clearSelection();
      }
    }
    setMagnetCandidateId("");
    setDragHint("");
    setDragPositions(null);
    dragStateRef.current = null;
  }

  function clearDrag() {
    clearLongPressTimer();
    setMagnetCandidateId("");
    setDragHint("");
    setDragPositions(null);
    dragStateRef.current = null;
  }

  function finishActiveDrag() {
    const drag = dragStateRef.current;
    if (drag?.mode === "pair-move") {
      finishPairDrag();
      return;
    }
    finishTokenDrag();
  }

  function finishPairDrag() {
    clearLongPressTimer();
    const drag = dragStateRef.current;
    if (drag?.moved) ignoreNextStageTapRef.current = true;
    if (drag?.mode === "pair-move" && drag.finalPositions) {
      const action = resolveDropAction({ drag });
      commitDropAction(action, drag);
      clearSelection();
    }
    setDragPositions(null);
    setDragHint("");
    dragStateRef.current = null;
  }

  function onPairPointerDown(event, pair, pairIndex) {
    if (readonly || !selectedSection) return;
    event.preventDefault();
    event.stopPropagation();
    ignoreNextStageTapRef.current = false;
    const nextPairKey = pairKey(pair);
    const selectionAction = resolveSelectionClick({ selectedPerformerId, selectedPairKey, pairKey: nextPairKey });
    if (selectionAction.type === "clear") {
      clearSelection();
      setDragPositions(null);
      clearLongPressTimer();
      dragStateRef.current = null;
      return;
    }
    captureStagePointer(event);
    clearLongPressTimer();
    setIsBottomSheetExpanded(false);
    const pointer = clientToStagePoint(event);
    const [firstId, secondId] = pair;
    const editPositions = sectionEditPositions(selectedSection);
    const editKeyframeId = selectedMovementKeyframe?.id || "";
    dragStateRef.current = {
      mode: "pair-move",
      pairIndex,
      pair: [...pair],
      sectionId: selectedSection.id,
      keyframeId: editKeyframeId,
      pointerId: event.pointerId,
      pointer,
      startPointer: pointer,
      moved: false,
      startPositions: {
        [firstId]: { ...editPositions[firstId] },
        [secondId]: { ...editPositions[secondId] }
      },
      finalPositions: {}
    };
    setDragPositions({
      [firstId]: { ...editPositions[firstId] },
      [secondId]: { ...editPositions[secondId] }
    });
    selectPair(nextPairKey);
  }

  function updatePairDrag(event, drag, pointer = clientToStagePoint(event)) {
    const [firstId, secondId] = drag.pair;
    const firstStart = drag.startPositions[firstId];
    const secondStart = drag.startPositions[secondId];
    if (!firstStart || !secondStart) return null;
    const startCenter = {
      x: (firstStart.x + secondStart.x) / 2,
      y: (firstStart.y + secondStart.y) / 2
    };
    const basePointer = drag.startPointer || drag.pointer;
    const targetCenter = {
      x: startCenter.x + pointer.x - basePointer.x,
      y: startCenter.y + pointer.y - basePointer.y
    };
    const finalPositions = pairGridPlacement(plan, { ...selectedSection, positions: sectionEditPositions(selectedSection, drag.keyframeId) }, firstId, secondId, targetCenter);
    if (!finalPositions) {
      setDragHint("이동할 빈 그리드가 없습니다");
      return null;
    }
    drag.finalPositions = finalPositions;
    setDragPositions(drag.finalPositions);
    setDragHint(drag.source === "token" ? "페어 이동 중" : "");
    return drag.finalPositions;
  }

  function positionsForPairCenter(pair, center) {
    const [firstId, secondId] = pair;
    return pairGridPlacement(plan, { ...selectedSection, positions: sectionEditPositions(selectedSection) }, firstId, secondId, center);
  }

  function handleStageTap(event) {
    if (readonly || !selectedSection) return;
    if (ignoreNextStageTapRef.current) {
      ignoreNextStageTapRef.current = false;
      return;
    }
    if (dragStateRef.current) return;
    if (event.target.closest?.(".token, .pair-link")) return;
    const tapAction = resolveEmptyStageTap({ selectedPerformerId, selectedPairKey, tapMoveArmed });
    if (tapAction.type === "none") {
      if (tapAction.clearSelection) clearSelection();
      return;
    }
    const pointer = clientToStagePoint(event);
    const targetPoint = snapPoint(pointer, snapEnabled);
    const partnerSet = getPartnerSetForSection(selectedSection);
    const selectedPair = (partnerSet?.pairs || []).find((pair) => pairKey(pair) === selectedPairKey)
      || (selectedPerformerId ? pairForPerformer(partnerSet?.pairs || [], selectedPerformerId) : null);

    if (tapAction.type === "move-pair" && selectedPair) {
      const finalPositions = positionsForPairCenter(selectedPair, targetPoint);
      if (!finalPositions) return;
      const drag = {
        mode: "pair-move",
        source: "tap",
        pair: [...selectedPair],
        sectionId: selectedSection.id,
        keyframeId: selectedMovementKeyframe?.id || "",
        pointer: targetPoint,
        finalPositions
      };
      commitDropAction(resolveDropAction({ drag }), drag);
      setDragPositions(null);
      clearSelection();
      return;
    }

    if (tapAction.type !== "move-token" || !selectedPerformerId) return;
    const nextPosition = {
      x: clamp(targetPoint.x, 4, 96),
      y: clamp(targetPoint.y, 5, 95)
    };
    const editKeyframeId = selectedMovementKeyframe?.id || "";
    const nextPositions = { ...sectionEditPositions(selectedSection, editKeyframeId), [selectedPerformerId]: nextPosition };
    const candidateId = findIndependentMagnetCandidate(selectedPerformerId, pointer, nextPositions, partnerSet?.pairs || []);
    const drag = {
      mode: "token-move",
      source: "tap",
      performerId: selectedPerformerId,
      sectionId: selectedSection.id,
      keyframeId: editKeyframeId,
      pointer: targetPoint,
      individual: false,
      finalPositions: { [selectedPerformerId]: nextPosition }
    };
    const action = resolveDropAction({
      drag,
      connectCandidate: candidateId ? { id: candidateId } : null,
      swapCandidate: null
    });
    commitDropAction(action, drag);
    setMagnetCandidateId("");
    setDragHint("");
    setDragPositions(null);
    clearSelection();
  }

  async function handleAudioFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const fingerprint = audioFingerprint(file);
    const restoredAudioUrl = resolveAudioUrl(plan.audio);
    const replacingAudio = Boolean(restoredAudioUrl || audioSrc);
    if (restoredAudioUrl && audioMatchesFile(plan.audio, file, fingerprint)) {
      rejectedAudioUrlsRef.current = new Set();
      if (localAudioUrlRef.current) {
        URL.revokeObjectURL(localAudioUrlRef.current);
        localAudioUrlRef.current = "";
      }
      setAudioSrc(restoredAudioUrl);
      setAudioUploadStatus("uploaded");
      setStatus(`이미 저장된 서버 음악을 다시 연결했습니다: ${plan.audio.fileName || file.name}`);
      event.target.value = "";
      return;
    }
    let localUrl = "";
    if (!replacingAudio) {
      if (localAudioUrlRef.current) URL.revokeObjectURL(localAudioUrlRef.current);
      localUrl = URL.createObjectURL(file);
      localAudioUrlRef.current = localUrl;
      rejectedAudioUrlsRef.current = new Set();
      setAudioSrc(localUrl);
    }
    setAudioUploadStatus("uploading");
    setStatus(replacingAudio ? "새 음악으로 교체하는 중..." : "음악을 선택했습니다. 서버에 업로드하는 중...");
    setStatusRecovery("");
    try {
      const audio = await uploadAudioToSupabase(file, plan?.localProjectId || plan?.title || "project", fingerprint, currentAuthRequest());
      updatePlan((current) => ({ ...current, audio }));
      rejectedAudioUrlsRef.current = new Set();
      setAudioSrc(resolveAudioUrl(audio));
      setAudioUploadStatus("uploaded");
      setStatus(`음악 저장됨: ${audio.fileName}`);
      if (localAudioUrlRef.current) {
        URL.revokeObjectURL(localAudioUrlRef.current);
        localAudioUrlRef.current = "";
      }
      event.target.value = "";
    } catch (error) {
      setAudioUploadStatus("failed");
      setStatusRecovery(replacingAudio ? "audio" : "");
      setStatus(replacingAudio
        ? `음악 교체 실패: ${error.message}. 기존 음악을 유지합니다.`
        : `음악 업로드 실패: ${error.message}. 서버 저장은 실패했지만 이 브라우저에서는 음악을 들으며 편집할 수 있습니다. 공유 링크에서 음악을 재생하려면 Supabase bucket 설정이 필요합니다.`);
      event.target.value = "";
    }
  }

  function reconnectServerAudio() {
    if (restoreAudioFromPlan(plan)) {
      setStatus("저장된 서버 음악을 다시 연결했습니다.");
      setStatusRecovery("");
    } else {
      setStatusRecovery("audio");
      setStatus("저장된 음악 URL이 없습니다. 음악을 다시 선택해 주세요.");
    }
  }

  function jumpTo(section) {
    clearSelection();
    setSelectedSectionId(section.id);
    const nextTime = pointTime(section);
    setCurrentTime(nextTime);
    if (audioRef.current) audioRef.current.currentTime = nextTime;
  }

  function syncAudioTime() {
    if (!audioRef.current) return;
    setCurrentTime(audioRef.current.currentTime || 0);
    if (Number.isFinite(audioRef.current.duration)) {
      setDuration(audioRef.current.duration);
    }
  }

  async function togglePlayback() {
    if (!audioRef.current || !audioSrc) {
      setStatus("음악 파일을 먼저 불러오세요. 음악 없이 확인하려면 슬라이더를 움직이면 됩니다.");
      return;
    }
    if (audioRef.current.paused) {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
        setStatus("");
        setStatusRecovery("");
      } catch (error) {
        setStatusRecovery("audio");
        setStatus(`재생을 시작할 수 없습니다: ${error.message}`);
      }
    } else {
      audioRef.current.pause();
      setIsPlaying(false);
      syncAudioTime();
    }
  }

  function saveEditableCopy() {
    if (!plan) return;
    const copiedAt = new Date().toISOString();
    const copy = {
      ...clonePlan(plan),
      id: uid("project"),
      title: `${plan.title || "공유 Movemap"} 사본`,
      updatedAt: copiedAt
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
    window.location.href = "/";
  }

  async function persistProjectToCloud(planToSave = plan) {
    if (editLinkAuthorized && linkMode.editToken) {
      const saved = await saveCloudProjectByEditToken(normalizePlan(planToSave), linkMode.editToken, supabaseConfig());
      const normalized = normalizePlan(saved.plan);
      setPlan(normalized);
      setLocalSavedAt(saved.savedAt);
      return { ...saved, plan: normalized };
    }
    const auth = currentAuthRequest();
    if (!auth.userId || !auth.accessToken) {
      throw new Error("Google 로그인 후 클라우드 저장과 공유 링크를 사용할 수 있습니다.");
    }
    const ownerPlan = normalizePlan({
      ...planToSave,
      owner: { ...planToSave.owner, userId: auth.userId },
      account: { plan: auth.accountPlan || planToSave.account?.plan || "free" }
    });
    const capabilities = planCapabilities(ownerPlan.account?.plan || "free");
    if (!canOwnCloudProject(capabilities)) {
      throw new Error("현재 계정 플랜에서는 클라우드 저장을 사용할 수 없습니다.");
    }
    const saved = await saveCloudProject(ownerPlan, supabaseConfig(), fetch, auth);
    const normalized = normalizePlan(saved.plan);
    setPlan(normalized);
    setLocalSavedAt(saved.savedAt);
    return { ...saved, plan: normalized };
  }

  async function saveProjectToCloud() {
    if (!plan) return;
    try {
      setStatus("클라우드에 저장하는 중...");
      setStatusRecovery("");
      const saved = await persistProjectToCloud();
      const viewReadyPlan = projectWithShareLink(saved.plan, { linkType: LINK_TYPES.view, projectId: saved.id });
      const linkedSaved = await persistProjectToCloud(viewReadyPlan);
      setShareUrl(shareUrlForProject(linkedSaved.id));
      setEditShareUrl(editShareUrlForProject(linkedSaved.plan.shareLinks?.edit?.projectId || linkedSaved.id, linkedSaved.plan.shareLinks?.edit?.token || ""));
      setStatus(`클라우드에 저장됨 · View Link 사용 가능 · ${formatClockTime(linkedSaved.savedAt)}`);
    } catch (error) {
      setStatusRecovery("share");
      setStatus(`Supabase 저장 실패: ${error.message}. 파일로 공유하거나 백업할 수 있습니다.`);
    }
  }

  async function shareProject() {
    try {
      setStatus("View Link와 Edit Link를 만드는 중...");
      setStatusRecovery("");
      const saved = await persistProjectToCloud();
      const editToken = saved.plan.shareLinks?.edit?.token || createEditLinkToken();
      const linkedPlan = projectWithShareLink(
        projectWithShareLink(saved.plan, { linkType: LINK_TYPES.view, projectId: saved.id }),
        { linkType: LINK_TYPES.edit, projectId: saved.id, token: editToken }
      );
      const linkedSaved = await persistProjectToCloud(linkedPlan);
      setShareUrl(shareUrlForProject(linkedSaved.id));
      setEditShareUrl(editShareUrlForProject(linkedSaved.id, linkedSaved.plan.shareLinks?.edit?.token || editToken));
      setStatus("View Link와 Edit Link가 생성되었습니다.");
    } catch (error) {
      setStatusRecovery("share");
      setStatus(`Supabase 저장 실패: ${error.message}. 파일로 공유하거나 백업할 수 있습니다.`);
    }
  }

  async function setShareLinkEnabled(linkTypeToUpdate, enabled) {
    const auth = currentAuthRequest();
    if (!plan || !auth.userId || plan.owner?.userId !== auth.userId) {
      setStatus("링크 관리는 이 프로젝트를 만든 Google 로그인 계정에서만 가능합니다.");
      return;
    }
    try {
      const nextPlan = projectWithShareLinkEnabled(plan, linkTypeToUpdate, enabled);
      const saved = await persistProjectToCloud(nextPlan);
      setShareUrl(shareUrlForProject(saved.plan.shareLinks?.view?.projectId || saved.id));
      setEditShareUrl(editShareUrlForProject(saved.plan.shareLinks?.edit?.projectId || saved.id, saved.plan.shareLinks?.edit?.token || ""));
      setStatus(`${linkTypeToUpdate === LINK_TYPES.edit ? "Edit Link" : "View Link"}를 ${enabled ? "활성화" : "비활성화"}했습니다.`);
    } catch (error) {
      setStatusRecovery("share");
      setStatus(`링크 상태 저장 실패: ${error.message}`);
    }
  }

  async function copyShareUrl() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard?.writeText(shareUrl);
      setStatusRecovery("");
      setStatus("공유 링크를 복사했습니다.");
    } catch (error) {
      setStatusRecovery("");
      setStatus("공유 링크 복사 실패: 브라우저 주소 표시줄에서 직접 복사해 주세요.");
    }
  }

  async function copyEditShareUrl() {
    if (!editShareUrl) return;
    try {
      await navigator.clipboard?.writeText(editShareUrl);
      setStatusRecovery("");
      setStatus("편집 링크를 복사했습니다.");
    } catch (error) {
      setStatusRecovery("");
      setStatus("편집 링크 복사 실패: 브라우저 주소 표시줄에서 직접 복사해 주세요.");
    }
  }

  function exportJson() {
    const { blob, filename } = createProjectJsonDownload(withProjectSnapshotMetadata(plan));
    const url = URL.createObjectURL(blob);
    downloadUrl(url, filename);
  }

  function importJson(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
    const loaded = JSON.parse(reader.result);
        const validation = validateProjectImport(loaded);
        if (!validation.ok) {
          setStatus(`올바른 Movemap 프로젝트 파일이 아닙니다: ${validation.errors[0]?.message || "형식 오류"}`);
          return;
        }
        const normalized = normalizePlan(loaded);
        setPlan(normalized);
        setSelectedSectionId(normalized.sections[0]?.id || "");
        setSelectedPerformerId("");
        setSelectedPairKey("");
        setIsProjectMenuOpen(false);
        setIsShareMenuOpen(false);
        setUndoStack([]);
        setRedoStack([]);
        resetTransientEditState();
        const restored = restoreAudioFromPlan(normalized, { clearWhenMissing: true });
        setStatus(restored ? "저장한 프로젝트와 서버 음악을 불러왔습니다." : "저장한 프로젝트를 불러왔습니다.");
      } catch {
        setStatus("프로젝트 파일을 읽을 수 없습니다.");
      }
    };
    reader.readAsText(file);
  }

  async function exportPng(sectionIndex = selectedSectionIndex) {
    const svg = buildStageSvg({ ...plan, sections: sortedSections }, sectionIndex, { selectedId: selectedPerformerId, readonly: true });
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = STAGE_WIDTH * 2;
      canvas.height = STAGE_HEIGHT * 2;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((png) => {
        const pngUrl = URL.createObjectURL(png);
        const section = sortedSections[sectionIndex];
        const order = String(sectionIndex + 1).padStart(2, "0");
        const time = safeFilename(formatTime(pointTime(section || {})));
        downloadUrl(pngUrl, `${safeFilename(plan.title)}-${order}-${time}-${safeFilename(section?.name || "point")}.png`);
      });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  async function exportAllPng() {
    for (let index = 0; index < sortedSections.length; index += 1) {
      // Small delay keeps browser downloads reliable.
      setTimeout(() => exportPng(index), index * 350);
    }
  }

  function downloadUrl(url, filename) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function addPair() {
    if (!selectedSection || plan.performers.length < 2) return;
    const first = plan.performers[0].id;
    const second = plan.performers[1].id;
    connectPair(selectedSection.id, first, second);
  }

  function updatePair(pairIndex, side, performerId) {
    const setId = selectedSection?.partnerSetId;
    if (!setId) return;
    updatePlan((current) => ({
      ...current,
      partnerSets: current.partnerSets.map((set) => {
        if (set.id !== setId) return set;
        return {
          ...set,
          pairs: set.pairs
            .map((pair, index) => index === pairIndex ? side === 0 ? [performerId, pair[1]] : [pair[0], performerId] : pair)
            .filter((pair, index) => {
              const target = set.pairs[pairIndex];
              if (index === pairIndex) return pair[0] !== pair[1];
              return !pair.includes(performerId) || target?.includes(performerId);
            })
        };
      })
    }));
  }

  if (!plan && !readonly) {
    return <Wizard onCreate={(project) => {
      setPlan(project);
      setSelectedSectionId(project.sections[0]?.id || "");
      setUndoStack([]);
      setRedoStack([]);
    }} />;
  }

  if (!plan) {
    return <div className="loading">{status || "공유 프로젝트를 불러오는 중..."}</div>;
  }

  const partnerSet = plan.partnerSets.find((set) => set.id === selectedSection?.partnerSetId);
  const selectedPair = (partnerSet?.pairs || []).find((pair) => pairKey(pair) === selectedPairKey) || null;
  const frontZeroPerformers = plan.performers.filter((performer) => (counts[performer.id] || 0) === 0);
  const unnamedPerformers = plan.performers.filter((performer) => !String(performer.name || "").trim());
  const hasPngBackup = false;
  const audioUrlSaved = Boolean(resolveAudioUrl(plan.audio));
  const audioLoadFailed = audioUploadStatus === "failed" && audioUrlSaved;
  const hasUsableAudio = Boolean(audioSrc);
  const musicActionLabel = audioUploadStatus === "uploading"
    ? audioUrlSaved || hasUsableAudio ? "교체 중..." : "업로드 중..."
    : audioLoadFailed ? "다시 연결" : audioUrlSaved || hasUsableAudio ? "교체" : "음악 업로드";
  const musicTitle = plan.audio?.fileName || (hasUsableAudio ? "선택한 음악" : "");
  const currentAuth = currentAuthRequest();
  const signedInOwner = Boolean(currentAuth.userId && plan.owner?.userId === currentAuth.userId);
  const authLabel = authSession?.user?.email || (currentAuth.userId ? "Google 로그인됨" : "게스트 데모");
  const currentPlanCapabilities = planCapabilities(currentAuth.userId ? plan.account?.plan || currentAuth.accountPlan || "free" : "guest");
  const planLimitText = currentPlanCapabilities.demoOnly
    ? "게스트 데모 · 클라우드/AI 비활성"
    : `${currentPlanCapabilities.type.toUpperCase()} · 프로젝트 ${currentPlanCapabilities.limits.cloudProjects === Infinity ? "무제한" : currentPlanCapabilities.limits.cloudProjects} · AI ${currentPlanCapabilities.limits.aiProposalsPerMonth === Infinity ? "무제한" : `${currentPlanCapabilities.limits.aiProposalsPerMonth}/월`}`;
  const canUseAdvancedExports = !currentPlanCapabilities.demoOnly;
  const canCreateViewLink = canCreateLink(currentPlanCapabilities, LINK_TYPES.view, plan.shareLinks?.view?.projectId ? 1 : 0);
  const canCreateEditLink = canCreateLink(currentPlanCapabilities, LINK_TYPES.edit, plan.shareLinks?.edit?.projectId ? 1 : 0);
  const canManageLinks = Boolean(!readonly && plan.shareLinks?.view?.projectId && signedInOwner);
  const viewLinkState = plan.shareLinks?.view?.enabled === false ? "꺼짐" : shareUrl ? "켜짐" : "없음";
  const editLinkState = plan.shareLinks?.edit?.enabled === false ? "꺼짐" : editShareUrl ? "켜짐" : "없음";
  const activeTransitionFilter = (() => {
    if (showAllTransitionPaths) return { filter: "all", role: "", label: "전체" };
    if (transitionPathFilter === "groupA") return { filter: "role", role: "groupA", label: "A 그룹" };
    if (transitionPathFilter === "groupB") return { filter: "role", role: "groupB", label: "B 그룹" };
    if (transitionPathFilter === "selected-pair" && selectedPair) return { filter: "selected-pair", role: "", label: "선택 페어" };
    if (transitionPathFilter === "selected-performer" && selectedPerformerId) return { filter: "selected-performer", role: "", label: "선택 토큰" };
    if (selectedPair) return { filter: "selected-pair", role: "", label: "선택 페어" };
    if (selectedPerformerId) return { filter: "selected-performer", role: "", label: "선택 토큰" };
    return { filter: "all", role: "", label: "전체" };
  })();
  const activeTransitionPaths = buildTransitionPaths({
    performers: plan.performers,
    previousSection: sortedSections[selectedSectionIndex - 1],
    currentSection: selectedSection,
    nextSection: sortedSections[selectedSectionIndex + 1],
    selectedPerformerId,
    selectedPair: selectedPair || [],
    filter: activeTransitionFilter.filter,
    role: activeTransitionFilter.role
  });
  const activeFocusedPerformerIds = activeTransitionFilter.filter === "selected-pair"
    ? selectedPair || []
    : activeTransitionFilter.filter === "selected-performer"
      ? [selectedPerformerId]
      : [];
  const activeTransitionWarnings = longDistanceWarnings(activeTransitionPaths, plan.performers);
  const activeOverlapWarnings = overlapWarnings(selectedSection, plan.performers);
  const transitionFilterButtons = [
    ["auto", selectedPair || selectedPerformerId ? "선택" : "자동"],
    ["all", "전체"],
    ["groupA", "A"],
    ["groupB", "B"]
  ];

  function renderShareMenu() {
    return (
      <div className="top-action-menu share-action-menu">
        {!readonly && <button className="primary" onClick={shareProject} disabled={!canCreateViewLink && !plan.shareLinks?.view?.projectId}>편집 링크 만들기</button>}
        {shareUrl && <button onClick={copyShareUrl}>보기 링크 복사</button>}
        {editShareUrl && !readonly && <button onClick={copyEditShareUrl}>편집 링크 복사</button>}
        {canManageLinks && (
          <>
            {shareUrl && <button onClick={() => setShareLinkEnabled(LINK_TYPES.view, !plan.shareLinks?.view?.enabled)}>View Link {plan.shareLinks?.view?.enabled === false ? "켜기" : "끄기"}</button>}
            {editShareUrl && !readonly && <button onClick={() => setShareLinkEnabled(LINK_TYPES.edit, !plan.shareLinks?.edit?.enabled)}>Edit Link {plan.shareLinks?.edit?.enabled === false ? "켜기" : "끄기"}</button>}
          </>
        )}
        <button onClick={exportJson}>{readonly ? "JSON 내보내기" : "프로젝트 파일 공유"}</button>
        <button onClick={() => exportPng()} disabled={!canUseAdvancedExports}>현재 PNG</button>
        <button onClick={exportAllPng} disabled={!canUseAdvancedExports}>대형 PNG 전체 저장</button>
        <button onClick={() => window.print()} disabled={!canUseAdvancedExports}>인쇄/PDF</button>
        {!readonly && <label className="file-button tertiary">저장한 프로젝트 열기<input type="file" accept="application/json" onChange={importJson} /></label>}
      </div>
    );
  }

  function returnToProjectPicker() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    setPlan(null);
    setSelectedSectionId("");
    setSelectedPerformerId("");
    setSelectedPairKey("");
    setSelectedMovementKeyframeId("");
    setCurrentTime(0);
    setIsPlaying(false);
    setAudioSrc("");
    setAudioUploadStatus("idle");
    setIsProjectMenuOpen(false);
    setIsShareMenuOpen(false);
    setIsToolDrawerOpen(false);
    setUndoStack([]);
    setRedoStack([]);
    resetTransientEditState();
    if (audioRef.current) audioRef.current.pause();
    if (localAudioUrlRef.current) {
      URL.revokeObjectURL(localAudioUrlRef.current);
      localAudioUrlRef.current = "";
    }
    setStatus("프로젝트 선택 화면으로 돌아왔습니다.");
  }

  function renderProjectMenu() {
    return (
      <div className="top-action-menu project-action-menu">
        <button onClick={returnToProjectPicker}>프로젝트 선택으로 돌아가기</button>
        <label className="file-button tertiary">저장한 프로젝트 열기<input type="file" accept="application/json" onChange={importJson} /></label>
      </div>
    );
  }

  function renderFormationPanel() {
    return (
      <div className="form-stack">
        <div className="panel-head">
          <div>
            <h2>대형</h2>
            <p className="muted">시각마다 도착할 대형을 관리합니다.</p>
          </div>
        </div>
        <div className="section-list mobile-section-list">
          {sortedSections.map((section) => (
            <button
              key={section.id}
              className={[
                "section-item",
                section.id === selectedSection?.id ? "active" : "",
                section.id === sortedSections[timeSectionIndex]?.id ? "current-time" : ""
              ].filter(Boolean).join(" ")}
              onClick={() => jumpTo(section)}
            >
              <strong>{section.name}</strong>
              <span>도착 {formatTime(pointTime(section))}</span>
              <em>{pointMoveDuration(section) > 0 ? `${pointMoveDuration(section)}초 이동` : "즉시/고정"}</em>
            </button>
          ))}
        </div>
        {!sortedSections.length && (
          <p className="muted">하단의 대형 추가 버튼으로 첫 대형을 추가하세요.</p>
        )}
        {!readonly && (
          <div className="row-actions">
            <button onClick={duplicateSection}>복제</button>
            <button onClick={deleteSection} disabled={sortedSections.length <= 1} title={sortedSections.length <= 1 ? "마지막 대형은 삭제할 수 없습니다." : "선택 대형 삭제"}>삭제</button>
          </div>
        )}

        {selectedSection ? (
          <>
            <label>지점명<input readOnly={readonly} value={selectedSection.name} onChange={(event) => updateSection(selectedSection.id, { name: event.target.value })} /></label>
            <div className="two-col">
              <div className="readonly-field">
                <span>도착 시각</span>
                <strong>{formatTime(pointTime(selectedSection))}</strong>
              </div>
              <div className="readonly-field">
                <span>이동 시간</span>
                <strong>{pointMoveDuration(selectedSection)}초</strong>
              </div>
            </div>
            <p className="muted">이전 대형에서 이 지점까지 {pointMoveDuration(selectedSection)}초 동안 이동해 {formatTime(pointTime(selectedSection))}에 도착합니다.</p>
            <label>메모<textarea readOnly={readonly} value={selectedSection.notes} onChange={(event) => updateSection(selectedSection.id, { notes: event.target.value })} /></label>
            {!readonly && (
              <div className="tool-card template-tool-card">
                <strong>템플릿 / AI 후보</strong>
                <span>미리보기와 안전 검증 후 선택한 대형에 적용합니다.</span>
                <label>
                  배치 템플릿
                  <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
                    {FORMATION_TEMPLATES.map((template) => (
                      <option key={template.id} value={template.id}>{template.label}</option>
                    ))}
                  </select>
                </label>
                <div className="row-actions">
                  <button onClick={previewTemplate}>미리보기</button>
                  <button onClick={previewLocalProposal}>AI 후보 검증</button>
                </div>
                {formationPreview && (
                  <div className="template-preview-status">
                    <span>{formationPreview.label}</span>
                    <div className="row-actions">
                      <button onClick={applyFormationPreviewToCurrent}>현재 대형에 적용</button>
                      <button onClick={createSectionFromFormationPreview}>새 대형으로 추가</button>
                      <button onClick={() => setFormationPreview(null)}>취소</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        ) : <p className="muted">대형 지점을 선택하세요.</p>}
      </div>
    );
  }

  function renderArrangePanel() {
    const selectedPerformer = plan.performers.find((performer) => performer.id === selectedPerformerId);
    const selectedPair = (partnerSet?.pairs || []).find((pair) => pairKey(pair) === selectedPairKey);
    const selectedPairNames = selectedPair
      ? selectedPair.map((id) => {
        const performer = plan.performers.find((item) => item.id === id);
        return performer?.name || performer?.label || id;
      })
      : [];
    const selectionTitle = dragHint || (
      selectedPair
        ? `${selectedPairNames.join(" - ")} 페어`
        : selectedPerformerIds.length > 1
          ? `${selectedPerformerIds.length}명 선택`
          : selectedPerformer
          ? `${selectedPerformer.name || selectedPerformer.label} 토큰`
          : "선택 없음"
    );
    const alignSelection = (axis) => {
      if (!selectedSection || selectedPerformerIds.length < 2) return;
      const editKeyframeId = selectedMovementKeyframe?.id || "";
      updatePlan((current) => ({
        ...current,
        sections: current.sections.map((section) => section.id === selectedSection.id
          ? sectionWithPositionPatch(section, alignSelectedPerformers(sectionEditPositions(section, editKeyframeId), selectedPerformerIds, axis), editKeyframeId)
          : section)
      }));
    };
    const selectRole = (role) => {
      const ids = performerIdsForRole(plan.performers, role);
      setSelectedPerformerIds(ids);
      setSelectedPerformerId(ids[0] || "");
      setSelectedPairKey("");
      setStatus(`${ids.length}명을 선택했습니다.`);
    };
    return (
      <div className="form-stack">
        <div className="panel-head">
          <div>
            <h2>배치</h2>
            <p className="muted">무대 위 토큰과 페어를 조작합니다.</p>
          </div>
        </div>
        <div className="tool-card">
          <strong>현재 선택</strong>
          <span>{selectionTitle}</span>
          {!readonly && (
            <div className="selection-actions">
              <button onClick={() => selectRole("groupA")}>A 선택</button>
              <button onClick={() => selectRole("groupB")}>B 선택</button>
              <button onClick={() => alignSelection("x")} disabled={selectedPerformerIds.length < 2}>세로 정렬</button>
              <button onClick={() => alignSelection("y")} disabled={selectedPerformerIds.length < 2}>가로 정렬</button>
            </div>
          )}
          {selectedPair ? (
            <div className="selection-actions">
              <em>빈 무대 클릭: 1회 이동 / 다시 클릭: 선택 해제</em>
              <em>페어 토큰이나 선을 드래그하면 함께 이동</em>
              <em>한 명만 조정: 길게 누른 뒤 드래그</em>
              {!readonly && <button className="danger-button compact-danger" onClick={() => removePairByKey(selectedPairKey)}>페어 해제</button>}
            </div>
          ) : selectedPerformer ? (
            <p className="muted">빈 무대 클릭: 1회 이동 / 다시 클릭: 선택 해제</p>
          ) : (
            <p className="muted">토큰이나 페어를 선택하세요.</p>
          )}
          {!readonly && <button className="danger-button compact-danger" onClick={resetSelectedFormation}>대형 초기화</button>}
        </div>
        <div className="partner-box">
          <div className="panel-head">
            <h3>페어</h3>
            {!readonly && <button onClick={addPair}>직접 페어 추가</button>}
          </div>
          {(partnerSet?.pairs || []).map((pair, index) => (
            <div
              className={selectedPairKey === pairKey(pair) ? "pair-row active" : "pair-row"}
              key={index}
              onClick={() => applySelectionClick(resolveSelectionClick({ selectedPerformerId, selectedPairKey, pairKey: pairKey(pair) }))}
            >
              <select disabled={readonly} value={pair[0]} onChange={(event) => updatePair(index, 0, event.target.value)}>
                {plan.performers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span>-</span>
              <select disabled={readonly} value={pair[1]} onChange={(event) => updatePair(index, 1, event.target.value)}>
                {plan.performers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          ))}
          {!(partnerSet?.pairs || []).length && <p className="muted">토큰을 다른 토큰 가까이 드래그해 파트너를 연결하세요.</p>}
        </div>
      </div>
    );
  }

  function renderSelectedFormationTools() {
    if (!selectedSection) return null;

    return (
      <div className="selected-formation-tools">
        <span>선택 대형</span>
        <strong>{selectedSection?.name || "대형 없음"}</strong>
        <div className={selectedMovementKeyframe ? "movement-edit-target keyframe" : "movement-edit-target"}>
          <span>무대 편집 대상</span>
          <strong>{stageEditTargetLabel}</strong>
          <em>{selectedMovementKeyframe ? "토큰 이동은 이 중간 위치에만 저장됩니다." : "토큰 이동은 도착 대형에 저장됩니다."}</em>
        </div>
        {!readonly && (
          <div className="selected-formation-tool-actions">
            <button onClick={duplicateSection}>복제</button>
            {selectedSectionIndex > 0 && <button onClick={addMovementKeyframeAtCurrentTime} disabled={!canAddMovementKeyframe}>키프레임</button>}
            {selectedMovementKeyframeId && <button onClick={() => setSelectedMovementKeyframeId("")}>도착 대형 편집</button>}
            {selectedMovementKeyframeId && <button onClick={deleteSelectedMovementKeyframe}>키프레임 삭제</button>}
            <button className="danger-button compact-danger" onClick={deleteSection} disabled={sortedSections.length <= 1} title={sortedSections.length <= 1 ? "마지막 대형은 삭제할 수 없습니다." : "선택 대형 삭제"}>삭제</button>
            <button className="danger-button compact-danger" onClick={resetSelectedFormation}>대형 초기화</button>
          </div>
        )}
      </div>
    );
  }

  function renderPerformersPanel() {
    return (
      <div className="form-stack">
        <h2>출연자 / 앞줄 노출</h2>
        <div className="performer-grid">
          {plan.performers.map((performer) => {
            const count = counts[performer.id] || 0;
            return (
              <div
                key={performer.id}
                className={selectedPerformerId === performer.id ? "performer active" : "performer"}
                onClick={() => applySelectionClick(resolveSelectionClick({ selectedPerformerId, selectedPairKey, performerId: performer.id }))}
              >
                <span style={{ background: performer.color }}>{performer.label}</span>
                <input readOnly={readonly} value={performer.name} onChange={(event) => updatePlan((current) => ({
                  ...current,
                  performers: current.performers.map((p) => p.id === performer.id ? { ...p, name: event.target.value } : p)
                }))} />
                <em className={count === 0 ? "danger" : count > 1 ? "good" : "ok"}>{count}회</em>
              </div>
            );
          })}
        </div>
        <h2>개인 경로</h2>
        {selectedPerformerId ? (
          <ol className="path-list">
            {sortedSections.map((section) => {
              const performer = plan.performers.find((p) => p.id === selectedPerformerId);
              const pos = section.positions?.[selectedPerformerId];
              return <li key={section.id}><strong>{section.name}</strong> {performer?.name}: x {pos?.x.toFixed(0)}, y {pos?.y.toFixed(0)} / 도착 {formatTime(pointTime(section))}</li>;
            })}
          </ol>
        ) : <p className="muted">토큰을 클릭하면 그 사람의 이동 흐름만 따로 볼 수 있습니다.</p>}
      </div>
    );
  }

  function renderSharePanel() {
    return (
      <div className="share-panel">
        <div className="share-hero">
          <div>
            <h2>공유 / 출력</h2>
            <p>보기 링크는 리뷰 전용입니다. 편집 링크는 링크를 받은 사람이 수정하고 다시 저장할 수 있습니다.</p>
          </div>
          {!readonly && <button className="primary" onClick={shareProject} disabled={!canCreateViewLink && !plan.shareLinks?.view?.projectId}>편집 링크 만들기</button>}
        </div>

        <div className="share-link-grid">
          <div className={shareUrl ? "share-link-box" : "share-link-box muted"}>
            <div className="share-link-heading">
              <strong>보기 링크</strong>
              <span>{viewLinkState}</span>
            </div>
            <p>리뷰와 재생만 허용합니다. 대형, 음악, 출력 상태를 확인하는 용도입니다.</p>
            <div className="share-link-row">
              {shareUrl ? <a href={shareUrl}>열기</a> : <span>저장하면 자동 생성됩니다.</span>}
              {shareUrl && <button onClick={copyShareUrl}>복사</button>}
              {canManageLinks && shareUrl && <button onClick={() => setShareLinkEnabled(LINK_TYPES.view, !plan.shareLinks?.view?.enabled)}>{plan.shareLinks?.view?.enabled === false ? "켜기" : "끄기"}</button>}
            </div>
          </div>
          {!readonly && (
            <div className={editShareUrl ? "share-link-box edit-link-box" : "share-link-box muted"}>
              <div className="share-link-heading">
                <strong>편집 링크</strong>
                <span>{editLinkState}</span>
              </div>
              <p>받은 사람이 편집 화면으로 들어와 수정하고 저장할 수 있습니다. 신뢰하는 사람에게만 보냅니다.</p>
              <div className="share-link-row">
                {editShareUrl ? <a href={editShareUrl}>열기</a> : <span>편집 링크 만들기로 생성합니다.</span>}
                {editShareUrl && <button onClick={copyEditShareUrl}>복사</button>}
                {canManageLinks && editShareUrl && <button onClick={() => setShareLinkEnabled(LINK_TYPES.edit, !plan.shareLinks?.edit?.enabled)}>{plan.shareLinks?.edit?.enabled === false ? "켜기" : "끄기"}</button>}
              </div>
            </div>
          )}
        </div>

        <div className="share-checklist">
          <strong>공유 전 확인</strong>
          <span className={frontZeroPerformers.length ? "check warn" : "check ok"}>
            앞줄 0회 {frontZeroPerformers.length ? frontZeroPerformers.map((p) => p.name || p.label).join(", ") : "없음"}
          </span>
          <span className={unnamedPerformers.length ? "check warn" : "check ok"}>
            이름 미입력 {unnamedPerformers.length ? `${unnamedPerformers.length}명` : "없음"}
          </span>
          <span className={plan.cloudProjectId ? "check ok" : "check neutral"}>클라우드 저장 {plan.cloudProjectId ? "완료" : "미저장"}</span>
          <span className={shareUrl ? "check ok" : "check neutral"}>View Link {shareUrl ? "생성됨" : "미생성"}</span>
          <span className={editShareUrl ? "check ok" : "check neutral"}>Edit Link {editShareUrl ? "생성됨" : canCreateEditLink ? "생성 가능" : "한도 확인 필요"}</span>
          <span className={signedInOwner ? "check ok" : currentAuth.userId ? "check neutral" : "check warn"}>
            계정 소유권 {signedInOwner ? "연결됨" : currentAuth.userId ? "저장 시 연결" : "로그인 필요"}
          </span>
          <span className={audioLoadFailed ? "check warn" : audioUrlSaved ? "check ok" : audioUploadStatus === "failed" ? "check warn" : "check neutral"}>
            {audioLoadFailed ? "음악 로드 실패" : audioUrlSaved ? "음악 URL 저장됨" : audioUploadStatus === "failed" ? "음악 업로드 실패" : "음악 미포함"}
          </span>
          <span className={hasPngBackup ? "check ok" : "check neutral"}>PNG/PDF 백업은 버튼으로 즉시 저장</span>
        </div>

        <div className="share-actions">
          {!readonly && <button onClick={saveProjectToCloud}>저장하기</button>}
          <button onClick={exportJson}>{readonly ? "JSON 내보내기" : "프로젝트 파일 공유"}</button>
          <button onClick={() => exportPng()} disabled={!canUseAdvancedExports}>현재 PNG</button>
          <button onClick={exportAllPng} disabled={!canUseAdvancedExports}>대형 PNG 전체 저장</button>
          <button onClick={() => window.print()} disabled={!canUseAdvancedExports}>인쇄/PDF</button>
        </div>

        <div className="backup-actions">
          {!readonly && <label className="file-button tertiary">저장한 프로젝트 열기<input type="file" accept="application/json" onChange={importJson} /></label>}
          <span>클라우드 저장이 실패해도 파일로 공유하거나 복원할 수 있습니다.</span>
        </div>

        <p className="muted">기본 저장은 Supabase 클라우드에 저장됩니다. 파일 공유가 필요하면 프로젝트 파일(.json), PNG, PDF로 내보낼 수 있으며, 음악은 public URL로 저장되어 링크를 아는 사람이 접근할 수 있습니다.</p>
      </div>
    );
  }

  function renderToolDrawerContent() {
    return (
      <>
        <div className="inspector-now">
          <span>현재 작업</span>
          <strong>{selectedSection?.name || activeSection?.name || "대형 없음"}</strong>
          <em>{formatTime(sliderTime)} · 도착 {selectedSection ? formatTime(pointTime(selectedSection)) : "0:00.0"} · 이동 시작 {selectedSection ? formatTime(pointMoveStart(selectedSection)) : "0:00.0"}</em>
          <em>{selectedStateText}</em>
          <em>{planLimitText}</em>
        </div>
        {renderSelectedFormationTools()}
        {renderArrangePanel()}
        {renderPerformersPanel()}
      </>
    );
  }

  const selectedPerformer = plan.performers.find((performer) => performer.id === selectedPerformerId);
  const localSaveLabel = shareId && !readonly
    ? "편집 링크 프로젝트 · 저장하기로 클라우드 반영"
    : readonly
      ? isEditLinkRoute ? "편집 링크 인증 필요" : "보기 전용"
      : localSavedAt
        ? `이 기기에 자동 저장됨 · ${formatClockTime(localSavedAt)}`
        : "이 기기에 자동 저장 준비됨";
  const selectedStateText = selectedPairKey
    ? "페어 선택됨"
    : selectedPerformer
      ? `${selectedPerformer.name || selectedPerformer.label} 선택됨`
      : "선택 없음";

  function renderStatusActions() {
    if (statusRecovery === "share" && status.includes("Supabase 저장 실패")) {
      return (
        <div className="status-actions">
          <button onClick={exportJson}>프로젝트 파일 공유</button>
          <button onClick={() => exportPng()} disabled={!canUseAdvancedExports}>현재 PNG</button>
          <button onClick={() => window.print()} disabled={!canUseAdvancedExports}>인쇄/PDF</button>
        </div>
      );
    }
    if (statusRecovery === "audio" && /음악|재생/.test(status)) {
      return (
        <div className="status-actions">
          <button onClick={reconnectServerAudio}>음악 다시 연결</button>
          <label className="file-button">
            다시 업로드
            <input type="file" accept="audio/*" onChange={handleAudioFile} disabled={audioUploadStatus === "uploading"} />
          </label>
        </div>
      );
    }
    return null;
  }

  return (
    <div className={isStageFocus ? "app stage-focus" : "app"}>
      {status && (
        <div className="status" role="status" aria-live="polite">
          <span>{status} {shareUrl && <a href={shareUrl}>{shareUrl}</a>}</span>
          {renderStatusActions()}
        </div>
      )}
      {readonly && (
        <div className="readonly-banner">
          <div>
            <strong>{shareRouteBlocked === "disabled-view-link" ? "비활성화된 View Link" : "보기 링크 · View Link"}</strong>
            <span>{shareRouteBlocked === "disabled-view-link" ? "소유자가 이 보기 링크를 꺼두었습니다. 편집 기능은 열리지 않습니다." : "공유된 Movemap 프로젝트를 리뷰 중입니다. 수정하려면 이 기기에 사본을 만드세요."}</span>
          </div>
          <div className="readonly-actions">
            <button onClick={saveEditableCopy}>사본으로 편집</button>
          </div>
        </div>
      )}

      <main className={isToolDrawerOpen ? "workspace tools-open" : "workspace"}>
        <section className="stage-area">
          <div className="stage-toolbar">
            <div className="stage-title-block">
              <input
                className="stage-title-input"
                value={plan.title}
                readOnly={readonly}
                aria-label="프로젝트명"
                onChange={(event) => updatePlan((current) => ({ ...current, title: event.target.value }))}
              />
              <div className="stage-meta">
                <strong>{activeSection?.name}</strong>
                <span>{formatTime(currentTime)} · 도착 {activeSection ? formatTime(pointTime(activeSection)) : "0:00.0"}</span>
                <span className="save-meta">{localSaveLabel}</span>
                <span className="music-meta">
                  {musicTitle && <span className="music-name" title={musicTitle}>{musicTitle}</span>}
                  {!readonly && audioLoadFailed ? (
                    <button className="inline-action" onClick={reconnectServerAudio}>{musicActionLabel}</button>
                  ) : !readonly ? (
                    <label className="inline-action file-button">
                      {musicActionLabel}
                      <input type="file" accept="audio/*" onChange={handleAudioFile} disabled={audioUploadStatus === "uploading"} />
                    </label>
                  ) : null}
                </span>
              </div>
            </div>
            <div className="stage-toolbar-actions">
              {!readonly && (
                currentAuth.userId ? (
                  <button onClick={signOutOwner} title={authLabel}>로그아웃</button>
                ) : (
                  <button onClick={signInOwner} disabled={authLoading}>Google 로그인</button>
                )
              )}
              {!readonly && <button className="primary" onClick={saveProjectToCloud}>저장하기</button>}
              {!readonly && (
                <div className="top-action-group">
                  <button onClick={() => setIsProjectMenuOpen((value) => !value)}>프로젝트</button>
                  {isProjectMenuOpen && renderProjectMenu()}
                </div>
              )}
              <div className="top-action-group">
                <button onClick={() => setIsShareMenuOpen((value) => !value)}>공유</button>
                {isShareMenuOpen && renderShareMenu()}
              </div>
              <button onClick={() => setIsToolDrawerOpen((value) => !value)}>
                {isToolDrawerOpen ? "도구 닫기" : "도구"}
              </button>
            </div>
          </div>
          {!readonly && <p className="stage-hint">{hasUsableAudio ? "음악을 재생하고 원하는 순간에 대형을 만드세요." : "음악 없이도 대형을 만들고 배치를 시작할 수 있습니다."}</p>}
          {activeTransitionWarnings.length > 0 && (
            <div className="transition-warning" role="status">
              먼 이동 주의: {activeTransitionWarnings.map((warning) => `${warning.name} ${warning.distance}`).join(", ")}
            </div>
          )}
          {activeOverlapWarnings.length > 0 && (
            <div className="transition-warning" role="status">
              겹침 주의(현재 대형 전체): {activeOverlapWarnings.map((warning) => `${warning.names.join(" / ")} ${warning.distance}`).join(", ")}
            </div>
          )}
          <div className="transition-review" aria-label="전환 리뷰">
            <div className="transition-review-head">
              <div>
                <strong>{sortedSections[selectedSectionIndex - 1]?.name || "시작"} → {selectedSection?.name || "대형"} → {sortedSections[selectedSectionIndex + 1]?.name || "끝"}</strong>
                <span>{selectedSection?.name || ""} · 도착 {selectedSection ? formatTime(pointTime(selectedSection)) : "0:00.0"} · 이동 {selectedSection ? pointMoveDuration(selectedSection) : 0}초</span>
              </div>
              <div className="segmented-control" aria-label="경로 필터">
                {transitionFilterButtons.map(([value, label]) => (
                  <button
                    key={value}
                    className={(value === "all" && showAllTransitionPaths) || (!showAllTransitionPaths && transitionPathFilter === value) ? "active" : ""}
                    onClick={() => {
                      if (value === "all") {
                        setShowAllTransitionPaths(true);
                        setTransitionPathFilter("auto");
                        return;
                      }
                      setShowAllTransitionPaths(false);
                      setTransitionPathFilter(value);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="transition-review-meta">
              <span>필터 {activeTransitionFilter.label}</span>
              <span>경로 {activeTransitionPaths.length}</span>
              <span>먼 이동 {activeTransitionWarnings.length}</span>
              <span>전체 겹침 {activeOverlapWarnings.length}</span>
            </div>
          </div>
          <div className="stage-frame">
            <div className="stage-corner-tools" aria-label="무대 도구">
              {!readonly && (
                <>
                  <button
                    className="icon-tool"
                    onClick={undoPlan}
                    disabled={!undoStack.length}
                    title="되돌리기"
                    aria-label="되돌리기"
                  >
                    ↶
                  </button>
                  <button
                    className="icon-tool"
                    onClick={redoPlan}
                    disabled={!redoStack.length}
                    title="다시 실행"
                    aria-label="다시 실행"
                  >
                    ↷
                  </button>
                </>
              )}
              <button
                className={snapEnabled ? "icon-tool active" : "icon-tool"}
                onClick={() => setSnapEnabled((value) => !value)}
                title={`격자 맞춤 ${snapEnabled ? "끄기" : "켜기"}`}
                aria-label={`격자 맞춤 ${snapEnabled ? "끄기" : "켜기"}`}
              >
                #
              </button>
              <button
                className={isStageFocus ? "icon-tool active" : "icon-tool"}
                onClick={() => setIsStageFocus((value) => !value)}
                title={isStageFocus ? "패널 보기" : "무대 크게 보기"}
                aria-label={isStageFocus ? "패널 보기" : "무대 크게 보기"}
              >
                {isStageFocus ? "↙" : "⛶"}
              </button>
              <button
                className={showAllTransitionPaths ? "icon-tool active" : "icon-tool"}
                onClick={() => setShowAllTransitionPaths((value) => !value)}
                title={showAllTransitionPaths ? "선택 경로 중심으로 보기" : "모든 이동 경로 보기"}
                aria-label={showAllTransitionPaths ? "선택 경로 중심으로 보기" : "모든 이동 경로 보기"}
              >
                경로
              </button>
              <button
                className={showStageReferences ? "icon-tool active" : "icon-tool"}
                onClick={() => setShowStageReferences((value) => !value)}
                title={showStageReferences ? "무대 기준선 숨기기" : "무대 기준선 보기"}
                aria-label={showStageReferences ? "무대 기준선 숨기기" : "무대 기준선 보기"}
              >
                기준
              </button>
              <button
                className={showStageReferenceLabels ? "icon-tool active" : "icon-tool"}
                onClick={() => setShowStageReferenceLabels((value) => !value)}
                disabled={!showStageReferences}
                title={showStageReferenceLabels ? "기준선 이름 숨기기" : "기준선 이름 보기"}
                aria-label={showStageReferenceLabels ? "기준선 이름 숨기기" : "기준선 이름 보기"}
              >
                이름
              </button>
            </div>
            <div className="stage-view-toggle segmented-control" aria-label="무대 보기 방식">
              <button className={stageViewMode === "2d" ? "active" : ""} onClick={() => setStageViewMode("2d")}>2D</button>
              <button className={stageViewMode === "3d" ? "active" : ""} onClick={() => setStageViewMode("3d")}>3D</button>
            </div>
            {stageViewMode === "3d" ? (
              <Stage3dPreview projection={stage3dProjection} />
            ) : (
            <svg
              ref={svgRef}
              className="stage"
              viewBox="0 0 100 100"
              onPointerMove={onStagePointerMove}
              onPointerUp={finishActiveDrag}
              onPointerCancel={clearDrag}
              onClick={handleStageTap}
            >
              <defs>
                <marker id="arrow-live" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
                  <path d="M0,0 L5,2.5 L0,5 Z" fill="#334155" />
                </marker>
              </defs>
              <rect x="0" y="0" width="100" height="100" rx="2" fill="#f8fafc" />
              <rect x="0" y={plan.frontZone.y} width="100" height={100 - plan.frontZone.y} fill="#fee2e2" opacity="0.72" />
              <text x="50" y="96" textAnchor="middle" fontSize="3.5" fill="#991b1b" fontWeight="700">관객 방향 / 앞줄</text>
              <path d="M8 92 H92" stroke="#991b1b" strokeWidth="0.5" markerEnd="url(#arrow-live)" />
              <g stroke="#cbd5e1" strokeWidth="0.16">
                {GRID_X.map((x) => <line key={`grid-x-${x}`} x1={x} y1="0" x2={x} y2="100" />)}
                {GRID_Y.map((y) => <line key={`grid-y-${y}`} x1="0" y1={y} x2="100" y2={y} />)}
              </g>
              <g className="grid-points">
                {GRID_X.flatMap((x) => GRID_Y.map((y) => (
                  <circle key={`${x}-${y}`} cx={x} cy={y} r="0.55" />
                )))}
              </g>
              <g className="stage-reference-layer" aria-hidden="true">
                {stageReferenceItems.map((reference) => reference.type === "point" ? (
                  <g key={reference.id}>
                    <circle cx={reference.x} cy={reference.y} r="1.35" fill={reference.style.fill} opacity="0.52" />
                    {reference.showLabel && (
                      <text x={reference.x} y={reference.y - 2.4} textAnchor="middle" fontSize="2.8" fill={reference.style.fill} fontWeight="700">{reference.label}</text>
                    )}
                  </g>
                ) : (
                  <g key={reference.id}>
                    <line x1={reference.x1} y1={reference.y1} x2={reference.x2} y2={reference.y2} stroke={reference.style.stroke} strokeWidth="0.42" strokeDasharray={reference.style.dash} opacity="0.54" />
                    {reference.showLabel && (
                      <text x={(reference.x1 + reference.x2) / 2} y={Math.max(5, (reference.y1 + reference.y2) / 2 - 1.8)} textAnchor="middle" fontSize="2.6" fill={reference.style.fill} fontWeight="700">{reference.label}</text>
                    )}
                  </g>
                ))}
              </g>
              {formationPreview && (
                <g className="formation-preview-layer" aria-hidden="true">
                  {plan.performers.map((performer) => {
                    const pos = formationPreview.positions?.[performer.id];
                    if (!pos) return null;
                    return (
                      <g key={`preview-${performer.id}`}>
                        <circle cx={pos.x} cy={pos.y} r="3.1" fill="none" stroke={performer.color} strokeWidth="1.05" strokeDasharray="1.6 1.2" opacity="0.86" />
                        <text x={pos.x} y={pos.y + 1.05} textAnchor="middle" fontSize="2.7" fill={performer.color} fontWeight="700">{tokenShortName(performer)}</text>
                      </g>
                    );
                  })}
                </g>
              )}
              {sortedSections[activeSectionIndex - 1] && plan.performers.map((performer) => {
                const pos = sortedSections[activeSectionIndex - 1].positions?.[performer.id];
                if (!pos) return null;
                return <circle key={`ghost-${performer.id}`} cx={pos.x} cy={pos.y} r="2.5" fill="#475569" opacity="0.2" />;
              })}
              {buildTransitionPaths({
                performers: plan.performers,
                previousSection: sortedSections[activeSectionIndex - 1],
                currentSection: activeSection,
                nextSection: sortedSections[activeSectionIndex + 1],
                selectedPerformerId,
                selectedPair: selectedPair || [],
                filter: activeTransitionFilter.filter,
                role: activeTransitionFilter.role
              }).map((path) => {
                const performer = plan.performers.find((item) => item.id === path.performerId);
                const style = transitionPathStyle({ performer, selectedPerformerId, focusedPerformerIds: activeFocusedPerformerIds });
                const dash = path.context === "next" ? "1.6 1.2" : "";
                return <line key={`arrow-${path.context}-${path.performerId}`} x1={path.from.x} y1={path.from.y} x2={path.to.x} y2={path.to.y} stroke={style.stroke} strokeWidth={style.strokeWidth} opacity={style.opacity} strokeDasharray={dash} markerEnd="url(#arrow-live)" />;
              })}
              {(plan.partnerSets.find((set) => set.id === activeSection?.partnerSetId)?.pairs || []).map(([a, b], index) => {
                const from = visiblePositions[a];
                const to = visiblePositions[b];
                if (!from || !to) return null;
                const selected = selectedPairKey === pairKey([a, b]) || (magnetCandidateId && [a, b].includes(magnetCandidateId));
                const pair = [a, b];
                const bridgeColor = performerColorForPair(plan, pair);
                return (
                  <g
                    key={`pair-${index}`}
                    className="pair-link"
                    onPointerDown={(event) => onPairPointerDown(event, pair, index)}
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="transparent" strokeWidth="9" strokeLinecap="round" />
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#ffffff" strokeWidth={selected ? "5.4" : "4.8"} opacity="0.9" strokeLinecap="round" pointerEvents="none" />
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={selected ? "#b4234f" : bridgeColor} strokeWidth={selected ? "2.8" : "2.1"} opacity={selected ? "0.92" : "0.74"} strokeLinecap="round" pointerEvents="none" />
                  </g>
                );
              })}
              {magnetCandidateId && dragStateRef.current?.mode === "token-move" && (() => {
                const from = visiblePositions[dragStateRef.current.performerId] || selectedSection?.positions?.[dragStateRef.current.performerId];
                const to = visiblePositions[magnetCandidateId] || selectedSection?.positions?.[magnetCandidateId];
                if (!from || !to) return null;
                const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
                return (
                  <g className="magnet-preview">
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#b4234f" strokeWidth="0.9" strokeDasharray="2 1.4" />
                    <rect x={mid.x - 10} y={mid.y - 6.6} width="20" height="4.4" rx="1.3" fill="#b4234f" />
                    <text x={mid.x} y={mid.y - 3.5} textAnchor="middle" fontSize="2.2" fill="#fff" fontWeight="800" pointerEvents="none">{dragHint || "놓으면 연결"}</text>
                  </g>
                );
              })()}
              {plan.performers.map((performer) => {
                const pos = visiblePositions[performer.id] || selectedSection?.positions?.[performer.id];
                if (!pos) return null;
                const isMultiSelected = selectedPerformerIds.includes(performer.id);
                const dim = selectedPerformerId && selectedPerformerId !== performer.id && !isMultiSelected && magnetCandidateId !== performer.id;
                const isCandidate = magnetCandidateId === performer.id;
                const performerPair = pairForPerformer(partnerSet?.pairs || [], performer.id);
                const isSelectedPairMember = performerPair && selectedPairKey === pairKey(performerPair);
                const pairColor = performerPair ? performerColorForPair(plan, performerPair) : "";
                const shortName = tokenShortName(performer);
                const fullName = tokenName(performer);
                const fontSize = tokenFontSize(performer);
                return (
                  <g
                    key={performer.id}
                    className={readonly ? "token readonly" : "token"}
                    opacity={dim ? 0.35 : 1}
                    onPointerDown={(event) => onStagePointerDown(event, performer.id)}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (readonly) setSelectedPerformerId(performer.id);
                    }}
                  >
                    <title>{fullName}</title>
                    <circle cx={pos.x} cy={pos.y} r="7.4" fill="transparent" />
                    {(selectedPerformerId === performer.id || isMultiSelected || dragPositions?.[performer.id]) && <circle cx={pos.x} cy={pos.y} r="1.1" fill="#162033" opacity="0.45" pointerEvents="none" />}
                    {performerPair && <circle cx={pos.x} cy={pos.y} r={isSelectedPairMember ? SELECTED_PAIR_RING_RADIUS : PAIR_RING_RADIUS} fill="none" stroke={isSelectedPairMember ? "#b4234f" : pairColor} strokeWidth={isSelectedPairMember ? "0.85" : "0.65"} opacity={isSelectedPairMember ? "0.78" : "0.62"} pointerEvents="none" />}
                    {isCandidate && <circle cx={pos.x} cy={pos.y} r="7.1" fill="none" stroke="#b4234f" strokeWidth="1.1" strokeDasharray="1.5 1" />}
                    {(selectedPerformerId === performer.id || isMultiSelected) && <circle cx={pos.x} cy={pos.y} r={SELECTED_RING_RADIUS} fill="none" stroke="#162033" strokeWidth="0.7" pointerEvents="none" />}
                    <circle cx={pos.x} cy={pos.y} r={TOKEN_RADIUS} fill={performer.color} stroke="#f8fafc" strokeWidth="0.8" />
                    <text x={pos.x} y={pos.y + fontSize * 0.34} textAnchor="middle" fontSize={fontSize} fill="#fff" fontWeight="800" pointerEvents="none">{shortName}</text>
                  </g>
                );
              })}
            </svg>
            )}
          </div>
          <div className="timeline-editor" aria-label="대형 타임라인">
            <div className="timeline-controls">
              <button className="primary playback-button" onClick={togglePlayback} disabled={!hasUsableAudio}>
                {isPlaying ? "정지" : "재생"}
              </button>
              {!readonly && <button className="secondary capture-button" onClick={addSection}>대형 추가</button>}
              <span className="time-readout">{formatTime(sliderTime)} / {formatTime(timelineMax)}</span>
              <div className="timeline-zoom-controls" aria-label="타임라인 확대">
                <button type="button" onClick={() => setTimelinePixelsPerSecond((value) => clampValue(value * 0.82, 14, 160))}>-</button>
                <span>{Math.round(timelinePixelsPerSecond)}px/s</span>
                <button type="button" onClick={() => setTimelinePixelsPerSecond((value) => clampValue(value * 1.18, 14, 160))}>+</button>
              </div>
            </div>
            <div className="timeline-workbench">
              <div className="timeline-header-spacer" />
              <div
                ref={timelineViewportRef}
                className="timeline-viewport timeline-ruler-viewport"
                onWheel={onTimelineWheel}
                onPointerDown={onTimelineScrubPointerDown}
              >
                <div className="timeline-content" style={{ width: `${timelineContentWidth}px`, transform: `translateX(${-timelineScrollX}px)` }}>
                  {timelineTicks.map((tick) => (
                    <span
                      key={`${tick.time}-${tick.label}`}
                      className="timeline-tick"
                      style={{ left: `${tick.pixel}px` }}
                    >
                      {tick.label}
                    </span>
                  ))}
                  {snapPixel !== null && snapPixel >= 0 && snapPixel <= timelineViewportWidth && <span className="timeline-snapline" style={{ left: `${timelineSnapTime * timelinePixelsPerSecond}px` }} />}
                </div>
                {playheadPixel >= 0 && playheadPixel <= timelineViewportWidth && <span className="timeline-playhead" style={{ left: `${playheadPixel}px` }} />}
              </div>
              <span className="timeline-row-label">Forms</span>
              <div
                className="timeline-viewport timeline-lane"
                onWheel={onTimelineWheel}
                onPointerDown={onTimelineScrubPointerDown}
              >
                <div className="timeline-content" style={{ width: `${timelineContentWidth}px`, transform: `translateX(${-timelineScrollX}px)` }}>
                  {sortedSections.map((section, index) => {
                    const block = timelineFormationBlocks[index];
                    return (
                      <button
                        key={section.id}
                        className={[
                          "formation-block",
                          block.isMarker ? "marker" : "segment",
                          block.isTick ? "tick" : "",
                          section.id === selectedSection?.id ? "selected" : "",
                          section.id === sortedSections[timeSectionIndex]?.id ? "current" : "",
                          timelineBlockedEdge?.sectionId === section.id ? `blocked-${timelineBlockedEdge.edge}` : ""
                        ].filter(Boolean).join(" ")}
                        style={{
                          "--formation-left": `${block.leftPx}px`,
                          "--formation-logical-left": `${block.logicalLeftPx}px`,
                          "--formation-width": `${block.widthPx}px`,
                          "--formation-hit-width": `${block.hitWidthPx}px`,
                          "--formation-arrival": `${block.arrivalPx}px`
                        }}
                        onPointerDown={(event) => onFormationPointerDown(event, section, index, "body")}
                        onClick={(event) => {
                          if (ignoreNextFormationClickRef.current) {
                            ignoreNextFormationClickRef.current = false;
                            event.preventDefault();
                          }
                        }}
                        title={`${section.name} / ${formatTime(block.displayStartTime)} - ${formatTime(block.displayEndTime)}`}
                      >
                        {!readonly && !block.isMarker && index > 0 && section.id === selectedSection?.id && (
                          <span
                            className="formation-resize-handle left"
                            onPointerDown={(event) => onFormationPointerDown(event, section, index, "left")}
                            aria-hidden="true"
                          />
                        )}
                        <span className="formation-block-index">{formationTimelineLabel(index)}</span>
                        <strong>{section.name}</strong>
                        <em>{formatTime(block.displayStartTime)} - {formatTime(block.displayEndTime)}</em>
                        {index > 0 && !block.isMarker && section.id === selectedSection?.id && normalizeMovementKeyframes(section.movementKeyframes).map((keyframe) => (
                          <span
                            key={keyframe.id}
                            className={keyframe.id === selectedMovementKeyframeId ? "movement-keyframe-tick selected" : "movement-keyframe-tick"}
                            style={{ left: `${keyframe.t * 100}%` }}
                            title={`이동 keyframe ${formatTime(movementKeyframeTime(section, keyframe))}`}
                            onPointerDown={(event) => onMovementKeyframePointerDown(event, section, keyframe)}
                            aria-label={`이동 keyframe ${formatTime(movementKeyframeTime(section, keyframe))}`}
                          />
                        ))}
                        {!readonly && !block.isMarker && section.id === selectedSection?.id && (
                          <span
                            className="formation-resize-handle right"
                            onPointerDown={(event) => onFormationPointerDown(event, section, index, "right")}
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    );
                  })}
                  {timelineReorderGuide && (
                    <>
                      <span
                        className={timelineReorderGuide.isEndSlot ? "timeline-reorder-slot end" : "timeline-reorder-slot"}
                        style={{ left: `${timelineReorderGuide.leftPx}px` }}
                      />
                      <span
                        className={timelineReorderGuide.isEndSlot ? "timeline-reorder-preview end" : "timeline-reorder-preview"}
                        style={{ left: `${timelineReorderGuide.leftPx}px` }}
                      >
                        <span className="timeline-reorder-label">{timelineReorderGuide.slotLabel}</span>
                      </span>
                    </>
                  )}
                  {snapPixel !== null && snapPixel >= 0 && snapPixel <= timelineViewportWidth && <span className="timeline-snapline" style={{ left: `${timelineSnapTime * timelinePixelsPerSecond}px` }} />}
                </div>
                {playheadPixel >= 0 && playheadPixel <= timelineViewportWidth && <span className="timeline-playhead" style={{ left: `${playheadPixel}px` }} />}
              </div>
              <span className="timeline-row-label">Audio</span>
              <div
                className="timeline-viewport timeline-lane audio-lane"
                onWheel={onTimelineWheel}
                onPointerDown={onTimelineScrubPointerDown}
              >
                <div className="timeline-content" style={{ width: `${timelineContentWidth}px`, transform: `translateX(${-timelineScrollX}px)` }}>
                  {hasUsableAudio ? (
                    <div className="audio-waveform" aria-hidden="true">
                      {waveformBars.map((bar, index) => (
                        <span
                          key={index}
                          className="audio-bar"
                          style={{ height: `${Math.round(bar * 100)}%` }}
                        />
                      ))}
                    </div>
                  ) : (
                    <span className="time-track-placeholder">음악 없음</span>
                  )}
                </div>
                {playheadPixel >= 0 && playheadPixel <= timelineViewportWidth && <span className="timeline-playhead" style={{ left: `${playheadPixel}px` }} />}
              </div>
            </div>
            <audio
              ref={audioRef}
              src={audioSrc || undefined}
              onLoadedMetadata={syncAudioTime}
              onDurationChange={syncAudioTime}
              onTimeUpdate={syncAudioTime}
              onSeeking={syncAudioTime}
              onSeeked={syncAudioTime}
              onPlay={() => {
                setIsPlaying(true);
                syncAudioTime();
              }}
              onPause={() => {
                setIsPlaying(false);
                syncAudioTime();
              }}
              onEnded={() => {
                setIsPlaying(false);
                syncAudioTime();
              }}
              onError={() => {
                rejectedAudioUrlsRef.current.add(audioSrc);
                const fallbackUrl = nextAudioSourceCandidate(plan.audio, supabaseConfig(), [...rejectedAudioUrlsRef.current]);
                if (fallbackUrl) {
                  setAudioSrc(fallbackUrl);
                  setAudioUploadStatus("uploaded");
                  setStatus("저장된 Storage 경로로 음악을 다시 연결합니다.");
                  setStatusRecovery("");
                  return;
                }
                setAudioUploadStatus(plan.audio?.storagePath || plan.audio?.publicUrl ? "failed" : "idle");
                setStatusRecovery("audio");
                setStatus("음악 URL을 불러오지 못했습니다. 다시 음악을 불러오세요.");
              }}
            />
          </div>
          {selectedSection && (
            <div className="selected-formation-bar">
              <label className="compact-name">
                <span>선택 대형</span>
                <input readOnly={readonly} value={selectedSection.name} onChange={(event) => updateSection(selectedSection.id, { name: event.target.value })} />
              </label>
              <div className="arrival-time-control">
                <span>도착 시각</span>
                <strong>{formatTime(pointTime(selectedSection))}</strong>
              </div>
              <div className="movement-duration-control">
                <span>이동 시작</span>
                <strong>{formatTime(pointMoveStart(selectedSection))}</strong>
              </div>
              <div className="movement-duration-control">
                <span>이동 시간</span>
                <strong>{pointMoveDuration(selectedSection)}초 · 도착 전부터 이동</strong>
              </div>
              <div className={selectedMovementKeyframe ? "movement-edit-status keyframe" : "movement-edit-status"}>
                <span>무대 편집</span>
                <strong>{stageEditTargetLabel}</strong>
              </div>
            </div>
          )}
        </section>

        {isToolDrawerOpen && (
          <aside className="tool-drawer">
            <div className="drawer-head">
              <strong>도구</strong>
              <button onClick={() => setIsToolDrawerOpen(false)}>닫기</button>
            </div>
            <div className="inspector-panel">
              {renderToolDrawerContent()}
            </div>
          </aside>
        )}
      </main>

      <section className="mobile-editor">
        {!readonly && (
          <div className="mobile-action-bar" aria-label="모바일 편집 도구">
            <button onClick={() => setIsToolDrawerOpen((value) => !value)}>선택</button>
            <button onClick={addSection}>추가</button>
            <button onClick={duplicateSection} disabled={!selectedSection}>복제</button>
            <button onClick={deleteSection} disabled={sortedSections.length <= 1}>삭제</button>
            <button onClick={undoPlan} disabled={!undoStack.length}>되돌리기</button>
            <button onClick={shareProject}>공유</button>
          </div>
        )}
        {isToolDrawerOpen && (
          <div className={isBottomSheetExpanded ? "mobile-bottom-sheet expanded" : "mobile-bottom-sheet"}>
            <div className="bottom-sheet-head">
              <strong>도구</strong>
              <div className="row-actions">
                <button onClick={() => setIsBottomSheetExpanded((value) => !value)}>{isBottomSheetExpanded ? "축소" : "확장"}</button>
                <button onClick={() => setIsToolDrawerOpen(false)}>닫기</button>
              </div>
            </div>
            <div className="mobile-panel">
              {renderToolDrawerContent()}
            </div>
          </div>
        )}
      </section>

      <section className="print-sheets">
        {sortedSections.map((section, index) => (
          <article key={section.id}>
            <div className="print-meta">
              <h2>{index + 1}. {section.name}</h2>
              <p>도착 {formatTime(pointTime(section))} · 이동 {pointMoveDuration(section)}초</p>
              {section.notes && <p>{section.notes}</p>}
            </div>
            <div dangerouslySetInnerHTML={{ __html: buildStageSvg({ ...plan, sections: sortedSections }, index, { readonly: true }) }} />
          </article>
        ))}
      </section>
    </div>
  );
}

export default App;
