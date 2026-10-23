// SPDX-License-Identifier: Apache-2.0
// Gate G4 surface: fresh-profile clickwrap, recorded acceptance, footer.
import { expect, test } from "@playwright/test";

test("G4: first-run clickwrap gates the app, acceptance is recorded and re-gated on reset", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("tou-gate")).toBeVisible();
  await expect(page.getByTestId("tou-agree")).toBeDisabled();

  await page.getByTestId("tou-scroll").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.getByTestId("tou-agree")).toBeDisabled(); // scroll alone is not consent
  await page.getByTestId("tou-confirm").check();
  await expect(page.getByTestId("tou-agree")).toBeEnabled();
  await page.getByTestId("tou-agree").click();

  await expect(page.getByTestId("nav-networth")).toBeVisible();
  await expect(page.getByTestId("tou-footer")).toBeVisible();
  await page.getByTestId("nav-risk").click();
  await expect(page.getByTestId("tou-footer")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("tou-gate")).toHaveCount(0); // acceptance persisted

  await page.getByTestId("nav-backup").click();
  await expect(page.getByTestId("tou-settings")).toContainText("Accepted version");
  await page.getByTestId("tou-reread").click();
  await expect(page.getByTestId("tou-scroll")).toBeVisible();
  await page.getByTestId("tou-reset").click();
  await expect(page.getByTestId("tou-gate")).toBeVisible(); // in-session re-gate

  await page.reload();
  await expect(page.getByTestId("tou-gate")).toBeVisible(); // reset persisted too

  await page.getByTestId("tou-scroll").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.getByTestId("tou-confirm").check();
  await page.getByTestId("tou-agree").click();
  await expect(page.getByTestId("nav-networth")).toBeVisible();
});

test("G4: declining the clickwrap keeps the app closed", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("tou-decline").click();
  await expect(page.getByTestId("tou-declined")).toBeVisible();
  await expect(page.getByTestId("nav-networth")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("tou-gate")).toBeVisible(); // nothing recorded
});
