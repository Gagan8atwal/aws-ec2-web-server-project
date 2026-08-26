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
  )
  .replace(
    'const MODEL = "fal-ai/kling-video/v3/standard/text-to-video";',
    'const MODEL = "fal-ai/wan/v2.7/text-to-video";',
  )
  .replace(
    /const CANDIDATES = \[[\s\S]*?\];\nconst RUN_ID/,
    'const CANDIDATES = [\n  { id: "founder-wan-16x9", requestId: "019fd74d-e309-7920-9226-a379469d684c", model: MODEL },\n];\nconst RUN_ID',
  );

for (const expected of [
  'db78561c-d1b8-41a7-8d5b-bc820e050537',
  'Vidger Founder Workspace',
  '019fd74d-e309-7920-9226-a379469d684c',
]) {
  if (!source.includes(expected)) throw new Error(`Vidger proof patch failed: ${expected}`);
}

const patchedPath = join(
  import.meta.dirname,
  `.generated-vidger-branding-production-proof-${process.env.GITHUB_RUN_ID || Date.now()}.mjs`,
);
await writeFile(patchedPath, source);
console.log("VIDGER_LIVE_PROOF_SOURCE founder-completed-generation");
await import(pathToFileURL(patchedPath).href);
