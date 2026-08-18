import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpRuntime } from "../src/mcp/runtime";
import { createBrowserMcpServer } from "../src/mcp/server";
import { MAX_STRINGIFY_LENGTH } from "../src/mcp/constants";

const TEST_HTML = `<!DOCTYPE html>
<html>
<body>
  <h1>Test Page</h1>
  <input type="text" aria-label="Email" />
  <button>Submit</button>
  <p id="result">Waiting</p>
  <script>
    document.querySelector('button').addEventListener('click', () => {
      document.getElementById('result').textContent = 'Clicked: ' + document.querySelector('input').value;
    });
  </script>
</body>
</html>`;

const BIG_PAGE_HEADINGS = 500;
const BIG_TEST_HTML = `<!DOCTYPE html>
<html><body>${Array.from(
  { length: BIG_PAGE_HEADINGS },
  (_unused, index) => `<h2>Heading number ${index} with enough text to grow the tree</h2>`,
).join("")}<button>Last Button</button></body></html>`;

let testServerUrl: string;
let httpServer: ReturnType<typeof http.createServer>;
let previousNoTelemetry: string | undefined;

let mcpClient: Client;
let mcpCleanup: () => Promise<void>;

const callTool = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await mcpClient.callTool({ name, arguments: args });
  return result;
};

const textContent = (result: Awaited<ReturnType<typeof callTool>>): string => {
  const textItem = (result.content as Array<{ type: string; text?: string }>).find(
    (item) => item.type === "text",
  );
  return textItem?.text ?? "";
};

const refForName = (tree: string, name: string): string => {
  const match = new RegExp(`"${name}"[^\\n]*\\[ref=(e\\d+)\\]`).exec(tree);
  expect(match, `no ref for "${name}" in tree`).toBeTruthy();
  return match![1];
};

const refForRole = (tree: string, role: string): string => {
  const match = new RegExp(`- ${role}[^\\n]*\\[ref=(e\\d+)\\]`).exec(tree);
  expect(match, `no ref for role ${role} in tree`).toBeTruthy();
  return match![1];
};

beforeAll(async () => {
  previousNoTelemetry = process.env.NO_TELEMETRY;
  process.env.NO_TELEMETRY = "1";
  httpServer = http.createServer((request, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(request.url === "/big" ? BIG_TEST_HTML : TEST_HTML);
  });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  testServerUrl = `http://127.0.0.1:${port}`;

  const { server } = createBrowserMcpServer(McpRuntime);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  mcpClient = new Client({ name: "test-client", version: "0.0.1" });
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  mcpCleanup = async () => {
    await mcpClient.close();
    await server.close();
  };
});

afterAll(async () => {
  await callTool("close").catch(() => {});
  await mcpCleanup();
  httpServer.close();
  if (previousNoTelemetry === undefined) {
    delete process.env.NO_TELEMETRY;
  } else {
    process.env.NO_TELEMETRY = previousNoTelemetry;
  }
});

