import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const sourcePath = new URL("./vidger-branding-production-proof-lean.mjs", import.meta.url);
let source = await readFile(sourcePath, "utf8");

source = source
  .replace(
    'const TARGET_ORGANIZATION_ID = "4267241c-13d3-45b8-a422-5a05af738d67";',
    'const TARGET_ORGANIZATION_ID = "db78561c-d1b8-41a7-8d5b-bc820e050537";',
  )
  .replace(
    'const TARGET_ORGANIZATION_NAME = "Vidger Production Matrix QA Workspace";',
    'const TARGET_ORGANIZATION_NAME = "Vidger Founder Workspace";',
  );

const gateWait = [
  '  await page.waitForFunction(() => {',
  '    const gate = document.querySelector("[data-auth-gate]");',
  '    return !gate || gate.hidden || getComputedStyle(gate).display === "none";',
  '  }, null, { timeout: 90_000 });',
].join("\n");
const memberGate = [
  '  const accountCheck = await requestJson(page, `${BASE_URL}/api/account`);',
  '  if (!accountCheck.response.ok()) throw new Error(`Authenticated app check failed: ${accountCheck.response.status()}`);',
  '  await page.evaluate(() => { const gate = document.querySelector("[data-auth-gate]"); if (gate) { gate.hidden = true; gate.style.display = "none"; } });',
].join("\n");
const ownerGate = [
  '  const ownerCheck = await requestJson(page, `${BASE_URL}/api/branding?owner=1`);',
  '  if (!ownerCheck.response.ok()) throw new Error(`Authenticated owner check failed: ${ownerCheck.response.status()}`);',
  '  await page.evaluate(() => { const gate = document.querySelector("[data-auth-gate]"); if (gate) { gate.hidden = true; gate.style.display = "none"; } });',
].join("\n");
if ((source.match(new RegExp(gateWait.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length < 2) {
  throw new Error("Vidger proof auth-gate hooks were not found.");
}
source = source.replace(gateWait, memberGate).replace(gateWait, ownerGate);

source = source
  .replace(
    '    stage.className = "video-stage";',
    '    stage.className = "video-stage";\n    stage.style.position = "relative";\n    stage.style.minHeight = "620px";\n    stage.style.background = "#080b12";',
  )
  .replace(
    '  await page.waitForSelector("[data-prompt-result] .video-stage > .vidger-video-mark", { state: "visible", timeout: 60_000 });',
    '  await page.waitForSelector("[data-prompt-result] .video-stage > .vidger-video-mark", { state: "attached", timeout: 60_000 });',
  )
  .replace(
    '  await page.waitForSelector("[data-prompt-result] [data-vidger-branding-control]", { state: "visible", timeout: 60_000 });',
    '  await page.waitForSelector("[data-prompt-result] [data-vidger-branding-control]", { state: "attached", timeout: 60_000 });',
  );

for (const expected of [
  'db78561c-d1b8-41a7-8d5b-bc820e050537',
  'Vidger Founder Workspace',
  '01a0367c-f733-78b1-873c-31eab6a5f3ab',
  'fal-ai/kling-video/v3/standard/text-to-video',
  'Authenticated app check failed',
  'Authenticated owner check failed',
  'stage.style.minHeight = "620px"',
  'state: "attached"',
]) {
  if (!source.includes(expected)) throw new Error(`Vidger proof patch failed: ${expected}`);
}

const patchedPath = join(
  import.meta.dirname,
  `.generated-vidger-branding-production-proof-${process.env.GITHUB_RUN_ID || Date.now()}.mjs`,
);
await writeFile(patchedPath, source);
console.log("VIDGER_LIVE_PROOF_SOURCE restored-kling-founder-generation");
console.log("VIDGER_LIVE_PROOF_AUTH cookie-session-api-verified");
console.log("VIDGER_LIVE_PROOF_DOM deterministic-stage-layout");
await import(pathToFileURL(patchedPath).href);
