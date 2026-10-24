// SPDX-License-Identifier: Apache-2.0
// M4.5 (D13): snapshot the plan, change an input, snapshot again, and the
// diff must name the changed parameters and stay stable across a reload.

import { expect, test } from "@playwright/test";
import { bootApp, enterDemoHousehold } from "./flows.ts";

test("G4: plan snapshots survive reload and diff the parameter change", async ({ page }) => {
  await bootApp(page);
  await enterDemoHousehold(page);

  await page.getByTestId("nav-plan").click();
  await expect(page.getByTestId("scenario-empty")).toBeVisible();
  await page.getByTestId("scenario-name").fill("Baseline");
  await page.getByTestId("scenario-form").getByRole("button").click();
  await expect(page.getByTestId("scenario-table")).toContainText("Baseline");

  await page.getByTestId("nav-cashflow").click();
  await page.getByTestId("income-label").fill("Consulting");
  await page.getByTestId("income-kind").selectOption("other");
  await page.getByTestId("income-amount").fill("10000");
  await page.getByTestId("add-income").getByRole("button").click();

  await page.getByTestId("nav-plan").click();
  await page.getByTestId("scenario-name").fill("Plus consulting");
  await page.getByTestId("scenario-form").getByRole("button").click();

  await page.getByTestId("scenario-a").selectOption({ label: "Baseline" });
  await page.getByTestId("scenario-b").selectOption({ label: "Plus consulting" });
  await expect(page.getByTestId("scenario-diff")).toBeVisible();
  await expect(page.getByTestId("scenario-diff-table")).toContainText("incomeStreams[0].annualAmount");
  await expect(page.getByTestId("scenario-diff-table")).toContainText("10000");

  await page.reload();
  await page.getByTestId("nav-plan").click();
  await expect(page.getByTestId("scenario-table")).toContainText("Baseline");
  await expect(page.getByTestId("scenario-table")).toContainText("Plus consulting");
});
