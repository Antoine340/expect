import { Browsers, Cookies, layerLive, browserKeyOf, Cookie } from "@expect/cookies";
import type { Browser as BrowserProfile } from "@expect/cookies";
import type { Locator, Page } from "playwright";
import { Array as Arr, Effect, Layer, Option, ServiceMap } from "effect";

import {
  AGENT_OVERLAY_CONTAINER_ID,
  CONTENT_ROLES,
  HEADLESS_CHROMIUM_ARGS,
  INTERACTIVE_ROLES,
  NAVIGATION_DETECT_DELAY_MS,
  OVERLAY_CONTAINER_ID,
  POST_NAVIGATION_SETTLE_MS,
  VIDEO_HEIGHT_PX,
  VIDEO_WIDTH_PX,
  SNAPSHOT_TIMEOUT_MS,
  CDP_CONNECT_TIMEOUT_MS,
} from "./constants";
import {
  BrowserLaunchError,
  CdpConnectionError,
  NavigationError,
  SnapshotTimeoutError,
} from "./errors";
import { toActionError } from "./utils/action-error";
import { compactTree } from "./utils/compact-tree";
import { createLocator } from "./utils/create-locator";
import { dropRootWrapper } from "./utils/drop-root-wrapper";
import { evaluateRuntime } from "./utils/evaluate-runtime";
import { parseAriaAttributes, stripAriaAttributes } from "./utils/parse-aria-attributes";
import { parseAriaLine } from "./utils/parse-aria-line";
import { computeSnapshotStats } from "./utils/snapshot-stats";
import { RUNTIME_CORE_SCRIPT, RUNTIME_OVERLAY_SCRIPT } from "./generated/runtime-script";
import type {
  AnnotatedScreenshotOptions,
  Annotation,
  CreatePageOptions,
  RefMap,
  SnapshotOptions,
} from "./types";
import type { ScrollContainerResult } from "./runtime/lib/scroll-detection";

const cookiesLayer = Layer.mergeAll(layerLive, Cookies.layer);

// HACK: playwright costs ~180ms to import and is only needed once a page is created, so the MCP
// handshake must not pay for it. Node caches the module, so later launches import it for free.
const loadPlaywright = Effect.promise(() => import("playwright"));

const shouldAssignRef = (role: string, name: string, interactive?: boolean): boolean => {
  if (INTERACTIVE_ROLES.has(role)) return true;
  if (interactive) return false;
  return CONTENT_ROLES.has(role) && name.length > 0;
};

const toBrowserLaunchError = (cause: unknown) =>
  new BrowserLaunchError({
    cause: cause instanceof Error ? cause.message : String(cause),
  });

const resolveDefaultBrowserContext = Effect.fn("Browser.resolveDefaultBrowserContext")(
  function* () {
    const browsers = yield* Browsers;
    const maybeDefault = yield* browsers
      .defaultBrowser()
      .pipe(
        Effect.catchTag("ListBrowsersError", () => Effect.succeed(Option.none<BrowserProfile>())),
      );

    return { preferredProfile: Option.getOrUndefined(maybeDefault) };
  },
  Effect.provide(layerLive),
);

const extractCookiesForProfile = Effect.fn("Browser.extractCookiesForProfile")(
  function* (cookiesService: typeof Cookies.Service, profile: BrowserProfile) {
    return yield* cookiesService.extract(profile);
  },
  Effect.catchTags({
    ExtractionError: () => Effect.succeed([]),
    PlatformError: Effect.die,
  }),
);

const dedupCookies = (cookies: readonly Cookie[]) =>
  Arr.dedupeWith(
    cookies,
    (cookieA, cookieB) =>
      cookieA.name === cookieB.name &&
      cookieA.domain === cookieB.domain &&
      cookieA.path === cookieB.path,
  );

const extractDefaultBrowserCookies = Effect.fn("Browser.extractDefaultBrowserCookies")(function* (
  url: string,
  preferredProfile: BrowserProfile | undefined,
) {
  if (!preferredProfile) return [];

  const cookiesService = yield* Cookies;
  const cookies = yield* extractCookiesForProfile(cookiesService, preferredProfile);
  return dedupCookies(cookies);
}, Effect.provide(cookiesLayer));

