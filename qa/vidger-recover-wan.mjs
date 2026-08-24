import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import crypto from "node:crypto";

const BASE_URL = "https://omnimedia-engine.vercel.app";
const RUN_ID = process.env.GITHUB_RUN_ID || String(Date.now());
const QA_EMAIL = `hello+vidgerpolished-${RUN_ID}@pivotcalls.co`;
const QA_PASSWORD = `Vg!${crypto.randomBytes(30).toString("base64url")}9a`;
const OUTPUT_DIR = join(process.cwd(), "artifacts", "vidger-recovery");
const SCREENSHOT_DIR = join(OUTPUT_DIR, "screenshots");
const VIDEO_DIR = join(OUTPUT_DIR, "videos");
const BROWSER_VIDEO_DIR = join(OUTPUT_DIR, "browser-recordings");
const MODEL = "fal-ai/kling-video/v3/standard/text-to-video";

const cases = [
  {
    id: "polished-semi-truck-commercial",
    duration: "5",
    ratio: "16:9",
    prompt:
      "High-end automotive commercial, one continuous five-second shot on an empty mountain highway at sunrise. A glossy black classic long-nose American semi-truck pulls a clean silver refrigerated box trailer. Keep the entire tractor and full trailer visible from start to finish in a wide front three-quarter tracking view, with the camera vehicle matching speed. Realistic tire rotation, suspension movement, stable horizon, accurate road contact, warm sunrise reflections across chrome, distant mountains and open sky only. No buildings, road signs, lettering, brands, logos, readable license plates, people, cuts, zooms, or camera collisions. Physically realistic premium commercial cinematography.",
  },
  {
    id: "polished-stylized-3d-character",
    duration: "5",
    ratio: "16:9",
    prompt:
      "Premium feature-animation style with clearly stylized, non-photorealistic 3D characters. In a warm uncluttered workshop with blank walls and no labels, a small friendly orange robot and a curious child stand together at a simple workbench. Keep both characters fully visible throughout. The robot gently hands a glowing blue crystal to the child; the child places it into a tabletop invention; the machine emits one soft blue pulse; they exchange a delighted look. Smooth restrained gestures, consistent faces, hands, body proportions, and clothing, clean rounded design, stable medium-wide camera. No cuts, written text, signs, logos, extra fingers, duplicate limbs, morphing, or frightening expressions.",
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function signUp(page) {
  const response = await page.request.post(`${BASE_URL}/api/auth`, {
    headers: { "content-type": "application/json" },
    data: {
      action: "signUp",
      email: QA_EMAIL,
      password: QA_PASSWORD,
      fullName: "Vidger Polished Output QA",
    },
    timeout: 30_000,
  });
  const payload = await readJson(response);
  if (!response.ok() || !payload.signedIn) {
    throw new Error(`QA signup failed: ${response.status()} ${JSON.stringify(payload)}`);
  }
  console.log(`VIDGER_POLISHED_ACCOUNT email=${QA_EMAIL} userId=${payload.user?.id || "unknown"}`);
  await writeFile(join(OUTPUT_DIR, "qa-account.json"), JSON.stringify({ email: QA_EMAIL, userId: payload.user?.id || null }, null, 2));
}

async function ensureProject(page) {
  let response = await page.request.get(`${BASE_URL}/api/account`, { timeout: 30_000 });
  let payload = await readJson(response);
  if (!response.ok()) throw new Error(`Account load failed: ${response.status()} ${JSON.stringify(payload)}`);
  const workspace = Array.isArray(payload.workspace) ? payload.workspace[0] : payload.workspace;
  if (workspace?.project_id) return;
  response = await page.request.post(`${BASE_URL}/api/account`, {
    headers: { "content-type": "application/json" },
    data: { action: "createProject", name: "Vidger Polished QA" },
    timeout: 30_000,
  });
  payload = await readJson(response);
  if (!response.ok()) throw new Error(`Project creation failed: ${response.status()} ${JSON.stringify(payload)}`);
}

async function resilientStatus(page, requestId, testCase) {
  const query = new URLSearchParams({ requestId, model: MODEL });
  let last = null;
  for (let attempt = 1; attempt <= 180; attempt += 1) {
    const response = await page.request.get(`${BASE_URL}/api/providers/fal/status?${query.toString()}`, {
      timeout: 60_000,
    }).catch(() => null);
    if (!response) {
      last = { status: 0, payload: { error: "NETWORK_FAILURE" } };
    } else {
      const payload = await readJson(response);
      last = { status: response.status(), payload };
      if (response.ok()) {
        if (payload.status === "COMPLETED" && payload.video) return payload;
        if (payload.error) throw new Error(String(payload.error));
      }
    }
    if (attempt % 10 === 0) {
      console.log(`VIDGER_POLISHED_WAIT case=${testCase.id} attempt=${attempt} http=${last.status} provider=${last.payload?.status || last.payload?.error || "unknown"}`);
    }
    await sleep(4_000);
  }
  throw new Error(`Generation timed out: ${JSON.stringify(last)}`);
}

async function generateCase(context, testCase) {
  const page = await context.newPage();
  const consoleEvents = [];
  page.on("console", (message) => consoleEvents.push({ type: message.type(), text: message.text() }));
  page.on("pageerror", (error) => consoleEvents.push({ type: "pageerror", text: error.message }));
  const result = {
    ...testCase,
    model: MODEL,
    status: "STARTED",
    requestId: null,
    generationId: null,
    providerStatus: null,
    outputFile: null,
    screenshotFile: null,
    error: null,
    startedAt: new Date().toISOString(),
  };

  try {
    await page.goto(`${BASE_URL}/app`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("[data-prompt-form]", { state: "visible", timeout: 60_000 });
    await page.waitForFunction(() => {
      const gate = document.querySelector("[data-auth-gate]");
      return !gate || gate.hidden || getComputedStyle(gate).display === "none";
    }, null, { timeout: 60_000 });

    const form = page.locator("[data-prompt-form]");
    await form.locator("textarea[name=prompt]").fill(testCase.prompt);
    await form.locator("[data-model-select]").selectOption(MODEL);
    await form.locator("[data-duration-select]").selectOption(testCase.duration);
    await form.locator("[data-ratio-select]").selectOption(testCase.ratio);
    await page.screenshot({ path: join(SCREENSHOT_DIR, `${testCase.id}-before.png`), fullPage: true });

    const submitResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/providers/fal/submit") && response.request().method() === "POST",
      { timeout: 60_000 },
    );
    await form.locator("button[type=submit]").click();
    const submitResponse = await submitResponsePromise;
    const submitPayload = await readJson(submitResponse);
    if (!submitResponse.ok()) {
      throw new Error(`Generation submit failed: ${submitResponse.status()} ${JSON.stringify(submitPayload)}`);
    }

    result.requestId = submitPayload.requestId;
    result.generationId = submitPayload.generationId;
    console.log(`VIDGER_POLISHED_SUBMITTED case=${testCase.id} requestId=${result.requestId}`);

    const providerStatus = await resilientStatus(page, result.requestId, testCase);
    result.providerStatus = providerStatus;
    const query = new URLSearchParams({ requestId: result.requestId, model: MODEL });

    const download = await page.request.get(`${BASE_URL}/api/providers/fal/download?${query.toString()}`, { timeout: 180_000 });
    if (!download.ok()) throw new Error(`Secure download failed: ${download.status()} ${JSON.stringify(await readJson(download))}`);
    const outputPath = join(VIDEO_DIR, `${testCase.id}.mp4`);
    await writeFile(outputPath, await download.body());
    result.outputFile = outputPath;

    await page.goto(`${BASE_URL}/app?${query.toString()}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("[data-prompt-result] video", { state: "visible", timeout: 120_000 });
    const screenshotPath = join(SCREENSHOT_DIR, `${testCase.id}-ready.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    result.screenshotFile = screenshotPath;
    result.status = "COMPLETED";
    console.log(`VIDGER_POLISHED_COMPLETED case=${testCase.id} requestId=${result.requestId} file=${outputPath}`);
  } catch (error) {
    result.status = "FAILED";
    result.error = error instanceof Error ? error.message : String(error);
    console.error(`VIDGER_POLISHED_FAILED case=${testCase.id} error=${result.error}`);
    await page.screenshot({ path: join(SCREENSHOT_DIR, `${testCase.id}-failure.png`), fullPage: true }).catch(() => null);
  } finally {
    result.finishedAt = new Date().toISOString();
    result.consoleEvents = consoleEvents.slice(-100);
    await writeFile(join(OUTPUT_DIR, `${testCase.id}.json`), JSON.stringify(result, null, 2));
    await page.close();
  }
  return result;
}

async function main() {
  await Promise.all([
    mkdir(OUTPUT_DIR, { recursive: true }),
    mkdir(SCREENSHOT_DIR, { recursive: true }),
    mkdir(VIDEO_DIR, { recursive: true }),
    mkdir(BROWSER_VIDEO_DIR, { recursive: true }),
  ]);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir: BROWSER_VIDEO_DIR, size: { width: 1280, height: 720 } },
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const bootstrap = await context.newPage();
  try {
    await bootstrap.goto(`${BASE_URL}/app`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await signUp(bootstrap);
    await ensureProject(bootstrap);
    const results = await Promise.all(cases.map((testCase) => generateCase(context, testCase)));
    const summary = {
      baseUrl: BASE_URL,
      qaEmail: QA_EMAIL,
      runId: RUN_ID,
      submittedNewGenerations: results.filter((item) => item.requestId).length,
      reservedCredits: results.filter((item) => item.requestId).length * 10,
      completed: results.filter((item) => item.status === "COMPLETED").length,
      failed: results.filter((item) => item.status !== "COMPLETED").length,
      results,
    };
    await writeFile(join(OUTPUT_DIR, "polished-summary.json"), JSON.stringify(summary, null, 2));
    if (summary.completed === 0) process.exitCode = 1;
  } finally {
    await bootstrap.close().catch(() => null);
    await context.tracing.stop({ path: join(OUTPUT_DIR, "playwright-trace.zip") }).catch(() => null);
    await context.close().catch(() => null);
    await browser.close().catch(() => null);
  }
}

main().catch(async (error) => {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(join(OUTPUT_DIR, "fatal-error.txt"), error?.stack || String(error));
  console.error(error);
  process.exitCode = 1;
});
