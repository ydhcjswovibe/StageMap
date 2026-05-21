import React, { useEffect, useMemo, useRef, useState } from "react";
import { resolveDropAction } from "./dragPolicy.mjs";
import { createProjectJsonDownload } from "./projectJson.mjs";

const STORAGE_KEY = "choreo-stage-planner-project";
const AUDIO_BUCKET = "choreo-audio";
const STAGE_WIDTH = 900;
const STAGE_HEIGHT = 560;
const ROLE_COLORS = {
  male: ["#2457c5", "#3478f6", "#3b82f6", "#60a5fa", "#1d4ed8"],
  female: ["#c0265f", "#e84a7f", "#f9739a", "#fb7185", "#be185d"],
  other: ["#6d5dfc", "#14b8a6", "#f59e0b", "#64748b"]
};

const PERFORMANCE_TYPES = {
  shine: "샤인공연",
  couple: "커플공연",
  mixed: "혼합공연"
};

const MOBILE_TABS = [
  ["formations", "대형"],
  ["arrange", "배치"],
  ["performers", "출연자"],
  ["share", "공유"]
];

const MOVE_MODES = {
  hold: "고정",
  smooth: "부드럽게 이동",
  late: "늦게 이동"
};
const HISTORY_LIMIT = 50;
const MAGNET_DISTANCE = 4.8;
const TOKEN_RADIUS = 4.2;
const SELECTED_RING_RADIUS = 5.35;
const COUPLE_GAP = 8.8;
const COUPLE_PULL_OUT_DISTANCE = 6.4;
const GRID_X = [14.8, 23.6, 32.4, 41.2, 50, 58.8, 67.6, 76.4, 85.2];
const GRID_Y = [10.8, 19.6, 28.4, 37.2, 46, 54.8, 63.6, 72.4, 81.2, 90];

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function formatTime(seconds = 0) {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${mins}:${String(secs).padStart(2, "0")}.${tenths}`;
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

function audioPublicUrl(storagePath) {
  const { url } = supabaseConfig();
  if (!url || !storagePath) return "";
  return `${url}/storage/v1/object/public/${AUDIO_BUCKET}/${encodeURI(storagePath)}`;
}

function resolveAudioUrl(audio) {
  if (!audio) return "";
  return audio.publicUrl || audioPublicUrl(audio.storagePath);
}

function audioUrlCandidates(audio) {
  if (!audio) return [];
  return [audio.publicUrl, audioPublicUrl(audio.storagePath)].filter(Boolean).filter((url, index, urls) => urls.indexOf(url) === index);
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
    publicUrl: audioPublicUrl(storagePath),
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

function horizontalCouplePositions(plan, firstId, secondId, center) {
  const first = plan.performers.find((performer) => performer.id === firstId);
  const second = plan.performers.find((performer) => performer.id === secondId);
  let leftId = firstId;
  let rightId = secondId;
  if (first?.role === "female" && second?.role === "male") {
    leftId = secondId;
    rightId = firstId;
  }
  const half = COUPLE_GAP / 2;
  const safeCenter = {
    x: clamp(center.x, 4 + half, 96 - half),
    y: clamp(center.y, 5, 95)
  };
  return {
    [leftId]: { x: safeCenter.x - half, y: safeCenter.y },
    [rightId]: { x: safeCenter.x + half, y: safeCenter.y }
  };
}

function pointTime(point) {
  return Number.isFinite(Number(point.time)) ? Number(point.time) : Number(point.end) || 0;
}

function pointMoveDuration(point) {
  if (Number.isFinite(Number(point.moveDuration))) return Math.max(0, Number(point.moveDuration));
  if (point.moveMode === "hold") return 0;
  return Math.max(0, (Number(point.end) || 0) - (Number(point.start) || 0));
}

function pointMoveStart(point) {
  return Math.max(0, pointTime(point) - pointMoveDuration(point));
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
    moveMode: section.moveMode || "smooth"
  };
}

function normalizePlan(plan) {
  if (!plan?.sections) return plan;
  return {
    ...plan,
    localProjectId: plan.localProjectId || uid("project"),
    sections: plan.sections.map(normalizeSection).sort((a, b) => pointTime(a) - pointTime(b))
  };
}

function defaultSections(performers) {
  const firstPositions = {};
  const secondPositions = {};
  const count = Math.max(1, performers.length);
  performers.forEach((performer, index) => {
    const col = index % Math.ceil(count / 2);
    const row = Math.floor(index / Math.ceil(count / 2));
    firstPositions[performer.id] = {
      x: 18 + col * (64 / Math.max(1, Math.ceil(count / 2) - 1 || 1)),
      y: row === 0 ? 70 : 42
    };
    secondPositions[performer.id] = {
      x: 22 + ((count - 1 - index) % Math.ceil(count / 2)) * (56 / Math.max(1, Math.ceil(count / 2) - 1 || 1)),
      y: row === 0 ? 48 : 75
    };
  });

  return [
    {
      id: uid("sec"),
      name: "Intro",
      time: 0,
      moveDuration: 0,
      start: 0,
      end: 0,
      notes: "첫 대형을 잡고 관객에게 전체 인원을 보여줍니다.",
      moveMode: "hold",
      positions: firstPositions,
      frontFocus: performers.slice(0, Math.min(4, performers.length)).map((p) => p.id),
      partnerSetId: ""
    },
    {
      id: uid("sec"),
      name: "Change",
      time: 20,
      moveDuration: 6,
      start: 14,
      end: 20,
      notes: "다음 대형으로 이동합니다. 필요한 사람은 중앙을 지나가게 배치하세요.",
      moveMode: "smooth",
      positions: secondPositions,
      frontFocus: performers.slice(-Math.min(4, performers.length)).map((p) => p.id),
      partnerSetId: ""
    }
  ];
}

function createProject({ title, performanceType, maleCount, femaleCount, names }) {
  const performers = [];
  for (let i = 0; i < maleCount; i += 1) {
    performers.push({
      id: uid("m"),
      label: `M${i + 1}`,
      name: names?.male?.[i] || `M${i + 1}`,
      role: "male",
      color: ROLE_COLORS.male[i % ROLE_COLORS.male.length]
    });
  }
  for (let i = 0; i < femaleCount; i += 1) {
    performers.push({
      id: uid("w"),
      label: `W${i + 1}`,
      name: names?.female?.[i] || `W${i + 1}`,
      role: "female",
      color: ROLE_COLORS.female[i % ROLE_COLORS.female.length]
    });
  }

  return {
    title: title || "새 안무 프로젝트",
    performanceType,
    performers,
    sections: defaultSections(performers),
    partnerSets: [],
    stage: { width: 100, height: 100 },
    frontZone: { y: 70 },
    localProjectId: uid("project"),
    updatedAt: new Date().toISOString()
  };
}

function createSampleProject() {
  const project = createProject({
    title: "Yiyo Sarante - Que Agonia 연습안",
    performanceType: "mixed",
    maleCount: 4,
    femaleCount: 4,
    names: {
      male: ["M1", "M2", "M3", "M4"],
      female: ["W1", "W2", "W3", "W4"]
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
    notes: "포즈. 여자 라인을 앞쪽에 두고 남자는 뒤에서 프레임.",
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
    notes: "기존 파트너워크 느낌. 대형 변화는 크게 만들지 않음.",
    moveMode: "late",
    positions: b.positions
  };
  project.sections = [
    { ...a, name: "A", time: 0, moveDuration: 0, start: 0, end: 0, notes: "넓게 시작하는 샤인/위치 잡기.", moveMode: "hold" },
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
      notes: "중앙으로 모이며 체인지. 여자 이동선을 크게 보여줌.",
      moveMode: "smooth"
    }
  ].sort((left, right) => pointTime(left) - pointTime(right));
  return project;
}

function isValidPlan(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.title === "string" &&
    Array.isArray(value.performers) &&
    Array.isArray(value.sections) &&
    value.sections.length > 0 &&
    value.sections.every((section) => section && section.positions && typeof section.positions === "object")
  );
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
  const positions = {};
  plan.performers.forEach((performer) => {
    const from = prev?.positions?.[performer.id] || section.positions[performer.id] || { x: 50, y: 50 };
    const to = section.positions[performer.id] || from;
    positions[performer.id] = interpolate(from, to, progress);
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

async function saveToSupabase(plan) {
  const { url, key } = supabaseConfig();
  if (!url || !key) throw new Error("Supabase 환경변수가 없습니다.");
  const response = await fetch(`${url}/rest/v1/choreo_projects`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({ title: plan.title, plan })
  });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  return data[0]?.id;
}

async function loadFromSupabase(id) {
  const { url, key } = supabaseConfig();
  if (!url || !key) throw new Error("Supabase 환경변수가 없습니다.");
  const response = await fetch(`${url}/rest/v1/choreo_projects?id=eq.${encodeURIComponent(id)}&select=*`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`
    }
  });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  if (!data[0]) throw new Error("공유 프로젝트를 찾을 수 없습니다.");
  return data[0].plan;
}

