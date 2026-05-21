import assert from "node:assert/strict";
import test from "node:test";

import { createProjectJsonDownload } from "./projectJson.mjs";

test("creates a plain json save file from the current project", async () => {
  const plan = {
    title: "Stage Map Demo",
    sections: [{ id: "intro", name: "Intro" }]
  };

  const download = createProjectJsonDownload(plan);

  assert.equal(download.filename, "Stage Map Demo.json");
  assert.equal(download.blob.type, "application/json");
  assert.deepEqual(JSON.parse(await download.blob.text()), plan);
});

test("uses a fallback filename when the project has no title", () => {
  const download = createProjectJsonDownload({ title: "   " });

  assert.equal(download.filename, "choreo-project.json");
});
