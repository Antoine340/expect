import { Effect } from "effect";
import { describe, it, expect, beforeAll, afterAll } from "vite-plus/test";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { createLocator } from "../src/utils/create-locator";
import type { RefMap } from "../src/types";

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

const snapshotRefs = async (page: Page) => {
  const tree = await page.locator("body").ariaSnapshot({ mode: "ai" });
  const refs: RefMap = {};
  for (const line of tree.split("\n")) {
    const ref = /\[ref=(e\d+)\]/.exec(line)?.[1];
    const parsed = /- ([a-zA-Z]+)(?:\s+"([^"]*)")?/.exec(line);
    if (ref && parsed) refs[ref] = { role: parsed[1], name: parsed[2] ?? "" };
  }
  return refs;
};

describe("createLocator", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    page = await context.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  it("resolves a ref to the element the snapshot described", async () => {
    await page.setContent(`<html><body><button>Click</button></body></html>`);

    const refs = await snapshotRefs(page);
    const buttonRef = Object.keys(refs).find((key) => refs[key].name === "Click");
    expect(buttonRef).toBeDefined();

    const resolved = await run(createLocator(page, refs)(buttonRef!));
    expect(await resolved.textContent()).toBe("Click");
  });

  it("distinguishes identically named elements without disambiguation", async () => {
    await page.setContent(
      `<html><body>
        <button onclick="document.title='first'">OK</button>
        <button onclick="document.title='second'">OK</button>
      </body></html>`,
    );

    const refs = await snapshotRefs(page);
    const okRefs = Object.keys(refs).filter((key) => refs[key].name === "OK");
    expect(okRefs).toHaveLength(2);

    const locator = createLocator(page, refs);
    await (await run(locator(okRefs[1]))).click();
    expect(await page.title()).toBe("second");

    await (await run(locator(okRefs[0]))).click();
    expect(await page.title()).toBe("first");
  });

  it("resolves an element whose accessible name getByRole cannot match", async () => {
    await page.setContent(`<html><body><a href="#a"><span>&#8593;</span></a></body></html>`);

    const refs = await snapshotRefs(page);
    const linkRef = Object.keys(refs).find((key) => refs[key].role === "link");
    expect(linkRef).toBeDefined();

    const resolved = await run(createLocator(page, refs)(linkRef!));
    expect(await resolved.getAttribute("href")).toBe("#a");
  });

  it("fails for an unknown ref and lists the available ones", async () => {
    const refs: RefMap = {
      e1: { role: "button", name: "A" },
      e2: { role: "link", name: "B" },
    };
    const locator = createLocator(page, refs);

    await expect(run(locator("e99"))).rejects.toThrow('Unknown ref "e99"');
    await expect(run(locator("e99"))).rejects.toThrow("available refs: e1, e2");
  });

  it("fails with an empty-page hint when no refs exist", async () => {
    const locator = createLocator(page, {});

    await expect(run(locator("e1"))).rejects.toThrow("no refs available");
    await expect(run(locator("e1"))).rejects.toThrow("page may be empty");
  });
});
