import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const sourcePath = new URL("./vidger-branding-production-proof.mjs", import.meta.url);
let source = await readFile(sourcePath, "utf8");

const directProviderSource = "    video.src = payloadValue.video.url;";
const protectedPlaybackSource = [
  "    const playback = new URL(\"/api/providers/fal/playback\", location.origin);",
  "    playback.searchParams.set(\"requestId\", candidateValue.requestId);",
  "    playback.searchParams.set(\"model\", candidateValue.model);",
  "    video.src = playback.toString();",
].join("\n");
if (!source.includes(directProviderSource)) {
  throw new Error("Vidger production proof playback hook was not found.");
}
source = source.replace(directProviderSource, protectedPlaybackSource);

const scriptTagWait = "  await page.waitForFunction(() => Boolean(document.querySelector('script[src=\"/assets/vidger-branding.js\"]')), null, { timeout: 30_000 });";
const brandingRuntimeWait = [
  scriptTagWait,
  "  await page.waitForSelector(\"[data-vidger-branding-note]\", { state: \"visible\", timeout: 60_000 });",
].join("\n");
if (!source.includes(scriptTagWait)) {
  throw new Error("Vidger branding runtime readiness hook was not found.");
}
source = source.replace(scriptTagWait, brandingRuntimeWait);

const patchedPath = join(
  import.meta.dirname,
  `.generated-vidger-branding-production-proof-${process.env.GITHUB_RUN_ID || Date.now()}.mjs`,
);
await writeFile(patchedPath, source);
console.log("VIDGER_PROOF_PLAYBACK_MODE same-origin-secure-proxy");
console.log("VIDGER_PROOF_UI_READINESS branding-runtime-executed");
await import(pathToFileURL(patchedPath).href);
