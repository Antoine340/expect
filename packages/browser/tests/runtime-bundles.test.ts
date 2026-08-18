import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { chromium } from "playwright";
import type { Browser as PlaywrightBrowser } from "playwright";
import { RUNTIME_CORE_SCRIPT, RUNTIME_OVERLAY_SCRIPT } from "../src/generated/runtime-script";

const CORE_METHOD = "prepareViewportSnapshot";
const OVERLAY_METHOD = "initAgentOverlay";

const runtimeMethods = async (playwrightBrowser: PlaywrightBrowser, scripts: string[]) => {
  const context = await playwrightBrowser.newContext();
  for (const script of scripts) {
    await context.addInitScript(script);
  }
  const page = await context.newPage();
  await page.setContent("<html><body>runtime</body></html>");
  const methods = await page.evaluate(() => {
    const runtime = Reflect.get(globalThis, "__EXPECT_RUNTIME__");
    if (!runtime || typeof runtime !== "object") return [];
    return Object.keys(runtime).filter((key) => typeof Reflect.get(runtime, key) === "function");
  });
  await context.close();
  return methods;
};

describe("runtime bundles", () => {
  let playwrightBrowser: PlaywrightBrowser;

  beforeAll(async () => {
    playwrightBrowser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await playwrightBrowser.close();
  });

  it("keeps the overlay out of the core bundle", async () => {
    const methods = await runtimeMethods(playwrightBrowser, [RUNTIME_CORE_SCRIPT]);

    expect(methods).toContain(CORE_METHOD);
    expect(methods).not.toContain(OVERLAY_METHOD);
  });

  it("merges the overlay bundle into the runtime the core installed", async () => {
    const methods = await runtimeMethods(playwrightBrowser, [
      RUNTIME_CORE_SCRIPT,
      RUNTIME_OVERLAY_SCRIPT,
    ]);

    expect(methods).toContain(CORE_METHOD);
    expect(methods).toContain(OVERLAY_METHOD);
  });

  it("keeps React and the overlay stylesheet out of every page", () => {
    expect(RUNTIME_CORE_SCRIPT).not.toContain("react");
    expect(RUNTIME_CORE_SCRIPT.length * 10).toBeLessThan(RUNTIME_OVERLAY_SCRIPT.length);
  });
});