async function uploadAudioToSupabase(file, projectKey, fingerprint = audioFingerprint(file)) {
  const { url, key } = supabaseConfig();
  if (!url || !key) throw new Error("Supabase 환경변수가 없습니다.");
  const path = `projects/${safeStorageSegment(projectKey || "local", "project")}/audio/${audioStorageName(file, fingerprint)}`;
  const response = await fetch(`${url}/storage/v1/object/${AUDIO_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": file.type || "application/octet-stream"
    },
    body: file
  });
  if (!response.ok) {
    const errorText = await response.text();
    if ((response.status === 400 || response.status === 409) && /already exists|duplicate|exists/i.test(errorText)) {
      return audioMetadataFromFile(file, path, fingerprint);
    }
    throw new Error(errorText);
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
  const token = (performer, pos, ghost = false) => {
    const dim = selectedId && selectedId !== performer.id;
    const shortName = escapeSvgText(tokenShortName(performer));
    const fullName = escapeSvgText(tokenName(performer));
    const fontSize = tokenFontSize(performer);
    return `
      <g opacity="${ghost ? 0.22 : dim ? 0.35 : 1}">
        <title>${fullName}</title>
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
      return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#334155" stroke-width="0.55" opacity="0.55" />`;
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
      ${plan.performers.map((performer) => prev?.positions?.[performer.id] ? token(performer, prev.positions[performer.id], true) : "").join("")}
      ${arrows}
      ${pairLines}
      ${plan.performers.map((performer) => positions[performer.id] ? token(performer, positions[performer.id]) : "").join("")}
      <text x="4" y="7" font-size="4" fill="#0f172a" font-family="Arial" font-weight="700">${escapeSvgText(section?.name || "")} ${section ? `도착 ${formatTime(pointTime(section))} / 이동 ${pointMoveDuration(section)}초` : ""}</text>
      ${readonly ? `<text x="4" y="12" font-size="2.8" fill="#475569" font-family="Arial">${escapeSvgText(section?.notes || "")}</text>` : ""}
    </svg>`;
}

function Wizard({ onCreate }) {
  const [title, setTitle] = useState("새 안무 프로젝트");
  const [performanceType, setPerformanceType] = useState("mixed");
  const [maleCount, setMaleCount] = useState(4);
  const [femaleCount, setFemaleCount] = useState(4);
  const maleNames = Array.from({ length: maleCount }, (_, index) => `M${index + 1}`);
  const femaleNames = Array.from({ length: femaleCount }, (_, index) => `W${index + 1}`);

  return (
    <div className="wizard">
      <div className="wizard-card">
        <p className="eyebrow">Choreo Stage Planner</p>
        <h1>안무 대형을 만들고, 음악에 맞춰 움직임을 확인하세요.</h1>
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
            남자 수
            <input type="number" min="0" max="16" value={maleCount} onChange={(event) => setMaleCount(parseNumber(event.target.value, 0))} />
          </label>
          <label>
            여자 수
            <input type="number" min="0" max="16" value={femaleCount} onChange={(event) => setFemaleCount(parseNumber(event.target.value, 0))} />
          </label>
        </div>
        <div className="wizard-actions">
          <button className="primary" onClick={() => onCreate(createProject({ title, performanceType, maleCount, femaleCount, names: { male: maleNames, female: femaleNames } }))}>
            빈 프로젝트 시작
          </button>
          <button onClick={() => onCreate(createSampleProject())}>샘플로 시작</button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const shareId = window.location.pathname.startsWith("/share/") ? window.location.pathname.split("/share/")[1] : "";
  const readonly = Boolean(shareId);
  const [plan, setPlan] = useState(null);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [selectedPerformerId, setSelectedPerformerId] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioSrc, setAudioSrc] = useState("");
  const [audioUploadStatus, setAudioUploadStatus] = useState("idle");
  const [shareUrl, setShareUrl] = useState("");
  const [status, setStatus] = useState("");
  const [magnetCandidateId, setMagnetCandidateId] = useState("");
  const [dragHint, setDragHint] = useState("");
  const [selectedPairKey, setSelectedPairKey] = useState("");
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [dragPositions, setDragPositions] = useState(null);
  const [activeToolTab, setActiveToolTab] = useState("formations");
  const [isBottomSheetOpen, setIsBottomSheetOpen] = useState(false);
  const [isBottomSheetExpanded, setIsBottomSheetExpanded] = useState(false);
  const [isStageFocus, setIsStageFocus] = useState(false);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const audioRef = useRef(null);
  const svgRef = useRef(null);
  const dragStateRef = useRef(null);
  const ignoreNextStageTapRef = useRef(false);
  const longPressTimerRef = useRef(null);
  const localAudioUrlRef = useRef("");

  function restoreAudioFromPlan(nextPlan, options = {}) {
    const restoredAudioUrl = resolveAudioUrl(nextPlan?.audio);
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
    if (readonly) {
      loadFromSupabase(shareId)
        .then((loaded) => {
          const normalized = normalizePlan(loaded);
          setPlan(normalized);
          setSelectedSectionId(normalized.sections[0]?.id || "");
          restoreAudioFromPlan(normalized, { clearWhenMissing: true });
        })
        .catch((error) => setStatus(error.message));
      return;
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const loaded = JSON.parse(saved);
        if (isValidPlan(loaded)) {
          const normalized = normalizePlan(loaded);
          setPlan(normalized);
          setSelectedSectionId(normalized.sections[0]?.id || "");
          restoreAudioFromPlan(normalized, { clearWhenMissing: true });
        } else {
          localStorage.removeItem(STORAGE_KEY);
          setStatus("깨진 저장 데이터를 초기화했습니다. 새 프로젝트를 만들어 주세요.");
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        setStatus("읽을 수 없는 저장 데이터를 초기화했습니다. 새 프로젝트를 만들어 주세요.");
      }
    }
  }, [readonly, shareId]);

  useEffect(() => {
    if (!plan || readonly) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...plan, updatedAt: new Date().toISOString() }));
  }, [plan, readonly]);

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
  const selectedSection = sortedSections[selectedSectionIndex];
  const activeSection = sortedSections[activeSectionIndex];
  const counts = useMemo(() => plan ? exposureCounts({ ...plan, sections: sortedSections }) : {}, [plan, sortedSections]);
  const visiblePositions = useMemo(() => {
    const base = plan ? displayPositions({ ...plan, sections: sortedSections }, activeSectionIndex, currentTime, isPlaying) : {};
    return dragPositions ? { ...base, ...dragPositions } : base;
  }, [plan, sortedSections, activeSectionIndex, currentTime, isPlaying, dragPositions]);

  useEffect(() => {
    if (isPlaying && activeSection?.id) setSelectedSectionId(activeSection.id);
  }, [isPlaying, activeSection?.id]);

  function resetTransientEditState() {
    clearLongPressTimer();
    setMagnetCandidateId("");
    setDragHint("");
    setDragPositions(null);
    dragStateRef.current = null;
  }

  function normalizeSelectionForPlan(nextPlan) {
    const sections = nextPlan?.sections || [];
    if (!sections.length) {
      setSelectedSectionId("");
      setSelectedPerformerId("");
      setSelectedPairKey("");
      return;
    }
    if (!sections.some((section) => section.id === selectedSectionId)) {
      setSelectedSectionId(sections[0].id);
    }
    if (selectedPerformerId && !nextPlan.performers?.some((performer) => performer.id === selectedPerformerId)) {
      setSelectedPerformerId("");
    }
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

  function updateSection(sectionId, patch) {
    updatePlan((current) => ({
      ...current,
      sections: current.sections.map((section) => section.id === sectionId ? { ...section, ...patch } : section)
    }));
  }

  function updateSectionTiming(sectionId, time, moveDuration = null) {
    const safeTime = Math.max(0, Number(time) || 0);
    const nextMoveDuration = moveDuration === null
      ? pointMoveDuration(sortedSections.find((section) => section.id === sectionId) || {})
      : Math.max(0, Number(moveDuration) || 0);
    updateSection(sectionId, {
      time: safeTime,
      moveDuration: nextMoveDuration,
      start: Math.max(0, safeTime - nextMoveDuration),
      end: safeTime
    });
  }

  function nudgeSelectedSection(delta) {
    if (!selectedSection) return;
    updateSectionTiming(selectedSection.id, pointTime(selectedSection) + delta);
  }

  function setSelectedMoveDuration(moveDuration) {
    if (!selectedSection) return;
    updateSectionTiming(selectedSection.id, pointTime(selectedSection), moveDuration);
  }

  function syncSelectedSectionToCurrentTime() {
    if (!selectedSection) return;
    const nextTime = audioRef.current ? audioRef.current.currentTime || currentTime : currentTime;
    updateSectionTiming(selectedSection.id, nextTime);
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
    return pairs.find((pair) => pair.includes(performerId)) || null;
  }

  function performerById(performerId) {
    return plan.performers.find((performer) => performer.id === performerId);
  }

  function findIndependentMagnetCandidate(performerId, nextPosition, positions, pairs = []) {
    let nearest = null;
    plan.performers.forEach((performer) => {
      if (performer.id === performerId) return;
      if (pairs.some((pair) => pair.includes(performer.id))) return;
      const pos = positions?.[performer.id];
      if (!pos) return;
      const gap = distance(nextPosition, pos);
      if (gap <= MAGNET_DISTANCE && (!nearest || gap < nearest.gap)) {
        nearest = { id: performer.id, gap };
      }
    });
    return nearest?.id || "";
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
      const setId = section.partnerSetId || uid("partners");
      const existing = current.partnerSets.find((set) => set.id === setId);
      const baseSet = existing || { id: setId, name: `${section.name} 파트너`, pairs: [] };
      const pairs = [
        ...baseSet.pairs.filter((pair) => !pair.includes(firstId) && !pair.includes(secondId)),
        [firstId, secondId]
      ];
      const firstPosition = section.positions?.[firstId];
      const secondPosition = section.positions?.[secondId];
      const pairCenter = center || (firstPosition && secondPosition
        ? { x: (firstPosition.x + secondPosition.x) / 2, y: (firstPosition.y + secondPosition.y) / 2 }
        : firstPosition || secondPosition || { x: 50, y: 50 });
      const nextPositions = {
        ...section.positions,
        ...horizontalCouplePositions(current, firstId, secondId, snapPoint(pairCenter, snapEnabled))
      };
      return {
        ...current,
        partnerSets: existing
          ? current.partnerSets.map((set) => set.id === setId ? { ...set, pairs } : set)
          : [...current.partnerSets, { ...baseSet, pairs }],
        sections: current.sections.map((item) => item.id === sectionId ? { ...item, partnerSetId: setId, positions: nextPositions } : item)
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
      const basePositions = { ...section.positions, ...(action.positions || {}) };

      if (action.type === "connect-pair") {
        const setId = section.partnerSetId || uid("partners");
        const existing = current.partnerSets.find((set) => set.id === setId);
        const baseSet = existing || { id: setId, name: `${section.name} 파트너`, pairs: [] };
        const dragged = basePositions[action.performerId];
        const target = basePositions[action.targetId] || section.positions[action.targetId];
        const center = dragged && target
          ? snapPoint({ x: (dragged.x + target.x) / 2, y: (dragged.y + target.y) / 2 }, snapEnabled)
          : drag.pointer;
        const nextPositions = {
          ...basePositions,
          ...horizontalCouplePositions(current, action.performerId, action.targetId, center)
        };
        const pairs = [
          ...baseSet.pairs.filter((pair) => !pair.includes(action.performerId) && !pair.includes(action.targetId)),
          [action.performerId, action.targetId]
        ];
        return {
          ...current,
          partnerSets: existing
            ? current.partnerSets.map((set) => set.id === setId ? { ...set, pairs } : set)
            : [...current.partnerSets, { ...baseSet, pairs }],
          sections: current.sections.map((item) => item.id === drag.sectionId ? { ...item, partnerSetId: setId, positions: nextPositions } : item)
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
            sections: current.sections.map((item) => item.id === drag.sectionId ? { ...item, positions: basePositions } : item)
          };
        }
        const nextPairs = currentSet.pairs.map((pair, index) => {
          if (index === sourcePairIndex) return pair.map((id) => id === action.performerId ? action.targetId : id);
          if (index === targetPairIndex) return pair.map((id) => id === action.targetId ? action.performerId : id);
          return pair;
        });
        const centerForPair = (pair) => {
          const pairPositions = pair.map((id) => section.positions?.[id]).filter(Boolean);
          if (!pairPositions.length) return { x: 50, y: 50 };
          return {
            x: pairPositions.reduce((sum, pos) => sum + pos.x, 0) / pairPositions.length,
            y: pairPositions.reduce((sum, pos) => sum + pos.y, 0) / pairPositions.length
          };
        };
        const sourcePair = nextPairs[sourcePairIndex];
        const targetPair = nextPairs[targetPairIndex];
        const nextPositions = {
          ...basePositions,
          ...horizontalCouplePositions(current, sourcePair[0], sourcePair[1], centerForPair(currentSet.pairs[sourcePairIndex])),
          ...horizontalCouplePositions(current, targetPair[0], targetPair[1], centerForPair(currentSet.pairs[targetPairIndex]))
        };
        return {
          ...current,
          partnerSets: current.partnerSets.map((set) => {
            if (set.id !== setId) return set;
            return {
              ...set,
              pairs: nextPairs
            };
          }),
          sections: current.sections.map((item) => item.id === drag.sectionId ? { ...item, positions: nextPositions } : item)
        };
      }

      const sourcePairKey = action.sourcePair ? pairKey(action.sourcePair) : "";
      return {
        ...current,
        partnerSets: sourcePairKey && section.partnerSetId
          ? current.partnerSets.map((set) => set.id === section.partnerSetId
            ? { ...set, pairs: set.pairs.filter((pair) => pairKey(pair) !== sourcePairKey) }
            : set)
          : current.partnerSets,
        sections: current.sections.map((item) => item.id === drag.sectionId ? { ...item, positions: basePositions } : item)
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
      setStatus("커플을 해제하고 토큰을 이동했습니다.");
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
    const time = Math.max(0, captureTime);
    const prevIndex = Math.max(0, findSectionIndex(sortedSections, time));
    const previous = sortedSections[prevIndex] || sortedSections[sortedSections.length - 1];
    const positions = previous?.positions || Object.fromEntries(plan.performers.map((p, index) => [p.id, { x: 18 + index * 8, y: 55 }]));
    const gap = previous ? Math.max(0, time - pointTime(previous)) : 0;
    const moveDuration = previous ? Math.min(4, gap) : 0;
    const section = {
      id: uid("sec"),
      name: `대형 ${formatTime(time)}`,
      time,
      moveDuration,
      start: Math.max(0, time - moveDuration),
      end: time,
      notes: "음악을 들으며 현재 시각에 저장한 대형입니다.",
      moveMode: "smooth",
      positions: JSON.parse(JSON.stringify(positions)),
      frontFocus: [],
      partnerSetId: previous?.partnerSetId || ""
    };
    updatePlan((current) => ({ ...current, sections: [...current.sections, section] }));
    setSelectedSectionId(section.id);
    setStatus(`${formatTime(time)}에 대형 지점을 추가했습니다. 이제 무대에서 위치를 수정하세요.`);
  }

  function duplicateSection() {
    if (!selectedSection) return;
    const copiedPartnerSet = selectedSection.partnerSetId
      ? plan.partnerSets.find((set) => set.id === selectedSection.partnerSetId)
      : null;
    const copiedPartnerSetId = copiedPartnerSet ? uid("partners") : "";
    const playbackTime = audioRef.current ? audioRef.current.currentTime || currentTime : currentTime;
    const fallbackTime = pointTime(selectedSection) + 8;
    const time = playbackTime > 0 && Math.abs(playbackTime - pointTime(selectedSection)) > 0.2 ? playbackTime : fallbackTime;
    const moveDuration = pointMoveDuration(selectedSection);
    const section = {
      ...JSON.parse(JSON.stringify(selectedSection)),
      id: uid("sec"),
      name: `${selectedSection.name} 복사`,
      time,
      moveDuration,
      start: Math.max(0, time - moveDuration),
      end: time,
      partnerSetId: copiedPartnerSetId
    };
    updatePlan((current) => ({
      ...current,
      partnerSets: copiedPartnerSet
        ? [...current.partnerSets, { ...JSON.parse(JSON.stringify(copiedPartnerSet)), id: copiedPartnerSetId, name: `${section.name} 파트너` }]
        : current.partnerSets,
      sections: [...current.sections, section]
    }));
    setSelectedSectionId(section.id);
    setSelectedPairKey("");
  }

  function deleteSection() {
    if (!selectedSection || sortedSections.length <= 1) return;
    const nextSections = sortedSections.filter((section) => section.id !== selectedSection.id);
    updatePlan((current) => ({ ...current, sections: current.sections.filter((section) => section.id !== selectedSection.id) }));
    setSelectedSectionId(nextSections[0]?.id || "");
  }

  function resetSelectedFormation() {
    if (readonly || !selectedSection) return;
    const confirmed = window.confirm("선택한 대형의 토큰 위치와 커플 연결을 기본 배치로 초기화할까요?");
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
    captureStagePointer(event);
    setSelectedPerformerId(performerId);
    setSelectedPairKey("");
    setIsBottomSheetExpanded(false);
    const pointer = clientToStagePoint(event);
    const token = selectedSection.positions?.[performerId] || { x: pointer.x, y: pointer.y };
    const partnerSet = getPartnerSetForSection(selectedSection);
    const performerPair = pairForPerformer(partnerSet?.pairs || [], performerId);
    if (performerPair) {
      const [firstId, secondId] = performerPair;
      const wasSelectedPair = selectedPairKey === pairKey(performerPair);
      if (wasSelectedPair) {
        dragStateRef.current = {
          mode: "token-move",
          source: "selected-pair-member",
          performerId,
          sectionId: selectedSection.id,
          pointerId: event.pointerId,
          individual: true,
          sourcePair: [...performerPair],
          offsetX: token.x - pointer.x,
          offsetY: token.y - pointer.y,
          pointer,
          startPointer: pointer,
          moved: false,
          finalPositions: {
            [performerId]: token
          }
        };
        setSelectedPairKey("");
        setDragPositions({ [performerId]: token });
        setDragHint("드래그하면 커플 해제");
        return;
      }
      const firstStart = { ...(selectedSection.positions[firstId] || { x: pointer.x, y: pointer.y }) };
      const secondStart = { ...(selectedSection.positions[secondId] || { x: pointer.x, y: pointer.y }) };
      dragStateRef.current = {
        mode: "pair-move",
        source: "token",
        draggedPerformerId: performerId,
        canPullOutMember: wasSelectedPair,
        pair: [...performerPair],
        sectionId: selectedSection.id,
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
      setSelectedPairKey(pairKey(performerPair));
      setDragPositions(dragStateRef.current.finalPositions);
      clearLongPressTimer();
      return;
    }
    dragStateRef.current = {
      mode: "token-move",
      performerId,
      sectionId: selectedSection.id,
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
    if (!drag.canPullOutMember || drag.source !== "token" || !drag.draggedPerformerId) return false;
    const memberStart = drag.startPositions?.[drag.draggedPerformerId];
    const partnerId = drag.pair?.find((id) => id !== drag.draggedPerformerId);
    const partnerStart = partnerId ? drag.startPositions?.[partnerId] : null;
    if (!memberStart || !partnerStart) return false;
    const basePointer = drag.startPointer || drag.pointer;
    const currentMember = {
      x: memberStart.x + pointer.x - basePointer.x,
      y: memberStart.y + pointer.y - basePointer.y
    };
    return distance(currentMember, partnerStart) - distance(memberStart, partnerStart) >= COUPLE_PULL_OUT_DISTANCE;
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
    setDragHint("놓으면 커플 해제");
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
    const nextPositions = { ...selectedSection.positions, [performerId]: nextPosition };
    const swapCandidate = drag.individual && drag.sourcePair
      ? findSameRoleSwapCandidate(performerId, nextPosition, nextPositions, pairs)
      : null;
    const candidateId = swapCandidate?.targetId || findIndependentMagnetCandidate(performerId, nextPosition, nextPositions, pairs);
    drag.candidateId = candidateId;
    drag.swapCandidate = swapCandidate;
    drag.pointer = pointer;
    drag.finalPositions = { [performerId]: nextPosition };
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
    captureStagePointer(event);
    clearLongPressTimer();
    setIsBottomSheetExpanded(false);
    const pointer = clientToStagePoint(event);
    const [firstId, secondId] = pair;
    dragStateRef.current = {
      mode: "pair-move",
      pairIndex,
      pair: [...pair],
      sectionId: selectedSection.id,
      pointerId: event.pointerId,
      pointer,
      startPointer: pointer,
      moved: false,
      startPositions: {
        [firstId]: { ...selectedSection.positions[firstId] },
        [secondId]: { ...selectedSection.positions[secondId] }
      },
      finalPositions: {}
    };
    setDragPositions({
      [firstId]: { ...selectedSection.positions[firstId] },
      [secondId]: { ...selectedSection.positions[secondId] }
    });
    setSelectedPairKey(pairKey(pair));
  }

  function updatePairDrag(event, drag, pointer = clientToStagePoint(event)) {
    const [firstId, secondId] = drag.pair;
    const firstStart = drag.startPositions[firstId];
    const secondStart = drag.startPositions[secondId];
    if (!firstStart || !secondStart) return null;
    let dx = pointer.x - drag.pointer.x;
    let dy = pointer.y - drag.pointer.y;
    if (snapEnabled && !event.altKey) {
      const startCenter = {
        x: (firstStart.x + secondStart.x) / 2,
        y: (firstStart.y + secondStart.y) / 2
      };
      const targetCenter = snapPoint({ x: startCenter.x + dx, y: startCenter.y + dy }, true);
      dx = targetCenter.x - startCenter.x;
      dy = targetCenter.y - startCenter.y;
    }
    const minX = Math.min(firstStart.x, secondStart.x);
    const maxX = Math.max(firstStart.x, secondStart.x);
    const minY = Math.min(firstStart.y, secondStart.y);
    const maxY = Math.max(firstStart.y, secondStart.y);
    dx = clamp(dx, 4 - minX, 96 - maxX);
    dy = clamp(dy, 5 - minY, 95 - maxY);
    drag.finalPositions = {
      [firstId]: { x: firstStart.x + dx, y: firstStart.y + dy },
      [secondId]: { x: secondStart.x + dx, y: secondStart.y + dy }
    };
    setDragPositions(drag.finalPositions);
    setDragHint(drag.source === "token" ? "커플 이동 중" : "");
    return drag.finalPositions;
  }

  function positionsForPairCenter(pair, center) {
    const [firstId, secondId] = pair;
    const firstStart = selectedSection?.positions?.[firstId];
    const secondStart = selectedSection?.positions?.[secondId];
    if (!firstStart || !secondStart) return null;
    const startCenter = {
      x: (firstStart.x + secondStart.x) / 2,
      y: (firstStart.y + secondStart.y) / 2
    };
    let dx = center.x - startCenter.x;
    let dy = center.y - startCenter.y;
    const minX = Math.min(firstStart.x, secondStart.x);
    const maxX = Math.max(firstStart.x, secondStart.x);
    const minY = Math.min(firstStart.y, secondStart.y);
    const maxY = Math.max(firstStart.y, secondStart.y);
    dx = clamp(dx, 4 - minX, 96 - maxX);
    dy = clamp(dy, 5 - minY, 95 - maxY);
    return {
      [firstId]: { x: firstStart.x + dx, y: firstStart.y + dy },
      [secondId]: { x: secondStart.x + dx, y: secondStart.y + dy }
    };
  }

  function handleStageTap(event) {
    if (readonly || !selectedSection) return;
    if (ignoreNextStageTapRef.current) {
      ignoreNextStageTapRef.current = false;
      return;
    }
    if (dragStateRef.current) return;
    if (event.target.closest?.(".token, .pair-handle, .pair-link")) return;
    const pointer = clientToStagePoint(event);
    const targetPoint = snapPoint(pointer, snapEnabled);
    const partnerSet = getPartnerSetForSection(selectedSection);
    const selectedPair = (partnerSet?.pairs || []).find((pair) => pairKey(pair) === selectedPairKey)
      || (selectedPerformerId ? pairForPerformer(partnerSet?.pairs || [], selectedPerformerId) : null);

    if (selectedPair) {
      const finalPositions = positionsForPairCenter(selectedPair, targetPoint);
      if (!finalPositions) return;
      const drag = {
        mode: "pair-move",
        source: "tap",
        pair: [...selectedPair],
        sectionId: selectedSection.id,
        pointer: targetPoint,
        finalPositions
      };
      commitDropAction(resolveDropAction({ drag }), drag);
      setDragPositions(null);
      setSelectedPairKey(pairKey(selectedPair));
      return;
    }

    if (!selectedPerformerId) return;
    const nextPosition = {
      x: clamp(targetPoint.x, 4, 96),
      y: clamp(targetPoint.y, 5, 95)
    };
    const nextPositions = { ...selectedSection.positions, [selectedPerformerId]: nextPosition };
    const candidateId = findIndependentMagnetCandidate(selectedPerformerId, nextPosition, nextPositions, partnerSet?.pairs || []);
    const drag = {
      mode: "token-move",
      source: "tap",
      performerId: selectedPerformerId,
      sectionId: selectedSection.id,
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
  }

  async function handleAudioFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const fingerprint = audioFingerprint(file);
    const restoredAudioUrl = resolveAudioUrl(plan.audio);
    const replacingAudio = Boolean(restoredAudioUrl || audioSrc);
    if (restoredAudioUrl && audioMatchesFile(plan.audio, file, fingerprint)) {
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
      setAudioSrc(localUrl);
    }
    setAudioUploadStatus("uploading");
    setStatus(replacingAudio ? "새 음악으로 교체하는 중..." : "음악을 선택했습니다. 서버에 업로드하는 중...");
    try {
      const audio = await uploadAudioToSupabase(file, plan?.localProjectId || plan?.title || "project", fingerprint);
      updatePlan((current) => ({ ...current, audio }));
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
      if (!replacingAudio && localUrl) {
        setAudioSrc("");
        if (localAudioUrlRef.current) {
          URL.revokeObjectURL(localAudioUrlRef.current);
          localAudioUrlRef.current = "";
        }
      }
      setStatus(`${replacingAudio ? "음악 교체 실패" : "음악 업로드 실패"}: ${error.message}`);
      event.target.value = "";
    }
  }

  function reconnectServerAudio() {
    if (restoreAudioFromPlan(plan)) {
      setStatus("저장된 서버 음악을 다시 연결했습니다.");
    } else {
      setStatus("저장된 음악 URL이 없습니다. 음악을 다시 선택해 주세요.");
    }
  }

  function jumpTo(section) {
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
      } catch (error) {
        setStatus(`재생을 시작할 수 없습니다: ${error.message}`);
      }
    } else {
      audioRef.current.pause();
      setIsPlaying(false);
      syncAudioTime();
    }
  }

  async function shareProject() {
    try {
      setStatus("공유 링크를 만드는 중...");
      const id = await saveToSupabase(plan);
      const nextUrl = `${window.location.origin}/share/${id}`;
      setShareUrl(nextUrl);
      setStatus("공유 링크가 생성되었습니다.");
    } catch (error) {
      setStatus(`Supabase 저장 실패: ${error.message}. 안무 파일/PNG/PDF 백업을 사용하세요.`);
    }
  }

  function exportJson() {
    const { blob, filename } = createProjectJsonDownload(plan);
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
        if (!isValidPlan(loaded)) {
          setStatus("올바른 안무 파일이 아닙니다.");
          return;
        }
        const normalized = normalizePlan(loaded);
        setPlan(normalized);
        setSelectedSectionId(normalized.sections[0]?.id || "");
        setSelectedPerformerId("");
        setSelectedPairKey("");
        setUndoStack([]);
        setRedoStack([]);
        resetTransientEditState();
        const restored = restoreAudioFromPlan(normalized, { clearWhenMissing: true });
        setStatus(restored ? "저장한 안무와 서버 음악을 불러왔습니다." : "저장한 안무를 불러왔습니다.");
      } catch {
        setStatus("안무 파일을 읽을 수 없습니다.");
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
  const frontZeroPerformers = plan.performers.filter((performer) => (counts[performer.id] || 0) === 0);
  const unnamedPerformers = plan.performers.filter((performer) => !String(performer.name || "").trim());
  const hasPngBackup = false;
  const audioUrlSaved = Boolean(resolveAudioUrl(plan.audio));
  const audioLoadFailed = audioUploadStatus === "failed" && audioUrlSaved;
  const hasUsableAudio = Boolean(audioSrc && audioUploadStatus !== "failed");
  const musicActionLabel = audioUploadStatus === "uploading"
    ? audioUrlSaved || hasUsableAudio ? "교체 중..." : "업로드 중..."
    : audioLoadFailed ? "다시 연결" : audioUrlSaved || hasUsableAudio ? "교체" : "음악 업로드";
  const musicTitle = plan.audio?.fileName || (hasUsableAudio ? "선택한 음악" : "");

  function renderMobileTabs(extraClass = "") {
    return (
      <nav className={`mobile-tabs ${extraClass}`.trim()}>
        {MOBILE_TABS.map(([value, label]) => (
          <button
            key={value}
            className={activeToolTab === value ? "active" : ""}
            onClick={() => {
              setActiveToolTab(value);
              setIsBottomSheetOpen(true);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
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
          {!readonly && <button onClick={addSection}>{hasUsableAudio ? "현재 시간에 대형 만들기" : "대형 추가"}</button>}
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
        {!readonly && (
          <div className="row-actions">
            <button onClick={duplicateSection}>복제</button>
            <button onClick={deleteSection}>삭제</button>
          </div>
        )}

        {selectedSection ? (
          <>
            <label>지점명<input readOnly={readonly} value={selectedSection.name} onChange={(event) => updateSection(selectedSection.id, { name: event.target.value })} /></label>
            <div className="two-col">
              <label>도착 시각<input readOnly={readonly} type="number" step="0.1" value={pointTime(selectedSection)} onChange={(event) => {
                const time = parseNumber(event.target.value, pointTime(selectedSection));
                const moveDuration = pointMoveDuration(selectedSection);
                updateSection(selectedSection.id, { time, end: time, start: Math.max(0, time - moveDuration) });
              }} /></label>
              <label>이동 시간<input readOnly={readonly} type="number" min="0" step="0.1" value={pointMoveDuration(selectedSection)} onChange={(event) => {
                const moveDuration = Math.max(0, parseNumber(event.target.value, pointMoveDuration(selectedSection)));
                const time = pointTime(selectedSection);
                updateSection(selectedSection.id, { moveDuration, start: Math.max(0, time - moveDuration), end: time });
              }} /></label>
            </div>
            <p className="muted">이전 대형에서 이 지점까지 {pointMoveDuration(selectedSection)}초 동안 이동해 {formatTime(pointTime(selectedSection))}에 도착합니다.</p>
            <label>메모<textarea readOnly={readonly} value={selectedSection.notes} onChange={(event) => updateSection(selectedSection.id, { notes: event.target.value })} /></label>
          </>
        ) : <p className="muted">대형 지점을 선택하세요.</p>}
      </div>
    );
  }

  function renderArrangePanel() {
    const selectedPerformer = plan.performers.find((performer) => performer.id === selectedPerformerId);
    return (
      <div className="form-stack">
        <div className="panel-head">
          <div>
            <h2>배치</h2>
            <p className="muted">무대 위 토큰과 커플을 조작합니다.</p>
          </div>
        </div>
        <div className="tool-card">
          <strong>현재 선택</strong>
          <span>{dragHint || (selectedPerformer ? `${selectedPerformer.name || selectedPerformer.label} 토큰` : selectedPairKey ? "선택 커플" : "선택 없음")}</span>
          <p className="muted">토큰을 선택한 뒤 무대 빈 곳을 탭해도 이동합니다. 커플 토큰은 기본적으로 함께 이동합니다.</p>
          {!readonly && <button className="danger-button compact-danger" onClick={resetSelectedFormation}>대형 초기화</button>}
        </div>
        <div className="partner-box">
          <div className="panel-head">
            <h3>커플</h3>
            {!readonly && <button onClick={addPair}>직접 커플 추가</button>}
          </div>
          {selectedPairKey && !readonly && (
            <button className="danger-button" onClick={() => removePairByKey(selectedPairKey)}>선택 커플 해제</button>
          )}
          {(partnerSet?.pairs || []).map((pair, index) => (
            <div className={selectedPairKey === pairKey(pair) ? "pair-row active" : "pair-row"} key={index} onClick={() => setSelectedPairKey(pairKey(pair))}>
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

  function renderPerformersPanel() {
    return (
      <div className="form-stack">
        <h2>출연자 / 앞줄 노출</h2>
        <div className="performer-grid">
          {plan.performers.map((performer) => {
            const count = counts[performer.id] || 0;
            return (
              <div key={performer.id} className={selectedPerformerId === performer.id ? "performer active" : "performer"} onClick={() => setSelectedPerformerId(performer.id)}>
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
            <p>팀원에게 보낼 링크와 수업용 백업 파일을 여기서 준비합니다.</p>
          </div>
          {!readonly && <button className="primary" onClick={shareProject}>공유 링크 만들기</button>}
        </div>

        {shareUrl && (
          <div className="share-link-box">
            <span>보기 전용 링크</span>
            <a href={shareUrl}>{shareUrl}</a>
          </div>
        )}

        <div className="share-checklist">
          <strong>공유 전 확인</strong>
          <span className={frontZeroPerformers.length ? "check warn" : "check ok"}>
            앞줄 0회 {frontZeroPerformers.length ? frontZeroPerformers.map((p) => p.name || p.label).join(", ") : "없음"}
          </span>
          <span className={unnamedPerformers.length ? "check warn" : "check ok"}>
            이름 미입력 {unnamedPerformers.length ? `${unnamedPerformers.length}명` : "없음"}
          </span>
          <span className={shareUrl ? "check ok" : "check neutral"}>공유 링크 {shareUrl ? "생성됨" : "미생성"}</span>
          <span className={audioLoadFailed ? "check warn" : audioUrlSaved ? "check ok" : audioUploadStatus === "failed" ? "check warn" : "check neutral"}>
            {audioLoadFailed ? "음악 로드 실패" : audioUrlSaved ? "음악 URL 저장됨" : audioUploadStatus === "failed" ? "음악 업로드 실패" : "음악 미포함"}
          </span>
          <span className={hasPngBackup ? "check ok" : "check neutral"}>PNG/PDF 백업은 버튼으로 즉시 저장</span>
        </div>

        <div className="share-actions">
          <button onClick={() => exportPng()}>현재 PNG</button>
          <button onClick={exportAllPng}>대형 PNG 전체 저장</button>
          <button onClick={() => window.print()}>인쇄/PDF</button>
        </div>

        {!readonly && (
          <div className="backup-actions">
            <button className="tertiary" onClick={exportJson}>저장하기</button>
            <label className="file-button tertiary">저장한 안무 열기<input type="file" accept="application/json" onChange={importJson} /></label>
          </div>
        )}

        <p className="muted">공유 링크 저장이 실패하면 저장하기 또는 PNG/PDF로 대신 공유할 수 있습니다. 안무 파일은 .json 형식으로 저장되며, 음악은 public URL로 저장되어 링크를 아는 사람이 접근할 수 있습니다.</p>
      </div>
    );
  }

  function renderToolPanelContent() {
    if (activeToolTab === "formations") return renderFormationPanel();
    if (activeToolTab === "arrange") return renderArrangePanel();
    if (activeToolTab === "performers") return renderPerformersPanel();
    return renderSharePanel();
  }

  const activeToolLabel = MOBILE_TABS.find(([value]) => value === activeToolTab)?.[1] || "대형";
  const selectedPerformer = plan.performers.find((performer) => performer.id === selectedPerformerId);
  const selectedStateText = selectedPairKey
    ? "커플 선택됨"
    : selectedPerformer
      ? `${selectedPerformer.name || selectedPerformer.label} 선택됨`
      : "선택 없음";

  return (
    <div className={isStageFocus ? "app stage-focus" : "app"}>
      {status && <div className="status">{status} {shareUrl && <a href={shareUrl}>{shareUrl}</a>}</div>}

      <main className="workspace">
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
          </div>
          {!readonly && <p className="stage-hint">{hasUsableAudio ? "음악을 재생하고 원하는 순간에 대형을 만드세요." : "음악 없이도 대형을 만들고 배치를 시작할 수 있습니다."}</p>}
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
            </div>
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
              {sortedSections[activeSectionIndex - 1] && plan.performers.map((performer) => {
                const pos = sortedSections[activeSectionIndex - 1].positions?.[performer.id];
                if (!pos) return null;
                return <circle key={`ghost-${performer.id}`} cx={pos.x} cy={pos.y} r="2.5" fill="#475569" opacity="0.2" />;
              })}
              {sortedSections[activeSectionIndex - 1] && plan.performers.map((performer) => {
                const from = sortedSections[activeSectionIndex - 1].positions?.[performer.id];
                const to = activeSection?.positions?.[performer.id];
                if (!from || !to || (Math.abs(from.x - to.x) < 1 && Math.abs(from.y - to.y) < 1)) return null;
                const dim = selectedPerformerId && selectedPerformerId !== performer.id;
                return <line key={`arrow-${performer.id}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={performer.color} strokeWidth="0.8" opacity={dim ? 0.12 : 0.65} markerEnd="url(#arrow-live)" />;
              })}
              {(plan.partnerSets.find((set) => set.id === activeSection?.partnerSetId)?.pairs || []).map(([a, b], index) => {
                const from = visiblePositions[a];
                const to = visiblePositions[b];
                if (!from || !to) return null;
                const selected = selectedPairKey === pairKey([a, b]) || (magnetCandidateId && [a, b].includes(magnetCandidateId));
                const pair = [a, b];
                return (
                  <g
                    key={`pair-${index}`}
                    className="pair-link"
                    onPointerDown={(event) => onPairPointerDown(event, pair, index)}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedPairKey(pairKey(pair));
                    }}
                  >
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="transparent" strokeWidth="9" strokeLinecap="round" />
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={selected ? "#b4234f" : "#334155"} strokeWidth={selected ? "1.1" : "0.55"} opacity={selected ? "0.9" : "0.58"} pointerEvents="none" />
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
                const dim = selectedPerformerId && selectedPerformerId !== performer.id && magnetCandidateId !== performer.id;
                const isCandidate = magnetCandidateId === performer.id;
                const shortName = tokenShortName(performer);
                const fullName = tokenName(performer);
                const fontSize = tokenFontSize(performer);
                return (
                  <g
                    key={performer.id}
                    className={readonly ? "token readonly" : "token"}
                    opacity={dim ? 0.35 : 1}
                    onPointerDown={(event) => onStagePointerDown(event, performer.id)}
                    onClick={() => setSelectedPerformerId(performer.id)}
                  >
                    <title>{fullName}</title>
                    <circle cx={pos.x} cy={pos.y} r="7.4" fill="transparent" />
                    {(selectedPerformerId === performer.id || dragPositions?.[performer.id]) && <circle cx={pos.x} cy={pos.y} r="1.1" fill="#162033" opacity="0.45" pointerEvents="none" />}
                    {isCandidate && <circle cx={pos.x} cy={pos.y} r="7.1" fill="none" stroke="#b4234f" strokeWidth="1.1" strokeDasharray="1.5 1" />}
                    {selectedPerformerId === performer.id && <circle cx={pos.x} cy={pos.y} r={SELECTED_RING_RADIUS} fill="none" stroke="#162033" strokeWidth="0.7" pointerEvents="none" />}
                    <circle cx={pos.x} cy={pos.y} r={TOKEN_RADIUS} fill={performer.color} stroke="#f8fafc" strokeWidth="0.8" />
                    <text x={pos.x} y={pos.y + fontSize * 0.34} textAnchor="middle" fontSize={fontSize} fill="#fff" fontWeight="800" pointerEvents="none">{shortName}</text>
                  </g>
                );
              })}
              {(partnerSet?.pairs || []).map((pair, index) => {
                const [a, b] = pair;
                const from = visiblePositions[a] || selectedSection?.positions?.[a];
                const to = visiblePositions[b] || selectedSection?.positions?.[b];
                if (!from || !to) return null;
                const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
                const selected = selectedPairKey === pairKey(pair);
                return (
                  <g
                    key={`pair-handle-${pairKey(pair)}-${index}`}
                    className="pair-handle"
                    onPointerDown={(event) => onPairPointerDown(event, pair, index)}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedPairKey(pairKey(pair));
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      removePairByKey(pairKey(pair));
                    }}
                  >
                    <circle cx={mid.x} cy={mid.y} r="9" fill="transparent" />
                    <polygon
                      points={`${mid.x},${mid.y - 2.8} ${mid.x + 2.8},${mid.y} ${mid.x},${mid.y + 2.8} ${mid.x - 2.8},${mid.y}`}
                      fill={selected ? "#b4234f" : "#ffffff"}
                      stroke={selected ? "#7f1d1d" : "#334155"}
                      strokeWidth="0.8"
                    />
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="formation-rail" aria-label="대형 타임라인">
            {sortedSections.map((section) => (
              <button
                key={section.id}
                className={[
                  "formation-chip",
                  section.id === selectedSection?.id ? "selected" : "",
                  section.id === sortedSections[timeSectionIndex]?.id ? "current" : ""
                ].filter(Boolean).join(" ")}
                onClick={() => jumpTo(section)}
                title={`${section.name} / 도착 ${formatTime(pointTime(section))}`}
              >
                <span>{formatTime(pointTime(section))}</span>
                <strong>{section.name}</strong>
              </button>
            ))}
          </div>
          <div className={hasUsableAudio ? "transport has-audio" : "transport no-audio"}>
            {hasUsableAudio && (
              <>
                <button className="primary" onClick={togglePlayback}>
                  {isPlaying ? "정지" : "재생"}
                </button>
                {!readonly && <button className="secondary capture-button" onClick={addSection}>현재 시간에 대형 만들기</button>}
                <input
                  type="range"
                  min="0"
                  max={timelineMax}
                  step="0.1"
                  value={sliderTime}
                  onChange={(event) => {
                    const next = clamp(parseNumber(event.target.value, 0), 0, timelineMax);
                    setCurrentTime(next);
                    if (audioRef.current) audioRef.current.currentTime = next;
                  }}
                />
                <span className="time-readout">{formatTime(sliderTime)} / {formatTime(timelineMax)}</span>
              </>
            )}
            <audio
              ref={audioRef}
              src={audioSrc}
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
                const fallbackUrl = audioUrlCandidates(plan.audio).find((url) => url !== audioSrc);
                if (fallbackUrl) {
                  setAudioSrc(fallbackUrl);
                  setAudioUploadStatus("uploaded");
                  setStatus("저장된 Storage 경로로 음악을 다시 연결합니다.");
                  return;
                }
                setAudioUploadStatus(plan.audio?.storagePath || plan.audio?.publicUrl ? "failed" : "idle");
                setStatus("음악 URL을 불러오지 못했습니다. 다시 음악을 불러오세요.");
              }}
            />
            {!hasUsableAudio && !readonly && <button className="primary capture-button" onClick={addSection}>대형 추가</button>}
          </div>
          {selectedSection && (
            <div className="selected-formation-bar">
              <label className="compact-name">
                <span>선택 대형</span>
                <input readOnly={readonly} value={selectedSection.name} onChange={(event) => updateSection(selectedSection.id, { name: event.target.value })} />
              </label>
              <div className="formation-time-summary">
                <span>도착 {formatTime(pointTime(selectedSection))}</span>
                <span>이동 {pointMoveDuration(selectedSection)}초</span>
              </div>
              {!readonly && (
                <>
                  <button onClick={syncSelectedSectionToCurrentTime}>현재 시간으로 맞춤</button>
                  <button onClick={() => nudgeSelectedSection(-0.5)}>-0.5초</button>
                  <button onClick={() => nudgeSelectedSection(0.5)}>+0.5초</button>
                  <div className="duration-chips" aria-label="이동 시간 빠른 선택">
                    {[0, 2, 4, 8].map((seconds) => (
                      <button
                        key={seconds}
                        className={pointMoveDuration(selectedSection) === seconds ? "active" : ""}
                        onClick={() => setSelectedMoveDuration(seconds)}
                      >
                        {seconds}초
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        <aside className="tool-inspector">
          <div className="inspector-now">
            <span>현재 작업</span>
            <strong>{selectedSection?.name || activeSection?.name || "대형 없음"}</strong>
            <em>{formatTime(sliderTime)} · 도착 {selectedSection ? formatTime(pointTime(selectedSection)) : "0:00.0"} · 이동 {selectedSection ? pointMoveDuration(selectedSection) : 0}초</em>
            <em>{selectedStateText}</em>
          </div>
          {renderMobileTabs("inspector-tabs")}
          <div className="inspector-panel">
            {renderToolPanelContent()}
          </div>
        </aside>
        <aside className="landscape-tools">
          {renderMobileTabs("mobile-tabs-rail")}
          <div className="mobile-panel landscape-panel">
            {renderToolPanelContent()}
          </div>
        </aside>
      </main>

      <section className="mobile-editor">
        {renderMobileTabs()}
        {isBottomSheetOpen && (
          <div className={isBottomSheetExpanded ? "mobile-bottom-sheet expanded" : "mobile-bottom-sheet"}>
            <div className="bottom-sheet-head">
              <strong>{activeToolLabel}</strong>
              <div className="row-actions">
                <button onClick={() => setIsBottomSheetExpanded((value) => !value)}>{isBottomSheetExpanded ? "축소" : "확장"}</button>
                <button onClick={() => setIsBottomSheetOpen(false)}>닫기</button>
              </div>
            </div>
            <div className="mobile-panel">
              {renderToolPanelContent()}
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