describe("MCP server tools", () => {
  it("lists all tools", async () => {
    const tools = await mcpClient.listTools();
    const toolNames = tools.tools.map((tool) => tool.name).sort();
    expect(toolNames).toEqual([
      "accessibility_audit",
      "close",
      "console_logs",
      "network_requests",
      "open",
      "performance_metrics",
      "playwright",
      "screenshot",
    ]);
  });

  it("createBrowserMcpServer returns tool handles with handlers", () => {
    const { tools } = createBrowserMcpServer(McpRuntime);
    const expectedToolNames = [
      "open",
      "playwright",
      "screenshot",
      "console_logs",
      "network_requests",
      "performance_metrics",
      "accessibility_audit",
      "close",
    ];
    expect(Object.keys(tools).sort()).toEqual(expectedToolNames.sort());
    for (const tool of Object.values(tools)) {
      expect(typeof tool.handler).toBe("function");
    }
  });

  it("open → snapshot → playwright ref click → verify", async () => {
    const openResult = await callTool("open", { url: testServerUrl });
    expect(textContent(openResult)).toContain("Opened");

    const snapshotResult = await callTool("screenshot", { mode: "snapshot" });
    const snapshotText = textContent(snapshotResult);
    const snapshotData = JSON.parse(snapshotText);
    expect(snapshotData.tree).toContain("Submit");
    expect(snapshotData.tree).toContain("Email");

    const emailRef = refForName(snapshotData.tree, "Email");
    const submitRef = refForName(snapshotData.tree, "Submit");

    const fillResult = await callTool("playwright", {
      code: `await ref('${emailRef}').fill('hello@test.com');`,
    });
    expect(textContent(fillResult)).toBe("OK");

    const clickResult = await callTool("playwright", {
      code: `await ref('${submitRef}').click();`,
    });
    expect(textContent(clickResult)).toBe("OK");

    const verifyResult = await callTool("playwright", {
      code: `return await page.locator('#result').innerText();`,
    });
    const verifyData = JSON.parse(textContent(verifyResult));
    expect(verifyData.result).toContain("Clicked: hello@test.com");
  });

  it("screenshot modes return correct content types", async () => {
    const screenshotResult = await callTool("screenshot", { mode: "screenshot" });
    const imageItem = (screenshotResult.content as Array<{ type: string }>).find(
      (item) => item.type === "image",
    );
    expect(imageItem).toBeDefined();

    const snapshotResult = await callTool("screenshot", { mode: "snapshot" });
    const snapshotText = textContent(snapshotResult);
    const snapshotData = JSON.parse(snapshotText);
    expect(snapshotData).toHaveProperty("tree");
    expect(snapshotData).toHaveProperty("stats");
    expect(snapshotData).not.toHaveProperty("refs");

    const annotatedResult = await callTool("screenshot", { mode: "annotated" });
    const annotatedImage = (annotatedResult.content as Array<{ type: string }>).find(
      (item) => item.type === "image",
    );
    const annotatedText = (annotatedResult.content as Array<{ type: string }>).find(
      (item) => item.type === "text",
    );
    expect(annotatedImage).toBeDefined();
    expect(annotatedText).toBeDefined();
  });

  it("playwright returns error text on failure instead of throwing", async () => {
    const result = await callTool("playwright", {
      code: `throw new Error('intentional test error');`,
    });
    expect(textContent(result)).toContain("Error: intentional test error");
  });

  it("close flushes the session", async () => {
    const closeResult = await callTool("close");
    expect(textContent(closeResult)).toContain("Browser closed");

    const doubleClose = await callTool("close");
    expect(textContent(doubleClose)).toContain("No browser open");
  });

  it("playwright snapshotAfter returns fresh snapshot alongside result", async () => {
    await callTool("open", { url: testServerUrl });
    await callTool("screenshot", { mode: "snapshot" });

    const result = await callTool("playwright", {
      code: `return await page.title();`,
      snapshotAfter: true,
    });
    const data = JSON.parse(textContent(result));
    expect(data).toHaveProperty("result");
    expect(data).toHaveProperty("resultFile");
    expect(data).toHaveProperty("snapshot");
    expect(data.snapshot).toHaveProperty("tree");
    expect(data.snapshot).toHaveProperty("stats");
    expect(data.snapshot).not.toHaveProperty("refs");
    expect(data.snapshot.tree).toContain("Submit");
    await callTool("close");
  });

  it("playwright snapshotAfter with no return value omits result key", async () => {
    await callTool("open", { url: testServerUrl });
    const snapshot = await callTool("screenshot", { mode: "snapshot" });
    const buttonRef = refForRole(JSON.parse(textContent(snapshot)).tree, "button");

    const result = await callTool("playwright", {
      code: `await ref(${JSON.stringify(buttonRef)}).click();`,
      snapshotAfter: true,
    });
    const data = JSON.parse(textContent(result));
    expect(data).not.toHaveProperty("result");
    expect(data).toHaveProperty("snapshot");
    expect(data.snapshot).toHaveProperty("tree");
    await callTool("close");
  });

  it("playwright without snapshotAfter returns result with file path", async () => {
    await callTool("open", { url: testServerUrl });
    const result = await callTool("playwright", {
      code: `return 42;`,
    });
    const data = JSON.parse(textContent(result));
    expect(data.result).toBe(42);
    expect(data.resultFile).toBeDefined();
    expect(typeof data.resultFile).toBe("string");
    expect(data.resultFile).toContain("playwright-results");
    await callTool("close");
  });

  it("ref() throws when no snapshot has been taken", async () => {
    await callTool("open", { url: testServerUrl });
    const result = await callTool("playwright", {
      code: `await ref('e1').click();`,
    });
    expect(textContent(result)).toContain("No snapshot taken yet");
    await callTool("close");
  });

  it("open tool accepts browser parameter in schema", async () => {
    const tools = await mcpClient.listTools();
    const openTool = tools.tools.find((tool) => tool.name === "open");
    expect(openTool).toBeDefined();
    const schema = openTool!.inputSchema as { properties?: Record<string, unknown> };
    expect(schema.properties).toHaveProperty("browser");
  });

  it("open with browser=webkit launches a webkit session", async () => {
    const openResult = await callTool("open", { url: testServerUrl, browser: "webkit" });
    const text = textContent(openResult);

    if (text.includes("Executable doesn't exist")) {
      await callTool("close").catch(() => {});
      return;
    }

    expect(text).toContain("Opened");
    expect(text).toContain("[webkit]");

    const snapshotResult = await callTool("screenshot", { mode: "snapshot" });
    const snapshotData = JSON.parse(textContent(snapshotResult));
    expect(snapshotData.tree).toContain("Test Page");

    await callTool("close");
  });

  it("switches from chromium to webkit via close → open", async () => {
    const chromiumResult = await callTool("open", { url: testServerUrl });
    expect(textContent(chromiumResult)).toContain("Opened");
    expect(textContent(chromiumResult)).not.toContain("[webkit]");

    const chromiumSnapshot = await callTool("screenshot", { mode: "snapshot" });
    expect(JSON.parse(textContent(chromiumSnapshot)).tree).toContain("Test Page");

    await callTool("close");

    const webkitResult = await callTool("open", { url: testServerUrl, browser: "webkit" });
    const webkitText = textContent(webkitResult);

    if (webkitText.includes("Executable doesn't exist")) {
      await callTool("close").catch(() => {});
      return;
    }

    expect(webkitText).toContain("Opened");
    expect(webkitText).toContain("[webkit]");

    const webkitSnapshot = await callTool("screenshot", { mode: "snapshot" });
    expect(JSON.parse(textContent(webkitSnapshot)).tree).toContain("Test Page");

    await callTool("close");
  });

  it("open with browser=firefox launches a firefox session", async () => {
    const openResult = await callTool("open", { url: testServerUrl, browser: "firefox" });
    const text = textContent(openResult);

    if (text.includes("Executable doesn't exist")) {
      await callTool("close").catch(() => {});
      return;
    }

    expect(text).toContain("Opened");
    expect(text).toContain("[firefox]");

    const snapshotResult = await callTool("screenshot", { mode: "snapshot" });
    const snapshotData = JSON.parse(textContent(snapshotResult));
    expect(snapshotData.tree).toContain("Test Page");

    await callTool("close");
  });

  it("navigates within an existing session instead of relaunching", async () => {
    await callTool("open", { url: testServerUrl });

    const navResult = await callTool("open", { url: testServerUrl, browser: "webkit" });
    expect(textContent(navResult)).toContain("Navigated");
    expect(textContent(navResult)).not.toContain("[webkit]");

    await callTool("close");
  });
});

