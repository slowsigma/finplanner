// SPDX-License-Identifier: Apache-2.0
// Gate G3 (R1): what-if slider re-runs stay interactive (< 2 s) on a
// throttled mid-range profile (D2/D11) — 6× CPU slowdown via CDP.

import { expect, test } from "@playwright/test";
import { bootApp, enterDemoHousehold } from "./flows.ts";

test("G3: 1000-trial slider re-run < 2 s under 6x CPU throttle", async ({ page }) => {
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

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });

  await page.getByTestId("nav-risk").click();
  await expect(page.getByTestId("risk-success")).toBeVisible();
  await page.getByTestId("risk-trials").selectOption("1000");
  await page.getByTestId("slider-extra-savings").fill("10000");

  const ms = await page.getByTestId("risk-ms").innerText().then((t) => Number(t.replace(/[^\d]/g, "")));
  expect(ms).toBeGreaterThan(0);
  expect(ms).toBeLessThan(2000);

  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
});