const extractCookiesForBrowserKeys = Effect.fn("Browser.extractCookiesForBrowserKeys")(function* (
  browserKeys: readonly string[],
) {
  const cookiesService = yield* Cookies;
  const browsers = yield* Browsers;
  const allProfiles = yield* browsers.list.pipe(
    Effect.catchTag("ListBrowsersError", () => Effect.succeed<BrowserProfile[]>([])),
  );

  const matchingProfiles = allProfiles.filter((profile) =>
    browserKeys.includes(browserKeyOf(profile)),
  );

  const results = yield* Effect.forEach(
    matchingProfiles,
    (profile) => extractCookiesForProfile(cookiesService, profile),
    { concurrency: "unbounded" },
  );

  return dedupCookies(results.flat());
}, Effect.provide(cookiesLayer));

const injectOverlayLabels = (page: Page, labels: Array<{ label: number; x: number; y: number }>) =>
  evaluateRuntime(page, "injectOverlayLabels", OVERLAY_CONTAINER_ID, labels);

// HACK: the overlay bundle is 44x the core one — React, react-dom and a stylesheet with an
// inlined font — and it is only ever displayed headed. Injecting it headless would run in
// every frame of the page under test and skew the very metrics performance_metrics reports.
const runtimeScriptsFor = (headed: boolean | undefined) =>
  headed ? [RUNTIME_CORE_SCRIPT, RUNTIME_OVERLAY_SCRIPT] : [RUNTIME_CORE_SCRIPT];

