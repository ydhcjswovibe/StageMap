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

test("selected formation timing uses compact tenth-second nudges", () => {
  assert.doesNotMatch(selectedFormationBar, /현재 시간으로 맞춤/);
  assert.match(selectedFormationBar, /onClick=\{\(\) => nudgeSelectedArrival\(-0\.1\)\}>-<\/button>/);
  assert.match(selectedFormationBar, /onClick=\{\(\) => nudgeSelectedArrival\(0\.1\)\}>\+<\/button>/);
  assert.match(selectedFormationBar, /onClick=\{\(\) => nudgeSelectedMoveStart\(-0\.1\)\}>-<\/button>/);
  assert.match(selectedFormationBar, /onClick=\{\(\) => nudgeSelectedMoveStart\(0\.1\)\}>\+<\/button>/);
});

test("selected formation bar separates arrival and movement start timing", () => {
  assert.match(selectedFormationBar, /<span>도착 시각<\/span>/);
  assert.match(selectedFormationBar, /\{formatTime\(pointTime\(selectedSection\)\)\}/);
  assert.match(selectedFormationBar, /<span>이동 시작<\/span>/);
  assert.match(selectedFormationBar, /\{formatTime\(pointMoveStart\(selectedSection\)\)\}/);
  assert.match(selectedFormationBar, /<span>이동 시간<\/span>/);
  assert.match(selectedFormationBar, /\{pointMoveDuration\(selectedSection\)\}초 · 도착 전부터 이동/);
});

test("movement duration quick choices use immediate and common durations", () => {
  assert.match(selectedFormationBar, /\[0, 2, 4, 8\]\.map/);
  assert.match(selectedFormationBar, /seconds === 0 \? "즉시" : `\$\{seconds\}초 전`/);
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

test("movement duration cannot exceed the arrival time", () => {
  const updateTiming = appSource.match(/function updateSectionTiming\(sectionId, time, moveDuration = null\) \{[\s\S]*?\n  \}/)?.[0] || "";

  assert.match(updateTiming, /const safeMoveDuration = Math\.min\(safeTime, nextMoveDuration\);/);
  assert.match(updateTiming, /moveDuration: safeMoveDuration/);
  assert.match(updateTiming, /start: safeTime - safeMoveDuration/);
});

test("top actions expose save share and tools without legacy tabs", () => {
  assert.match(appSource, /<button className="primary" onClick=\{saveProjectToCloud\}>저장하기<\/button>/);
  assert.match(appSource, /<button onClick=\{\(\) => setIsShareMenuOpen\(\(value\) => !value\)\}>공유<\/button>/);
  assert.match(appSource, /\{isToolDrawerOpen \? "도구 닫기" : "도구"\}/);
  assert.doesNotMatch(appSource, /const MOBILE_TABS/);
  assert.doesNotMatch(appSource, /renderMobileTabs/);
});

test("mobile layout overrides the open tool drawer grid", () => {
  const mobileWorkspace = styleSource.match(/@media \(max-width: 840px\)[\s\S]*?@media print/)?.[0] || "";

  assert.match(mobileWorkspace, /\.workspace\.tools-open \{\s*grid-template-columns: 1fr;/);
});
