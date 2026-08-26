import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const shareToken = "UUTCJXHsAOPV69xSMyTqSY2u1Or5TNEA";
const proofRevision = "ordinary-user-then-owner";
const sourcePath = new URL("./vidger-branding-live-proof-v4.mjs", import.meta.url);
let source = await readFile(sourcePath, "utf8");

source = source.replace(
  /const SHARE_URL = `\$\{BASE_URL\}\/\?_vercel_share=[^`]+`;/,
  `const SHARE_URL = \`${"${BASE_URL}"}/?_vercel_share=${shareToken}\`;`,
);

// A valid share visit establishes Vercel's bypass cookie in the browser context.
// Page.request shares that cookie jar, so API requests remain same-origin and authenticated.
const navigation = 'await page.goto(SHARE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });';
const protectedNavigation = [
  navigation,
  'await page.waitForURL((value) => new URL(value).hostname === new URL(BASE_URL).hostname, { timeout: 60_000 });',
  'const bypassCookies = await context.cookies(BASE_URL);',
  'if (!bypassCookies.some((cookie) => /vercel/i.test(cookie.name))) throw new Error("Vercel preview bypass cookie was not established.");',
  'console.log(`VIDGER_PREVIEW_BYPASS_READY cookies=${bypassCookies.map((cookie) => cookie.name).join(",")}`);',
].join("\n    ");
if (!source.includes(navigation)) throw new Error("Vidger proof navigation hook was not found.");
source = source.replace(navigation, protectedNavigation);

console.log(`VIDGER_PROOF_REVISION ${proofRevision}`);
const patchedPath = join(import.meta.dirname, `.generated-vidger-branding-proof-${process.env.GITHUB_RUN_ID || Date.now()}.mjs`);
await writeFile(patchedPath, source);
await import(pathToFileURL(patchedPath).href);
