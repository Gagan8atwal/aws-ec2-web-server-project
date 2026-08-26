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

const patchedPath = join(
  import.meta.dirname,
  `.generated-vidger-branding-production-proof-${process.env.GITHUB_RUN_ID || Date.now()}.mjs`,
);
await writeFile(patchedPath, source);
console.log("VIDGER_PROOF_PLAYBACK_MODE same-origin-secure-proxy");
await import(pathToFileURL(patchedPath).href);
