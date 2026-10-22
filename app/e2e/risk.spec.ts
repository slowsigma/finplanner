// SPDX-License-Identifier: Apache-2.0
// M3 smoke + G3 prep: sliders re-run the seeded MC sim fast (< 2 s), results
// are reproducible across reloads for a fixed seed, and saved runs pin the
// assumption-set hash (B2.2/R3).

import { expect, test } from "@playwright/test";
import { bootApp, enterDemoHousehold } from "./flows.ts";

test("Risk tab: seeded Monte Carlo with what-if sliders", async ({ page }) => {
  await bootApp(page);
  await enterDemoHousehold(page);

  await page.getByTestId("nav-cashflow").click();
  await page.getByTestId("spend-now").fill("90000");
  await page.getByTestId("spend-ret").fill("60000");
  await page.getByTestId("spend-essential").fill("70");
  await page.getByTestId("set-spending").getByRole("button").click();
  await page.getByTestId("income-label").fill("Salary");
  await page.getByTestId("income-amount").fill("120000");
  await page.getByTestId("add-income").getByRole("button").click();

  await page.getByTestId("nav-risk").click();
  await expect(page.getByTestId("risk-success")).toHaveText(/\d+% of paths fund every goal/);
  await expect(page.getByTestId("risk-ruin")).toContainText("out-of-money:");

  const ms = () =>
    page.getByTestId("risk-ms").innerText().then((t) => Number(t.replace(/[^\d]/g, "")));
  expect(await ms()).toBeLessThan(2000);

  // G3 shape: slider change re-runs synchronously under the 2 s budget.
  await page.getByTestId("slider-extra-savings").fill("10000");
  await page.getByTestId("slider-ret-spend").fill("150");
  await page.getByTestId("slider-longsd").fill("2");
  await page.getByTestId("slider-shock").fill("12");
  await page.getByTestId("risk-trials").selectOption("1000");
  expect(await ms()).toBeLessThan(2000);

  const success1 = await page.getByTestId("risk-success").innerText();
  await page.reload();
  await page.getByTestId("nav-risk").click();
  await expect(page.getByTestId("risk-success")).toHaveText(success1); // same seed ⇒ same numbers

  await page.getByTestId("risk-save-run").click();
  await expect(page.getByTestId("risk-saved")).toHaveText(/hash [0-9a-f]{16}/);

  // Assumption edits must change the pinned hash (B2.2/R3).
  const hashOf = async () =>
    (await page.getByTestId("risk-note").innerText()).match(/assumptions ([0-9a-f]{16})/)![1];
  const hashBefore = await hashOf();
  await page.getByTestId("assum-vol-us_equity").fill("25");
  await page.getByTestId("edit-assumptions").getByRole("button").click();
  expect(await ms()).toBeLessThan(2000);
  expect(await hashOf()).not.toBe(hashBefore);
  await expect(page.getByTestId("risk-success")).toHaveText(/\d+% of paths fund every goal/);
});

test("Risk tab: B2.6 stress replay uses pasted windows", async ({ page }) => {
  await bootApp(page);
  await enterDemoHousehold(page);
  await page.getByTestId("nav-risk").click();

  await page.getByTestId("stress-mode").selectOption("all");
  await expect(page.getByTestId("risk-error")).toContainText("Paste real % returns");

  await page.getByTestId("stress-preset").selectOption("2000\u20132002 (dot-com bust)");
  await expect(page.getByTestId("risk-success")).toBeVisible();
  const ms = await page.getByTestId("risk-ms").innerText().then((t) => Number(t.replace(/[^\d]/g, "")));
  expect(ms).toBeLessThan(2000);
  await expect(page.getByTestId("risk-cv")).toHaveCount(0); // no CV under replay

  await page.getByTestId("stress-window").selectOption("10");
  await expect(page.getByTestId("risk-error")).toContainText("shorter than window");
  await page.getByTestId("stress-window").selectOption("3");

  await page.getByTestId("stress-mode").selectOption("bootstrap");
  await expect(page.getByTestId("risk-success")).toBeVisible();
  await expect(page.getByTestId("risk-cv")).toHaveCount(0);
});
