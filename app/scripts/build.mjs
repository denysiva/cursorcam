/**
 * Produce the two things the deploy consumes:
 *
 *   dist/worker/index.js  — the bundled Worker (entry + room + logic)
 *   dist/client/**        — the static files, served before the Worker runs:
 *                           everything in public/ plus the bundled client app
 *                           (client/main.jsx → app.js, client/styles → app.css)
 *
 * The deploy discovers the entry itself and rewrites `wrangler.jsonc` from
 * trusted metadata, so these PATHS are the contract — not this repo's config.
 * `cloudflare:workers` stays external: it is a runtime module, not a package.
 */

import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(app, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

function check(result, what) {
  if (result.success) return;
  for (const log of result.logs) console.error(log);
  throw new Error(`${what} bundle failed`);
}

check(
  await Bun.build({
    entrypoints: [resolve(app, "src/worker.ts")],
    outdir: resolve(dist, "worker"),
    naming: "index.js",
    target: "browser",
    format: "esm",
    // Keep the runtime module unresolved; bundling it would break the DO class.
    external: ["cloudflare:workers"],
    // Readable stack traces in Workers Logs are worth more than a few saved KB.
    minify: false,
    sourcemap: "none",
  }),
  "worker",
);

await cp(resolve(app, "public"), resolve(dist, "client"), { recursive: true });

check(
  await Bun.build({
    entrypoints: [resolve(app, "client/main.jsx")],
    outdir: resolve(dist, "client"),
    naming: "app.js",
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap: "none",
  }),
  "client",
);

// The stylesheet is plain CSS split into a few files; ship it as one request.
const cssDir = resolve(app, "client/styles");
const sheets = (await readdir(cssDir)).filter((f) => f.endsWith(".css")).sort();
let css = "";
for (const file of sheets) css += `/* ${file} */\n${await readFile(resolve(cssDir, file), "utf8")}\n`;
await writeFile(resolve(dist, "client/app.css"), css);

// Cache-bust the two bundles: phones keep a tab open for days.
const stamp = Date.now().toString(36);
const indexPath = resolve(dist, "client/index.html");
const html = await readFile(indexPath, "utf8");
await writeFile(indexPath, html.replaceAll("__BUILD__", stamp));

console.log("built dist/worker/index.js + dist/client/");
