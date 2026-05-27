import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const selectedFormationStart = appSource.indexOf("<div className=\"selected-formation-bar\">");
const selectedFormationEnd = appSource.indexOf("\n          )}\n        </section>", selectedFormationStart);
const selectedFormationBar = selectedFormationStart === -1
  ? ""
  : appSource.slice(selectedFormationStart, selectedFormationEnd === -1 ? undefined : selectedFormationEnd);
const selectedFormationTools = appSource.match(/<div className="selected-formation-tools">[\s\S]*?<\/div>\s*\)\}/)?.[0] || "";

test("formation creation uses the short add label", () => {
  assert.match(appSource, />대형 추가<\/button>/);
  assert.doesNotMatch(appSource, /현재 시간에 대형 만들기/);
});

test("bottom timeline uses formation and audio lanes", () => {
  assert.match(appSource, /className="timeline-editor"/);
  assert.match(appSource, /<span className="timeline-row-label">Forms<\/span>/);
  assert.match(appSource, /<span className="timeline-row-label">Audio<\/span>/);
  assert.match(appSource, /formationTimelineLabel\(index\)/);
  assert.match(appSource, /layoutFormationBlocks\(sortedSections, timelinePixelsPerSecond\)/);
  assert.match(appSource, /timelineFormationBlocks/);
  assert.doesNotMatch(appSource, /visualLeftPx/);
  assert.doesNotMatch(appSource, /visualShiftPx/);
  assert.match(appSource, /"--formation-left": `\$\{block\.leftPx\}px`/);
  assert.doesNotMatch(appSource, /"--formation-top"/);
  assert.match(appSource, /"--formation-width": `\$\{block\.widthPx\}px`/);
  assert.match(appSource, /"--formation-hit-width": `\$\{block\.hitWidthPx\}px`/);
  assert.match(appSource, /"--formation-arrival": `\$\{block\.arrivalPx\}px`/);
  assert.match(appSource, /className="timeline-viewport timeline-ruler-viewport"/);
  assert.match(appSource, /onWheel=\{onTimelineWheel\}/);
  assert.match(appSource, /\{!readonly && <button className="secondary capture-button" onClick=\{addSection\}>대형 추가<\/button>\}/);
});

