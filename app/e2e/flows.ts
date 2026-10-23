// SPDX-License-Identifier: Apache-2.0
// Shared happy-path data entry used by the egress and G1 gates.

import { expect, type Page } from "@playwright/test";

const ACCOUNTS = [
  { owner: "Alex", label: "Employer 401k", type: "tax_deferred", balance: "142000" },
  { owner: "Alex", label: "Brokerage", type: "taxable", balance: "85500" },
  { owner: "Sam", label: "Roth IRA", type: "tax_free", balance: "61200" },
  { owner: "Alex", label: "High-yield savings", type: "other", balance: "30000" },
  { owner: "Sam", label: "Primary residence", type: "real_estate", balance: "410000" },
] as const;

export const EXPECTED_NET_WORTH = "$728,700";

export async function acceptTou(page: Page): Promise<void> {
  const gate = page.getByTestId("tou-gate");
  const visible = await gate
    .waitFor({ state: "visible", timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return;
  await page.getByTestId("tou-scroll").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.getByTestId("tou-confirm").check();
  await page.getByTestId("tou-agree").click();
  await gate.waitFor({ state: "detached", timeout: 4000 });
}

export async function bootApp(page: Page): Promise<void> {
  await page.goto("/");
  await acceptTou(page);
  await expect(page.getByTestId("nav-networth")).toBeVisible();
}

export async function enterDemoHousehold(page: Page): Promise<void> {
  await page.getByTestId("nav-household").click();
  await page.getByTestId("household-label").fill("Test Family");
  await page.getByTestId("create-household").getByRole("button").click();
  await expect(page.getByRole("heading", { name: "Test Family" })).toBeVisible();

  for (const [name, birth, sex, retirement] of [
    ["Alex", "1988", "f", "62"],
    ["Sam", "1986", "m", "64"],
  ] as const) {
    await page.getByTestId("person-name").fill(name);
    await page.getByTestId("person-birth").fill(birth);
    await page.getByTestId("person-sex").selectOption(sex);
    await page.getByTestId("person-retirement").fill(retirement);
    await page.getByTestId("add-person").getByRole("button").click();
  }
  await expect(page.getByTestId("people-table").getByRole("row")).toHaveCount(3); // header + 2

  await page.getByTestId("nav-accounts").click();
  for (const account of ACCOUNTS) {
    await page.getByTestId("account-owner").selectOption({ label: account.owner });
    await page.getByTestId("account-label").fill(account.label);
    await page.getByTestId("account-type").selectOption(account.type);
    await page.getByTestId("account-balance").fill(account.balance);
    await page.getByTestId("add-account").getByRole("button").click();
  }
  await expect(page.getByTestId("accounts-table").getByRole("row")).toHaveCount(6); // header + 5
}

export async function expectNetWorth(page: Page, value: string): Promise<void> {
  await page.getByTestId("nav-networth").click();
  await expect(page.getByTestId("net-worth-total")).toHaveText(value);
}