export class Browser extends ServiceMap.Service<Browser>()("@browser/Browser", {
  // oxlint-disable-next-line require-yield
  make: Effect.gen(function* () {
    const createPage = Effect.fn("Browser.createPage")(function* (
      url: string | undefined,
      options: CreatePageOptions = {},
    ) {
      const engine = options.browserType ?? "chromium";
      const cdpUrl = engine === "chromium" ? (options.cdpUrl ?? Option.none()) : Option.none();
      yield* Effect.annotateCurrentSpan({
        url: url ?? "about:blank",
        cdp: Option.isSome(cdpUrl),
        browserType: engine,
      });

      const playwright = yield* loadPlaywright;
      const browserType = playwright[engine];
      const browser =
        cdpUrl._tag === "Some"
          ? yield* Effect.tryPromise({
              try: () => playwright.chromium.connectOverCDP(cdpUrl.value),
              catch: (cause) =>
                new CdpConnectionError({
                  endpointUrl: cdpUrl.value,
                  cause: cause instanceof Error ? cause.message : String(cause),
                }),
            }).pipe(
              Effect.timeoutOrElse({
                duration: `${CDP_CONNECT_TIMEOUT_MS} millis`,
                onTimeout: () =>
                  new CdpConnectionError({
                    endpointUrl: cdpUrl.value,
                    cause: `Connection timed out after ${CDP_CONNECT_TIMEOUT_MS}ms`,
                  }).asEffect(),
              }),
            )
          : yield* Effect.tryPromise({
              try: () =>
                browserType.launch({
                  headless: !options.headed,
                  executablePath: options.executablePath,
                  args: engine === "chromium" && !options.headed ? HEADLESS_CHROMIUM_ARGS : [],
                }),
              catch: toBrowserLaunchError,
            });

      const setupPage = Effect.gen(function* () {
        const defaultBrowserContext =
          options.cookies === true
            ? yield* resolveDefaultBrowserContext()
            : { preferredProfile: undefined };

        const profileLocale =
          defaultBrowserContext.preferredProfile?._tag === "ChromiumBrowser"
            ? defaultBrowserContext.preferredProfile.locale
            : undefined;

        // HACK: Playwright rejects deviceScaleFactor alongside a null viewport, so pinning the
        // scale factor costs the headed window its own size — a fixed viewport instead.
        const usesRealWindow = Boolean(options.headed) && options.deviceScaleFactor === undefined;
        const contextOptions: Parameters<typeof browser.newContext>[0] = {
          ignoreHTTPSErrors: true,
          ...(usesRealWindow && { viewport: null }),
          ...(options.deviceScaleFactor !== undefined && {
            deviceScaleFactor: options.deviceScaleFactor,
          }),
        };
        const locale = options.locale ?? profileLocale;
        if (locale) {
          contextOptions.locale = locale;
        }
        if (options.videoOutputDir) {
          contextOptions.recordVideo = {
            dir: options.videoOutputDir,
            ...(!options.headed && {
              size: { width: VIDEO_WIDTH_PX, height: VIDEO_HEIGHT_PX },
            }),
          };
        }

        const isCdpConnected = Option.isSome(cdpUrl);
        const existingContexts = isCdpConnected ? browser.contexts() : [];
        const context =
          existingContexts.length > 0
            ? existingContexts[0]!
            : yield* Effect.tryPromise({
                try: () => browser.newContext(contextOptions),
                catch: toBrowserLaunchError,
              });

        const runtimeScripts = runtimeScriptsFor(options.headed);

        yield* Effect.forEach(runtimeScripts, (script) =>
          Effect.tryPromise({
            try: () => context.addInitScript(script),
            catch: toBrowserLaunchError,
          }),
        );

        if (isCdpConnected && existingContexts.length > 0) {
          const existingPages = context.pages();
          for (const existingPage of existingPages) {
            yield* Effect.forEach(runtimeScripts, (script) =>
              Effect.tryPromise({
                try: () => existingPage.evaluate(script),
                catch: toBrowserLaunchError,
              }).pipe(
                Effect.catchTag("BrowserLaunchError", (cause) =>
                  Effect.logDebug("Failed to inject runtime into existing CDP page", { cause }),
                ),
              ),
            );
          }
        }

        if (options.cookies && !isCdpConnected) {
          const cookies = Array.isArray(options.cookies)
            ? options.cookies
            : yield* extractDefaultBrowserCookies(
                url ?? "",
                defaultBrowserContext.preferredProfile,
              );
          yield* Effect.tryPromise({
            try: () => context.addCookies(cookies.map((cookie) => cookie.playwrightFormat)),
            catch: toBrowserLaunchError,
          });
        }

        const page = yield* Effect.tryPromise({
          try: () => context.newPage(),
          catch: toBrowserLaunchError,
        });

        if (url) {
          yield* Effect.tryPromise({
            try: () => page.goto(url, { waitUntil: options.waitUntil ?? "load" }),
            catch: (cause) =>
              new NavigationError({
                url,
                cause: cause instanceof Error ? cause.message : String(cause),
              }),
          });
        }

        return { browser, context, page, cleanup: Effect.void, isExternalBrowser: isCdpConnected };
      });

      return yield* setupPage.pipe(
        Effect.tapError(() => {
          if (Option.isSome(cdpUrl)) return Effect.void;
          return Effect.tryPromise(() => browser.close()).pipe(
            Effect.catchTag("UnknownError", () => Effect.void),
          );
        }),
      );
    });

    const NO_SCROLL_CONTAINERS: ScrollContainerResult[] = [];

    const takeAriaSnapshot = Effect.fn("Browser.takeAriaSnapshot")(function* (
      page: Page,
      options: SnapshotOptions,
    ) {
      const timeout = options.timeout ?? SNAPSHOT_TIMEOUT_MS;
      const selector = options.selector ?? "body";
      const useViewportAware = options.viewportAware ?? true;

      // HACK: unlike the default mode, ariaSnapshot({ mode: "ai" }) does not wait for the target
      // and throws at once when it is missing, so an explicit selector needs its own wait. It runs
      // before the viewport preparation, which would otherwise stay unrestored on failure.
      if (options.selector !== undefined) {
        yield* Effect.tryPromise({
          try: () => page.locator(selector).waitFor({ state: "attached", timeout }),
          catch: (cause) =>
            new SnapshotTimeoutError({
              selector,
              timeoutMs: timeout,
              cause: cause instanceof Error ? cause.message : String(cause),
            }),
        });
      }

      const scrollContainers: ScrollContainerResult[] = useViewportAware
        ? yield* evaluateRuntime(page, "prepareViewportSnapshot").pipe(
            Effect.catchCause((cause) =>
              Effect.logDebug("Viewport snapshot preparation failed, falling back to full tree", {
                cause,
              }).pipe(Effect.as(NO_SCROLL_CONTAINERS)),
            ),
          )
        : NO_SCROLL_CONTAINERS;

      const restore =
        scrollContainers.length > 0
          ? evaluateRuntime(page, "restoreViewportSnapshot").pipe(
              Effect.catchCause((cause) =>
                Effect.logDebug("Viewport snapshot restoration failed", { cause }),
              ),
            )
          : Effect.void;

      const rawTree = yield* Effect.ensuring(
        Effect.tryPromise({
          try: () =>
            page.locator(selector).ariaSnapshot({
              mode: "ai",
              boxes: options.boxes ?? false,
              // HACK: Playwright reads depth 0 as unlimited, the opposite of what a caller
              // asking for zero levels means, so it is clamped to the shallowest real tree.
              ...(options.depth !== undefined && { depth: Math.max(1, options.depth) }),
              timeout,
            }),
          catch: (cause) =>
            new SnapshotTimeoutError({
              selector,
              timeoutMs: timeout,
              cause: cause instanceof Error ? cause.message : String(cause),
            }),
        }),
        restore,
      );

      return { rawTree, scrollContainers };
    });

    const snapshot = Effect.fn("Browser.snapshot")(function* (
      page: Page,
      options: SnapshotOptions = {},
    ) {
      yield* Effect.annotateCurrentSpan({ selector: options.selector ?? "body" });

      const { rawTree, scrollContainers } = yield* takeAriaSnapshot(page, options);

      const refs: RefMap = {};
      const filteredLines: string[] = [];
      let refCount = 0;

      for (const line of dropRootWrapper(rawTree.split("\n"))) {
        const parsed = parseAriaLine(line);
        if (Option.isNone(parsed)) {
          if (!options.interactive) filteredLines.push(stripAriaAttributes(line, false));
          continue;
        }

        const { role, name } = parsed.value;
        const { ref, box, cursorPointer } = parseAriaAttributes(line);
        const isInteractive =
          INTERACTIVE_ROLES.has(role) || (Boolean(options.cursor) && cursorPointer);
        if (options.interactive && !isInteractive) continue;

        const surfaced =
          ref !== undefined && (isInteractive || shouldAssignRef(role, name, options.interactive));
        if (surfaced) {
          refCount++;
          refs[ref] = { role, name, ...(box && { box }) };
        }
        filteredLines.push(stripAriaAttributes(line, surfaced));
      }

      let tree = filteredLines.join("\n");
      if (options.interactive && refCount === 0) tree = "(no interactive elements)";
      if (options.compact) tree = compactTree(tree);

      const stats = computeSnapshotStats(tree, refs, scrollContainers);

      return { tree, refs, stats, locator: createLocator(page, refs) };
    });

    const act = Effect.fn("Browser.act")(function* (
      page: Page,
      ref: string,
      action: (locator: Locator) => Promise<void>,
      options?: SnapshotOptions,
    ) {
      yield* Effect.annotateCurrentSpan({ ref });
      const before = yield* snapshot(page, options);
      const locator = yield* before.locator(ref);
      yield* Effect.tryPromise({
        try: () => action(locator),
        catch: (error) => toActionError(error, ref),
      });
      return yield* snapshot(page, options);
    });

    const annotatedScreenshot = Effect.fn("Browser.annotatedScreenshot")(function* (
      page: Page,
      options: AnnotatedScreenshotOptions = {},
    ) {
      // HACK: the numbered labels are placed from the refs' bounding boxes, so this is the one
      // caller that needs them; every other snapshot pays neither the layout nor the payload.
      const snapshotResult = yield* snapshot(page, { ...options, boxes: true });

      const annotations: Annotation[] = [];
      const labelPositions: Array<{ label: number; x: number; y: number }> = [];

      let labelCounter = 0;

      for (const [ref, entry] of Object.entries(snapshotResult.refs)) {
        const box = entry.box;
        if (!box || box.width <= 0 || box.height <= 0) continue;

        labelCounter++;
        annotations.push({ label: labelCounter, ref, role: entry.role, name: entry.name });
        labelPositions.push({ label: labelCounter, x: box.x, y: box.y });
      }

      yield* evaluateRuntime(page, "hideAgentOverlay", AGENT_OVERLAY_CONTAINER_ID).pipe(
        Effect.catchCause((cause) =>
          Effect.logDebug("Failed to hide agent overlay for capture", { cause }),
        ),
      );
      yield* injectOverlayLabels(page, labelPositions);
      return yield* Effect.ensuring(
        Effect.tryPromise({
          try: () => page.screenshot({ fullPage: options.fullPage, scale: "css" }),
          catch: toBrowserLaunchError,
        }).pipe(Effect.map((screenshotBuffer) => ({ screenshot: screenshotBuffer, annotations }))),
        // HACK: overlay removal is best-effort cleanup — evaluateRuntime uses Effect.promise which defects on failure
        evaluateRuntime(page, "removeOverlay", OVERLAY_CONTAINER_ID).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Failed to remove annotation overlay", { cause }),
          ),
          Effect.tap(() =>
            evaluateRuntime(page, "showAgentOverlay", AGENT_OVERLAY_CONTAINER_ID).pipe(
              Effect.catchCause((cause) =>
                Effect.logDebug("Failed to show agent overlay after capture", { cause }),
              ),
            ),
          ),
        ),
      );
    });

    const waitForNavigationSettle = Effect.fn("Browser.waitForNavigationSettle")(function* (
      page: Page,
      urlBefore: string,
    ) {
      yield* Effect.tryPromise({
        try: () =>
          page.waitForURL((url) => url.toString() !== urlBefore, {
            timeout: NAVIGATION_DETECT_DELAY_MS,
            waitUntil: "commit",
          }),
        catch: toBrowserLaunchError,
      }).pipe(Effect.catchTag("BrowserLaunchError", () => Effect.void));
      if (page.url() !== urlBefore) {
        yield* Effect.tryPromise(() => page.waitForLoadState("domcontentloaded")).pipe(
          Effect.catchTag("UnknownError", () => Effect.void),
        );
        yield* Effect.tryPromise({
          try: () => page.waitForTimeout(POST_NAVIGATION_SETTLE_MS),
          catch: toBrowserLaunchError,
        });
      }
    });

    const preExtractCookies = Effect.fn("Browser.preExtractCookies")(function* (
      browserKeys?: readonly string[],
    ) {
      if (browserKeys && browserKeys.length > 0) {
        return yield* extractCookiesForBrowserKeys(browserKeys);
      }
      const { preferredProfile } = yield* resolveDefaultBrowserContext();
      return yield* extractDefaultBrowserCookies("", preferredProfile);
    });

    const resolveProfile = Effect.fn("Browser.resolveProfile")(function* (profileName: string) {
      const browsers = yield* Browsers;
      const allBrowsers = yield* browsers.list;
      const chromiumProfile = allBrowsers.find(
        (browser) => browser._tag === "ChromiumBrowser" && browser.profileName === profileName,
      );
      return chromiumProfile?._tag === "ChromiumBrowser" ? chromiumProfile : undefined;
    }, Effect.provide(layerLive));

    const resolveProfilePath = Effect.fn("Browser.resolveProfilePath")(function* (
      profileName: string,
    ) {
      const chromiumProfile = yield* resolveProfile(profileName);
      return chromiumProfile?.profilePath;
    }, Effect.provide(layerLive));

    return {
      createPage,
      snapshot,
      act,
      annotatedScreenshot,
      waitForNavigationSettle,
      preExtractCookies,
      resolveProfile,
      resolveProfilePath,
    } as const;
  }),
}) {
  static layer = Layer.effect(this)(this.make);
}

export const runBrowser = <A>(
  effect: (browser: typeof Browser.Service) => Effect.Effect<A, unknown>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const browser = yield* Browser;
      return yield* effect(browser);
    }).pipe(Effect.provide(Browser.layer)),
  );
