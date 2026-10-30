// SPDX-License-Identifier: Apache-2.0
// A1 smoke: liabilities can be entered, shown, and reduce net worth.

import { expect, test } from "@playwright/test";
import { bootApp, enterDemoHousehold, EXPECTED_NET_WORTH } from "./flows.ts";

test("Net worth: adding a liability updates net worth and the liability table", async ({ page }) => {
  await bootApp(page);
  await enterDemoHousehold(page);
  await page.getByTestId("nav-networth").click();
  await expect(page.getByTestId("net-worth-total")).toHaveText(EXPECTED_NET_WORTH);

  await page.getByTestId("liability-label").fill("Mortgage");
  await page.getByTestId("liability-type").selectOption("mortgage");
  await page.getByTestId("liability-balance").fill("285000");
  await page.getByTestId("liability-rate").fill("5.5");
  await page.getByTestId("liability-payment").fill("32400");
  await page.getByTestId("add-liability").getByRole("button").click();

  await expect(
    page.getByTestId("liabilities-table").getByRole("row").filter({ hasText: "Mortgage" }),
  ).toHaveCount(1);
  await expect(page.getByTestId("liabilities-table")).not.toContainText("No liabilities yet");
  await expect(page.getByTestId("net-worth-total")).toHaveText("$443,700");
});