test("timeline edits use tenth-second quantization", () => {
  assert.match(appSource, /quantizeTimelineTime/);
  assert.match(appSource, /gridSize:\s*0\.1/);
  assert.match(appSource, /const safe = quantizeTimelineTime\(seconds\);/);
  assert.match(appSource, /quantizeTimelineTime\(pointMoveStart\(section\) \+ pointMoveDuration\(section\)/);
  assert.match(appSource, /setTimelineSnapTime\(absoluteTime\);/);
});

test("formation blocks use HitCut-style pixel timeline controls", () => {
  const formationBlockRule = styleSource.match(/\.formation-block \{[\s\S]*?\}/)?.[0] || "";
  const formationMarkerRule = styleSource.match(/\.formation-block\.marker \{[\s\S]*?\}/)?.[0] || "";
  const viewportRule = styleSource.match(/\.timeline-viewport \{[\s\S]*?\}/)?.[0] || "";

  assert.doesNotMatch(formationBlockRule, /--formation-marker-half/);
  assert.match(formationBlockRule, /top:\s*7px;/);
  assert.match(formationBlockRule, /left:\s*var\(--formation-left\);/);
  assert.match(formationBlockRule, /box-sizing:\s*border-box;/);
  assert.match(formationBlockRule, /width:\s*var\(--formation-hit-width, var\(--formation-width\)\);/);
  assert.match(styleSource, /\.formation-block\.tick \{[\s\S]*?width:\s*0;/);
  assert.match(styleSource, /\.formation-block\.tick::before \{/);
  assert.doesNotMatch(formationMarkerRule, /transform:\s*translateX\(-50%\);/);
  assert.match(viewportRule, /overflow:\s*hidden;/);
  assert.match(styleSource, /\.formation-block\.segment \{[\s\S]*?min-width:\s*0;/);
  assert.doesNotMatch(styleSource, /\.formation-block \{[\s\S]*?width:\s*max\(/);
  assert.doesNotMatch(styleSource, /width:\s*max\(96px, var\(--formation-width\)\);/);
  assert.match(styleSource, /\.timeline-snapline \{/);
});

test("bottom timeline scrolls inside the stage card instead of widening it", () => {
  const stageAreaRule = styleSource.match(/\.stage-area \{[\s\S]*?\}/)?.[0] || "";
  const timelineRule = styleSource.match(/\.timeline-editor \{[\s\S]*?\}/)?.[0] || "";

  assert.match(stageAreaRule, /min-width:\s*0;/);
  assert.match(timelineRule, /width:\s*100%;/);
  assert.match(timelineRule, /max-width:\s*100%;/);
  assert.match(timelineRule, /min-width:\s*0;/);
  assert.match(timelineRule, /overflow:\s*hidden;/);
});

test("selected formation timing is read-only because trim handles own timing edits", () => {
  assert.doesNotMatch(selectedFormationBar, /현재 시간으로 맞춤/);
  assert.doesNotMatch(selectedFormationBar, /nudgeSelectedArrival/);
  assert.doesNotMatch(selectedFormationBar, /nudgeSelectedMoveStart/);
  assert.doesNotMatch(selectedFormationBar, /setSelectedMoveDuration/);
  assert.doesNotMatch(selectedFormationBar, /arrival-nudges/);
  assert.doesNotMatch(selectedFormationBar, /duration-chips/);
});

test("selected formation bar separates arrival and movement start timing", () => {
  assert.match(selectedFormationBar, /<span>도착 시각<\/span>/);
  assert.match(selectedFormationBar, /\{formatTime\(pointTime\(selectedSection\)\)\}/);
  assert.match(selectedFormationBar, /<span>이동 시작<\/span>/);
  assert.match(selectedFormationBar, /\{formatTime\(pointMoveStart\(selectedSection\)\)\}/);
  assert.match(selectedFormationBar, /<span>이동 시간<\/span>/);
  assert.match(selectedFormationBar, /\{pointMoveDuration\(selectedSection\)\}초 · 도착 전부터 이동/);
});

test("selected formation bar keeps structural actions in tools", () => {
  assert.doesNotMatch(selectedFormationBar, /duplicateSection/);
  assert.doesNotMatch(selectedFormationBar, /deleteSection/);
  assert.doesNotMatch(selectedFormationBar, /resetSelectedFormation/);

  assert.match(selectedFormationTools, /<span>선택 대형<\/span>/);
  assert.match(selectedFormationTools, /\{selectedSection\?\.name \|\| "대형 없음"\}/);
  assert.match(selectedFormationTools, /<button onClick=\{duplicateSection\}>복제<\/button>/);
  assert.match(selectedFormationTools, /<button className="danger-button compact-danger" onClick=\{deleteSection\}>삭제<\/button>/);
  assert.match(selectedFormationTools, /<button className="danger-button compact-danger" onClick=\{resetSelectedFormation\}>대형 초기화<\/button>/);
});

test("movement timing cannot overlap adjacent formations", () => {
  const updateTiming = appSource.match(/function updateSectionTiming\(sectionId, time, moveDuration = null, options = \{\}\) \{[\s\S]*?\n  \}/)?.[0] || "";

  assert.match(updateTiming, /clampFormationTiming\(\{/);
  assert.match(updateTiming, /sections: sortedSections/);
  assert.match(updateTiming, /sectionId,/);
  assert.match(updateTiming, /timelineMax/);
});

test("selected formation segment exposes drag and two trim handles", () => {
  const leftHandleRule = styleSource.match(/\.formation-resize-handle\.left \{[\s\S]*?\}/)?.[0] || "";
  const rightHandleRule = styleSource.match(/\.formation-resize-handle\.right \{[\s\S]*?\}/)?.[0] || "";

  assert.match(appSource, /className="formation-resize-handle left"/);
  assert.match(appSource, /className="formation-resize-handle right"/);
  assert.match(appSource, /onFormationPointerDown\(event, section, index, "body"\)/);
  assert.match(appSource, /onFormationPointerDown\(event, section, index, "left"\)/);
  assert.match(appSource, /onFormationPointerDown\(event, section, index, "right"\)/);
  assert.match(appSource, /const rawStart = startMoveStart \+ deltaTime;/);
  assert.match(appSource, /snapTimelineTime\(rawStart, section, previousArrival, startArrival\)/);
  assert.match(appSource, /trimFormationSegment\(\{/);
  assert.match(appSource, /edge: "right"/);
  assert.match(appSource, /resolveFormationBodyDrag\(\{/);
  assert.match(appSource, /deltaTime,/);
  assert.match(appSource, /updateSectionTiming\(section\.id, dragResult\.end, startMoveDuration, \{ history: false \}\);/);
  assert.match(leftHandleRule, /left:\s*2px;/);
  assert.match(rightHandleRule, /right:\s*2px;/);
});

test("selected movement segments expose keyframe ticks and reorder preview", () => {
  assert.match(appSource, /movement-keyframe-tick/);
  assert.match(appSource, /stageEditTargetLabel/);
  assert.match(appSource, /movement-edit-target keyframe/);
  assert.match(appSource, /movement-edit-status keyframe/);
  assert.match(appSource, />도착 대형 편집<\/button>/);
  assert.match(appSource, /aria-label=\{`이동 keyframe/);
  assert.match(appSource, /addMovementKeyframeAtCurrentTime/);
  assert.match(appSource, /deleteSelectedMovementKeyframe/);
  assert.match(appSource, /onMovementKeyframePointerDown/);
  assert.match(appSource, /movementKeyframePositions\(selectedSection, selectedMovementKeyframe\)/);
  assert.match(appSource, /sectionWithPositionPatch\(item, nextPositions, keyframeId/);
  assert.match(appSource, /keyframeId: selectedMovementKeyframe\?\.id \|\| ""/);
  assert.match(appSource, /disabled=\{!canAddMovementKeyframe\}/);
  assert.match(appSource, /resolveFormationBodyDrag\(\{/);
  assert.doesNotMatch(appSource, /Math\.abs\(clientX - startClientX\) >= 32/);
  assert.match(appSource, /reorderFormationSegments\(\{/);
  assert.match(appSource, /className="timeline-reorder-preview"/);
  assert.match(styleSource, /\.movement-keyframe-tick \{/);
  assert.match(styleSource, /\.movement-edit-target\.keyframe \{/);
  assert.match(styleSource, /\.movement-edit-status\.keyframe \{/);
  assert.match(styleSource, /\.timeline-reorder-preview \{/);
  assert.match(styleSource, /--formation-hit-width/);
  assert.match(styleSource, /--formation-handle-width/);
  assert.match(appSource, /timelineBlockedEdge/);
  assert.match(styleSource, /\.formation-block\.blocked-left,/);
  assert.match(styleSource, /\.formation-block\.blocked-right/);
});

test("timeline pointer drags batch undo history until pointerup", () => {
  assert.match(appSource, /interactiveEditSnapshotRef/);
  assert.match(appSource, /beginInteractiveEdit\(\);/);
  assert.match(appSource, /finishInteractiveEdit\(hasEdited\);/);
  assert.match(appSource, /replaceSectionsIfChanged\(nextSections\);/);
  assert.match(appSource, /const nextSections = trimFormationSegment\(\{/);
  assert.match(appSource, /\}\), \{ history: false \}\);/);
  assert.match(appSource, /updateMovementKeyframes\(section\.id,[\s\S]*?\{ history: false \}\)/);
});

test("formation add follows sequential append selection policy", () => {
  const addSection = appSource.match(/function addSection\(\) \{[\s\S]*?\n  \}/)?.[0] || "";

  assert.match(addSection, /const target = resolveFormationAddTarget\(sortedSections, captureTime\);/);
  assert.match(addSection, /if \(target\.action === "select"\)/);
  assert.match(addSection, /setSelectedSectionId\(target\.section\.id\);/);
  assert.match(addSection, /const previous = target\.previous;/);
  assert.match(addSection, /const moveDuration = target\.moveDuration;/);
});

test("top actions expose save share and tools without legacy tabs", () => {
  assert.match(appSource, /<button className="primary" onClick=\{saveProjectToCloud\}>저장하기<\/button>/);
  assert.match(appSource, /<button onClick=\{\(\) => setIsProjectMenuOpen\(\(value\) => !value\)\}>프로젝트<\/button>/);
  assert.match(appSource, /<button onClick=\{returnToProjectPicker\}>프로젝트 선택으로 돌아가기<\/button>/);
  assert.match(appSource, /localStorage\.removeItem\(STORAGE_KEY\);/);
  assert.match(appSource, /<button onClick=\{\(\) => setIsShareMenuOpen\(\(value\) => !value\)\}>공유<\/button>/);
  assert.match(appSource, /\{isToolDrawerOpen \? "도구 닫기" : "도구"\}/);
  assert.doesNotMatch(appSource, /const MOBILE_TABS/);
  assert.doesNotMatch(appSource, /renderMobileTabs/);
});

test("mobile layout overrides the open tool drawer grid", () => {
  const mobileWorkspace = styleSource.match(/@media \(max-width: 840px\)[\s\S]*?@media print/)?.[0] || "";

  assert.match(mobileWorkspace, /\.workspace\.tools-open \{\s*grid-template-columns: 1fr;/);
});