describe("browser context fidelity", () => {
  it("serves the requested locale to the page", async () => {
    await callTool("open", { url: testServerUrl, locale: "fr-FR" });
    const result = await callTool("playwright", {
      code: `return { language: await page.evaluate(() => navigator.language) };`,
    });

    expect(JSON.parse(textContent(result)).result.language).toBe("fr-FR");
    await callTool("close");
  });

  it("applies the requested device scale factor", async () => {
    await callTool("open", { url: testServerUrl, deviceScaleFactor: 2 });
    const result = await callTool("playwright", {
      code: `return { ratio: await page.evaluate(() => devicePixelRatio) };`,
    });

    expect(JSON.parse(textContent(result)).result.ratio).toBe(2);
    await callTool("close");
  });

  it("defaults to a scale factor of 1 without the option", async () => {
    await callTool("open", { url: testServerUrl });
    const result = await callTool("playwright", {
      code: `return { ratio: await page.evaluate(() => devicePixelRatio) };`,
    });

    expect(JSON.parse(textContent(result)).result.ratio).toBe(1);
    await callTool("close");
  });
});

describe("snapshot payload", () => {
  it("delivers the whole tree instead of clipping it at the stringify limit", async () => {
    await callTool("open", { url: `${testServerUrl}/big`, waitUntil: "domcontentloaded" });
    const text = textContent(await callTool("screenshot", { mode: "snapshot", fullPage: true }));
    const { tree, stats } = JSON.parse(text);

    expect(tree.length).toBeGreaterThan(MAX_STRINGIFY_LENGTH);
    expect(tree).not.toContain("truncated");
    expect(tree).toContain(`Heading number ${BIG_PAGE_HEADINGS - 1}`);
    expect(tree).toContain("Last Button");
    expect(stats.characters).toBe(tree.length);

    await callTool("close");
  });

  it("still clips oversized values returned by playwright code", async () => {
    await callTool("open", { url: testServerUrl });
    const result = await callTool("playwright", {
      code: `return "x".repeat(${MAX_STRINGIFY_LENGTH + 1000});`,
    });
    expect(textContent(result)).toContain("truncated");

    await callTool("close");
  });
});

describe("page observability", () => {
  it("reports uncaught exceptions and unhandled rejections in console_logs", async () => {
    await callTool("open", { url: testServerUrl });
    await callTool("playwright", {
      code: `await page.evaluate(() => {
        setTimeout(() => { throw new Error('uncaught boom'); }, 0);
        setTimeout(() => { Promise.reject(new Error('rejected boom')); }, 0);
      });
      await page.waitForTimeout(300);`,
    });

    const logs = JSON.parse(textContent(await callTool("console_logs", { type: "error" })));
    const texts = logs.messages.map((message: { text: string }) => message.text).join("\n");
    expect(texts).toContain("uncaught boom");
    expect(texts).toContain("rejected boom");

    await callTool("close");
  });

  it("records the browser reason for a request that never gets a response", async () => {
    await callTool("open", { url: testServerUrl });
    await callTool("playwright", {
      code: `await page.evaluate(() => fetch('http://127.0.0.1:1/unreachable').catch(() => {}));
      await page.waitForTimeout(500);`,
    });

    const requests = JSON.parse(
      textContent(await callTool("network_requests", { url: "unreachable" })),
    );
    const entry = requests.requests.find((request: { url: string }) =>
      request.url.includes("unreachable"),
    );
    expect(entry).toBeDefined();
    expect(entry.failure).toBeTruthy();
    expect(requests.issues.failedRequests).toHaveLength(1);
    expect(requests.issues.failedRequests[0].failure).toBe(entry.failure);

    await callTool("close");
  });
});
