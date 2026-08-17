import { Effect } from "effect";
import type { Page } from "playwright";
import { RefNotFoundError } from "../errors";
import type { RefMap } from "../types";

export const createLocator = (page: Page, refs: RefMap) =>
  Effect.fn("Browser.resolveRef")(function* (ref: string) {
    if (!refs[ref]) {
      return yield* new RefNotFoundError({ ref, availableRefs: Object.keys(refs) });
    }
    return page.locator(`aria-ref=${ref}`);
  });
