// SPDX-License-Identifier: Apache-2.0
// M2 smoke: after entering a household with income, spending, a matched
// 401k contribution and a recurring one-off spend, the Plan tab renders a
// deterministic projection. (Engine-level Gate G2 math is covered by the
// golden/property tests in engine/test.)

import { expect, test } from "@playwright/test";
import { bootApp, enterDemoHousehold } from "./flows.ts";

const thisYear = new Date().getFullYear();

test("Plan tab: deterministic projection renders from entered data", async ({ page }) => {
  await bootApp(page);
  await enterDemoHousehold(page);

  await page.getByTestId("nav-cashflow").click();
  await page.getByTestId("spend-now").fill("90000");
  await page.getByTestId("spend-ret").fill("60000");
  await page.getByTestId("spend-essential").fill("70");
  await page.getByTestId("set-spending").getByRole("button").click();

  await page.getByTestId("income-label").fill("Salary");
  await page.getByTestId("income-kind").selectOption("salary");
  await page.getByTestId("income-amount").fill("120000");
  await page.getByTestId("income-growth").fill("1");
  await page.getByTestId("add-income").getByRole("button").click();

  await page.getByTestId("oneoff-label").fill("Car");
  await page.getByTestId("oneoff-amount").fill("20000");
  await page.getByTestId("oneoff-repeat").fill("6");
  await page.getByTestId("oneoff-inflation").fill("3");
  await page.getByTestId("add-oneoff").getByRole("button").click();

  await page.getByTestId("nav-accounts").click();
  await page.getByTestId("account-owner").selectOption({ label: "Alex" });
  await page.getByTestId("account-label").fill("Matched 401k");
  await page.getByTestId("account-type").selectOption("tax_deferred");
  await page.getByTestId("account-balance").fill("0");
  await page.getByTestId("account-planned").fill("5000");
  await page.getByTestId("account-match").fill("50");
  await page.getByTestId("account-match-share").fill("6");
  await page.getByTestId("add-account").getByRole("button").click();

  await page.getByTestId("allocation-account").selectOption({ label: "Matched 401k" });
  await page.getByTestId("allocation-class").selectOption("us_equity");
  await page.getByTestId("allocation-weight").fill("100");
  await page.getByTestId("add-allocation").getByRole("button").click();

  await page.getByTestId("nav-plan").click();
  await expect(page.getByTestId("plan-table")).toBeVisible();
  const horizon = 1988 + 95 + 5 - thisYear; // youngest person's expectancy + 5, from today
  await expect(page.getByTestId("plan-table").getByRole("row")).toHaveCount(horizon + 1);
  await expect(page.getByTestId("plan-terminal")).not.toHaveText("$0");
  await expect(page.getByTestId("plan-summary")).toContainText("contributed");
  await expect(page.getByTestId("plan-runout")).toHaveCount(0);

  const firstDataRow = page.getByTestId("plan-table").getByRole("row").nth(1);
  await expect(firstDataRow).toContainText(String(thisYear));
  await expect(firstDataRow).toContainText("$5,000"); // contribution
  await expect(firstDataRow).toContainText("$2,500"); // 50% match up to 6% salary
});
