import * as http from "node:http";
import { Effect } from "effect";
import { describe, it, expect, beforeAll, afterAll } from "vite-plus/test";
import type { Browser as PlaywrightBrowser, Page } from "playwright";
import { Browser, runBrowser } from "../src/browser";

const manyLinks = (count: number) =>
  Array.from({ length: count }, (_, index) => `<a href="#l${index}">Link ${index}</a>`).join("");

const PAGES: Record<string, string> = {
  "/links": `<html><body>${manyLinks(40)}</body></html>`,
  "/mixed": `<html><body><h1>Title</h1>${manyLinks(30)}<button>Send</button></body></html>`,
  "/duplicates": `<html><body><a href="#a">Go</a><a href="#b">Go</a><a href="#c">Go</a></body></html>`,
};

const startServer = async () => {
  const server = http.createServer((request, response) => {
    const body = PAGES[request.url ?? ""] ?? "<html><body>not found</body></html>";
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no server address");
  return { server, origin: `http://127.0.0.1:${address.port}` };
};

const annotate = (page: Page) =>
  Effect.gen(function* () {
    const browser = yield* Browser;
    return yield* browser.annotatedScreenshot(page);
  }).pipe(Effect.provide(Browser.layer));

const snapshotPage = (page: Page) =>
  Effect.gen(function* () {
    const browser = yield* Browser;
    return yield* browser.snapshot(page);
  }).pipe(Effect.provide(Browser.layer));

describe("annotatedScreenshot", () => {
  let server: http.Server;
  let origin: string;
  let playwrightBrowser: PlaywrightBrowser;
  let page: Page;

  beforeAll(async () => {
    ({ server, origin } = await startServer());
    const session = await runBrowser((browser) => browser.createPage(`${origin}/links`));
    playwrightBrowser = session.browser;
    page = session.page;
  });

  afterAll(async () => {
    await playwrightBrowser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("numbers labels contiguously in snapshot order", async () => {
    await page.goto(`${origin}/links`);

    const result = await Effect.runPromise(annotate(page));
    const labels = result.annotations.map((annotation) => annotation.label);

    expect(labels.length).toBeGreaterThan(1);
    expect(labels).toEqual(labels.map((_, index) => index + 1));
  });

  it("keeps every annotation aligned with its own ref", async () => {
    await page.goto(`${origin}/mixed`);

    const snapshot = await Effect.runPromise(snapshotPage(page));
    const result = await Effect.runPromise(annotate(page));

    expect(result.annotations.length).toBeGreaterThan(1);
    for (const annotation of result.annotations) {
      const entry = snapshot.refs[annotation.ref];
      expect(entry).toBeDefined();
      expect(annotation.role).toBe(entry.role);
      expect(annotation.name).toBe(entry.name);
    }
  });

  it("requests bounding boxes for itself but not for a plain snapshot", async () => {
    await page.goto(`${origin}/links`);

    const snapshot = await Effect.runPromise(snapshotPage(page));
    expect(Object.keys(snapshot.refs).length).toBeGreaterThan(1);
    expect(Object.values(snapshot.refs).every((entry) => entry.box === undefined)).toBe(true);

    const result = await Effect.runPromise(annotate(page));
    expect(result.annotations.length).toBeGreaterThan(1);
  });

  it("resolves duplicate-named elements to distinct annotations", async () => {
    await page.goto(`${origin}/duplicates`);

    const result = await Effect.runPromise(annotate(page));
    const goAnnotations = result.annotations.filter((annotation) => annotation.name === "Go");

    expect(goAnnotations).toHaveLength(3);
    expect(new Set(goAnnotations.map((annotation) => annotation.ref)).size).toBe(3);
  });
});
