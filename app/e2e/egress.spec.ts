// SPDX-License-Identifier: Apache-2.0
// D3 gate: the app must never attempt a single network request beyond its
// own origin. Enforced twice: (1) JS-level hooks on every egress API fail
// the test if the app code calls them cross-origin, (2) context routing
// aborts and records any request the JS hooks could not see.

import { expect, test } from "@playwright/test";
import { bootApp, enterDemoHousehold, expectNetWorth } from "./flows.ts";

const BASE = "http://localhost:4173";
let routeAborts: string[] = [];

test.beforeEach(async ({ context }) => {
  routeAborts = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== BASE) {
      routeAborts.push(url.href);
      route.abort("blockedbyclient");
      return;
    }
    void route.continue();
  });
  await context.addInitScript(() => {
    const attempts: string[] = [];
    Object.defineProperty(globalThis, "__egressAttempts", { value: attempts });
    const record = (raw: RequestInfo | URL | string): void => {
      const input = typeof raw === "string" || raw instanceof URL ? raw : raw instanceof Request ? raw.url : String(raw);
      try {
        const url = new URL(String(input), globalThis.location.href);
        if (url.origin !== globalThis.location.origin) attempts.push(url.href);
      } catch {
        attempts.push(String(input));
      }
    };
    const origFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      record(input as RequestInfo);
      return origFetch(input, init);
    };
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: unknown[]) {
      record(url);
      return (origOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
    };
    const OrigWebSocket = globalThis.WebSocket;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WebSocket = function (url: string | URL, ...rest: unknown[]) {
      record(url);
      return new OrigWebSocket(url as string, ...(rest as [undefined]));
    };
    const OrigEventSource = globalThis.EventSource;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).EventSource = function (url: string | URL, ...rest: unknown[]) {
      record(url);
      return new OrigEventSource(url as string, ...(rest as [undefined]));
    };
    const origBeacon = navigator.sendBeacon?.bind(navigator);
    if (origBeacon) {
      navigator.sendBeacon = (url, data) => {
        record(url);
        return origBeacon(url, data);
      };
    }
  });
});

test("egress: full user journey makes zero cross-origin request attempts", async ({ page }) => {
  await bootApp(page);
  await enterDemoHousehold(page);
  await page.getByTestId("nav-cashflow").click();
  await page.getByTestId("spend-now").fill("90000");
  await page.getByTestId("spend-ret").fill("70000");
  await page.getByTestId("spend-essential").fill("65");
  await page.getByTestId("set-spending").getByRole("button").click();
  await page.getByTestId("income-label").fill("Salary");
  await page.getByTestId("income-kind").selectOption("salary");
  await page.getByTestId("income-amount").fill("130000");
  await page.getByTestId("add-income").getByRole("button").click();
  await page.getByTestId("nav-backup").click();
  await page.getByTestId("export-password").fill("egress-test");
  await page.getByTestId("export-button").click();
  await expectNetWorth(page, "$728,700");

  const jsAttempts = await page.evaluate(() => (globalThis as unknown as { __egressAttempts: string[] }).__egressAttempts);
  expect(jsAttempts, "app code attempted cross-origin egress").toEqual([]);
  expect(routeAborts, "a request to a foreign origin hit the network layer").toEqual([]);
});
