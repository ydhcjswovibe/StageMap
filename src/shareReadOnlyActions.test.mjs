import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("keeps the readonly share banner focused on editable copies", () => {
  const readonlyBanner = appSource.match(/\{readonly && \(\s*<div className="readonly-banner">[\s\S]*?<\/div>\s*\)\}/)?.[0] || "";

  assert.doesNotMatch(readonlyBanner, /exportJson/);
  assert.doesNotMatch(readonlyBanner, /저장하기/);
  assert.match(readonlyBanner, /<button onClick=\{saveEditableCopy\}>사본으로 편집<\/button>/);
});

test("labels json as export in readonly share mode while keeping edit save wording", () => {
  const shareActions = appSource.match(/<div className="share-actions">[\s\S]*?<\/div>/)?.[0] || "";

  assert.match(shareActions, /<button onClick=\{exportJson\}>\{readonly \? "JSON 내보내기" : "저장하기"\}<\/button>/);
  assert.match(shareActions, /<button onClick=\{\(\) => exportPng\(\)\}>현재 PNG<\/button>/);
  assert.match(shareActions, /<button onClick=\{exportAllPng\}>대형 PNG 전체 저장<\/button>/);
  assert.match(shareActions, /<button onClick=\{\(\) => window\.print\(\)\}>인쇄\/PDF<\/button>/);
});
