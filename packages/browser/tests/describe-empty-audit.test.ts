import { describe, expect, it } from "vite-plus/test";
import { describeEmptyAudit } from "../src/accessibility";

describe("describeEmptyAudit", () => {
  it("reports a clean page only when both engines ran", () => {
    expect(describeEmptyAudit([])).toBe("No accessibility violations found.");
  });

  it("refuses to call a page clean when an engine crashed", () => {
    const message = describeEmptyAudit(["axe-core"]);
    expect(message).toContain("axe-core");
    expect(message).toContain("not proven clean");
    expect(message).not.toContain("No accessibility violations found.");
  });

  it("names every engine that failed", () => {
    const message = describeEmptyAudit(["axe-core", "ibm-equal-access"]);
    expect(message).toContain("axe-core and ibm-equal-access");
    expect(message).toContain("those engines");
  });
});
