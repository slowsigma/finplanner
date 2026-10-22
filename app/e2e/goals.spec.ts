// SPDX-License-Identifier: Apache-2.0
// D1–D3 smoke: FI number reacts to the withdrawal-rate assumption; goals get
// on/off-track status and a required-savings gap from the deterministic plan.

import { expect, test } from "@playwright/test";
import { bootApp, enterDemoHousehold } from "./flows.ts";

const thisYear = new Date().getFullYear();

test("Goals tab: FI number/date + on-track tracking", async ({ page }) => {
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

  await page.getByTestId("nav-goals").click();
  await expect(page.getByTestId("fi-number")).toHaveText("$1,500,000"); // 60k ÷ 4%
  await expect(page.getByTestId("fi-date")).toContainText("÷ 4.0% SWR");

  await page.getByTestId("fi-swr").fill("3.5");
  await page.getByTestId("set-swr").getByRole("button").click();
  await expect(page.getByTestId("fi-number")).toHaveText("$1,714,286");

  await page.getByTestId("goal-label").fill("College");
  await page.getByTestId("goal-kind").selectOption("college");
  await page.getByTestId("goal-year").fill(String(thisYear + 5));
  await page.getByTestId("goal-amount").fill("50000");
  await page.getByTestId("add-goal").getByRole("button").click();
  await expect(page.getByTestId("goals-table").getByRole("row")).toHaveCount(2);

  await page.getByTestId("goal-label").fill("Mansion");
  await page.getByTestId("goal-kind").selectOption("custom");
  await page.getByTestId("goal-year").fill(String(thisYear + 10));
  await page.getByTestId("goal-amount").fill("10000000");
  await page.getByTestId("add-goal").getByRole("button").click();

  await expect(page.getByTestId("goals-table").getByRole("row")).toHaveCount(3); // header + 2
  const statuses = page.getByTestId("goals-table").getByTestId(/^goal-status-/);
  await expect(statuses.nth(0)).toHaveText("on track");
  await expect(statuses.nth(1)).toHaveText("off track");
  const mansionRow = page.getByTestId("goals-table").getByRole("row").nth(2);
  await expect(mansionRow.locator("td").nth(6)).not.toHaveText("—"); // required $/yr more
});
