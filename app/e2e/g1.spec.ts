// SPDX-License-Identifier: Apache-2.0
// Gate G1 (PLAN.md): fresh install -> 2-adult household with 5 accounts ->
// export -> wipe -> re-import -> identical data.

import { expect, test } from "@playwright/test";
import { bootApp, enterDemoHousehold, EXPECTED_NET_WORTH, expectNetWorth } from "./flows.ts";

test("G1: export -> wipe -> re-import round-trip is lossless", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await bootApp(page);
  await enterDemoHousehold(page);
  await expectNetWorth(page, EXPECTED_NET_WORTH);

  // record a snapshot too — history must survive the round-trip
  await page.getByTestId("record-snapshot").getByRole("button").click();

  // export
  await page.getByTestId("nav-backup").click();
  await page.getByTestId("export-password").fill("g1 correct horse");
  const download = page.waitForEvent("download");
  await page.getByTestId("export-button").click();
  const file = await download;
  const exportPath = await file.path();
  expect(file.suggestedFilename()).toMatch(/^finplanner-\d{4}-\d{2}-\d{2}\.fpx$/);

  // wipe
  await page.getByTestId("wipe-button").click();
  await expect(page.getByTestId("backup-status")).toHaveText("Device wiped.");
  await page.getByTestId("nav-household").click();
  await expect(page.getByTestId("create-household")).toBeVisible();
  await expectNetWorth(page, "$0");

  // re-import on the now-empty device
  await page.getByTestId("nav-backup").click();
  await page.getByTestId("import-file").setInputFiles(exportPath);
  await page.getByTestId("import-password").fill("g1 correct horse");
  await page.getByTestId("import-button").click();
  await expect(page.getByTestId("backup-status")).toHaveText("Import complete.");

  // prove durability against the browser itself, not just in-memory state
  await page.reload();
  await bootApp(page);

  await page.getByTestId("nav-household").click();
  await expect(page.getByRole("heading", { name: "Test Family" })).toBeVisible();
  await expect(page.getByTestId("people-table").getByRole("row")).toHaveCount(3);
  await page.getByTestId("nav-accounts").click();
  await expect(page.getByTestId("accounts-table").getByRole("row")).toHaveCount(6);
  await expectNetWorth(page, EXPECTED_NET_WORTH);

  // history survived (snapshot count + the recorded row)
  await expect(page.getByTestId("trend-chart")).toHaveCount(0); // needs >=2 snapshots; 1 recorded is fine
  await page.getByTestId("record-snapshot").getByRole("button").click();
  await expect(page.getByTestId("trend-chart")).toBeVisible();
});
