import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const shareToken = "RzPVaKQLfuASnq23IZYedOR4hMsA7QmU";
const sourcePath = new URL("./vidger-branding-live-proof-v4.mjs", import.meta.url);
let source = await readFile(sourcePath, "utf8");

source = source.replace(
  /const SHARE_URL = `\$\{BASE_URL\}\/\?_vercel_share=[^`]+`;/,
  `const SHARE_TOKEN = "${shareToken}";\nconst SHARE_URL = \`${"${BASE_URL}"}/?_vercel_share=${shareToken}\`;`,
);

const originalRequest = 'const response = await page.request.fetch(url, { timeout: 360_000, ...options });';
const protectedRequest = [
  'const target = new URL(url);',
  'if (target.origin === new URL(BASE_URL).origin && !target.searchParams.has("_vercel_share")) target.searchParams.set("_vercel_share", SHARE_TOKEN);',
  'const response = await page.request.fetch(target.toString(), { timeout: 360_000, ...options });',
].join("\n  ");
if (!source.includes(originalRequest)) throw new Error("Vidger proof request hook was not found.");
source = source.replace(originalRequest, protectedRequest);

const patchedPath = join(import.meta.dirname, `.generated-vidger-branding-proof-${process.env.GITHUB_RUN_ID || Date.now()}.mjs`);
await writeFile(patchedPath, source);
await import(pathToFileURL(patchedPath).href);
