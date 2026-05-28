import { expect, test } from "@playwright/test";

function compactFormationText(text) {
  return text.replace(/\s+/g, " ").trim();
}

async function formationTexts(page) {
  return page.locator(".formation-block").evaluateAll((nodes) => (
    nodes.map((node) => node.innerText.replace(/\n/g, " | "))
  ));
}

test("timeline formation editing keeps sequential segments and clean browser output", async ({ page }) => {
  const browserIssues = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      browserIssues.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    browserIssues.push(`pageerror: ${error.message}`);
  });

  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");

  await page.getByRole("button", { name: /빈 프로젝트 시작/ }).click();
  await page.getByRole("button", { name: "대형 추가" }).click();
  await page.getByRole("button", { name: "대형 추가" }).click();

  const formationBlocks = page.locator(".formation-block");
  await expect(formationBlocks).toHaveCount(3);
  await expect(formationBlocks.nth(0)).toContainText("0:00.0 - 0:04.0");
  await expect(formationBlocks.nth(1)).toContainText("0:04.0 - 0:08.0");
  await expect(formationBlocks.nth(2)).toContainText("0:08.0 - 0:12.0");

  await expect(page.locator(".selected-formation-bar input[type=number], .tool-drawer input[type=number], .formation-panel input[type=number]")).toHaveCount(0);

  const f2 = formationBlocks.nth(1);
  await f2.click();
  const rightHandle = f2.locator(".formation-resize-handle.right");
  await expect(rightHandle).toHaveCount(1);
  const handleBox = await rightHandle.boundingBox();
  expect(handleBox).not.toBeNull();

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 112, handleBox.y + handleBox.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(formationBlocks.nth(1)).toContainText("0:04.0 - 0:10.0");
  await expect(formationBlocks.nth(2)).toContainText("0:10.0 - 0:14.0");

  const finalTexts = (await formationTexts(page)).map(compactFormationText);
  expect(finalTexts[0]).toContain("F1 | Intro | 0:00.0 - 0:04.0");
  expect(finalTexts[1]).toContain("F2 | 대형 0:08.0 | 0:04.0 - 0:10.0");
  expect(finalTexts[2]).toContain("F3 | 대형 0:12.0 | 0:10.0 - 0:14.0");

  const f1BodyBox = await formationBlocks.nth(0).boundingBox();
  expect(f1BodyBox).not.toBeNull();
  await page.mouse.move(f1BodyBox.x + f1BodyBox.width / 2, f1BodyBox.y + f1BodyBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(f1BodyBox.x + f1BodyBox.width / 2 + 1250, f1BodyBox.y + f1BodyBox.height / 2, { steps: 12 });
  await page.mouse.up();

  const reorderedTexts = (await formationTexts(page)).map(compactFormationText);
  expect(reorderedTexts[0]).toContain("F1 | 대형 0:08.0 | 0:00.0 - 0:06.0");
  expect(reorderedTexts[1]).toContain("F2 | 대형 0:12.0 | 0:06.0 - 0:10.0");
  expect(reorderedTexts[2]).toContain("F3 | Intro | 0:10.0 - 0:14.0");
  expect(browserIssues).toEqual([]);
});
