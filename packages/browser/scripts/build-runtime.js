import { context } from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";

const esmRequire = createRequire(import.meta.url);

const watchMode = process.argv.includes("--watch");

// The core bundle installs __EXPECT_RUNTIME__ and is injected into every page. The overlay
// bundle carries React and the stylesheet, ships only in headed mode, and merges into the
// object the core already installed — so it must be injected after it.
const BUNDLES = [
  {
    entry: "src/runtime/core-runtime.ts",
    globalName: "__EXPECT_RUNTIME__",
    constName: "RUNTIME_CORE_SCRIPT",
    typeNamespace: "CoreRuntime",
    install: "globalThis.__EXPECT_RUNTIME__ = __EXPECT_RUNTIME__;\n",
  },
  {
    entry: "src/runtime/overlay-runtime.ts",
    globalName: "__EXPECT_OVERLAY_RUNTIME__",
    constName: "RUNTIME_OVERLAY_SCRIPT",
    typeNamespace: "OverlayRuntime",
    install:
      "globalThis.__EXPECT_RUNTIME__ = Object.assign(globalThis.__EXPECT_RUNTIME__ || {}, __EXPECT_OVERLAY_RUNTIME__);\n",
  },
];

const extractExportedFunctionNames = (source) => {
  const names = [];

  const constRegex = /export\s+const\s+(\w+)\s*=/g;
  let match;
  while ((match = constRegex.exec(source)) !== null) {
    names.push(match[1]);
  }

  const reExportRegex = /export\s*\{([^}]+)\}/g;
  while ((match = reExportRegex.exec(source)) !== null) {
    for (const token of match[1].split(",")) {
      const trimmed = token.trim();
      if (!trimmed || trimmed.startsWith("type ")) continue;
      names.push(trimmed);
    }
  }

  return names;
};

const generateRuntimeTypes = () => {
  const imports = BUNDLES.map(
    (bundle) =>
      `import type * as ${bundle.typeNamespace} from "../runtime/${path.basename(bundle.entry, ".ts")}";`,
  );
  const fields = BUNDLES.flatMap((bundle) =>
    extractExportedFunctionNames(fs.readFileSync(bundle.entry, "utf-8")).map(
      (name) => `  ${name}: typeof ${bundle.typeNamespace}.${name};`,
    ),
  );

  return [...imports, ``, `export interface ExpectRuntime {`, ...fields, `}`, ``].join("\n");
};

const emittedScripts = new Map();

const writeGeneratedFiles = () => {
  if (emittedScripts.size < BUNDLES.length) return;

  fs.mkdirSync("src/generated", { recursive: true });
  fs.writeFileSync(
    "src/generated/runtime-script.ts",
    BUNDLES.map(
      (bundle) =>
        `export const ${bundle.constName} = ${JSON.stringify(emittedScripts.get(bundle.constName))};\n`,
    ).join(""),
  );
  fs.writeFileSync("src/generated/runtime-types.ts", generateRuntimeTypes());
};

const emitPlugin = (bundle) => ({
  name: `emit-${bundle.constName}`,
  setup: (build) => {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;
      emittedScripts.set(bundle.constName, `${result.outputFiles[0].text}\n${bundle.install}`);
      writeGeneratedFiles();
    });
  },
});

const cssTextPlugin = {
  name: "css-text",
  setup: (build) => {
    build.onResolve({ filter: /\.css$/ }, (args) => {
      const isRelative = args.path.startsWith(".") || args.path.startsWith("/");
      const resolved = isRelative
        ? path.resolve(args.resolveDir, args.path)
        : esmRequire.resolve(args.path, { paths: [args.resolveDir] });
      return { path: resolved, namespace: "css-text" };
    });
    build.onLoad({ namespace: "css-text", filter: /.*/ }, (args) => ({
      contents: `export default ${JSON.stringify(fs.readFileSync(args.path, "utf-8"))};`,
      loader: "js",
    }));
  },
};

const contexts = await Promise.all(
  BUNDLES.map((bundle) =>
    context({
      entryPoints: [bundle.entry],
      bundle: true,
      format: "iife",
      globalName: bundle.globalName,
      write: false,
      minify: true,
      target: "es2020",
      jsx: "automatic",
      plugins: [cssTextPlugin, emitPlugin(bundle)],
    }),
  ),
);

if (watchMode) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  for (const ctx of contexts) {
    await ctx.rebuild();
  }
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
}
