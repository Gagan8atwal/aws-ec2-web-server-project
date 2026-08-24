import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import crypto from "node:crypto";

const BASE_URL = "https://omnimedia-engine.vercel.app";
const RUN_ID = process.env.GITHUB_RUN_ID || String(Date.now());
const QA_EMAIL = `hello+vidgerqa-${RUN_ID}@pivotcalls.co`;
const QA_PASSWORD = `Vg!${crypto.randomBytes(30).toString("base64url")}9a`;
const OUTPUT_DIR = join(process.cwd(), "artifacts", "vidger-qa");
const SCREENSHOT_DIR = join(OUTPUT_DIR, "screenshots");
const VIDEO_DIR = join(OUTPUT_DIR, "videos");
const BROWSER_VIDEO_DIR = join(OUTPUT_DIR, "browser-recordings");

const cases = [
  {
    id: "commercial-semi-truck",
    model: "fal-ai/wan/v2.7/text-to-video",
    duration: "5",
    ratio: "16:9",
    prompt:
      "Premium automotive commercial: a polished black Peterbilt-style semi-truck hauling a silver refrigerated trailer along a wide mountain highway at sunrise. Medium-wide low tracking shot from the front three-quarter angle, the entire tractor and trailer remain fully visible, realistic tire rotation and suspension movement, soft golden reflections across chrome, stable horizon, physically plausible road motion, crisp commercial cinematography, no text or logos.",
  },
  {
    id: "cinematic-human-motion",
    model: "fal-ai/kling-video/v3/standard/text-to-video",
    duration: "5",
    ratio: "16:9",
    prompt:
      "Cinematic fashion film: a confident woman in a long red coat walks through a rain-soaked neon city street at night, full body visible from head to toe throughout the shot. Smooth side-tracking gimbal camera, natural walking rhythm, consistent face and clothing, realistic wet pavement reflections, subtle wind moving the coat, controlled depth of field, premium editorial lighting, no cuts, no text, no logos.",
  },
  {
    id: "stylized-3d-character",
    model: "fal-ai/wan/v2.7/text-to-video",
    duration: "5",
    ratio: "16:9",
    prompt:
      "Polished stylized 3D animation: a small friendly orange robot helps a curious child place a glowing blue crystal into a tabletop invention inside a warm workshop. Medium-wide composition keeps both characters and the full workbench visible. The robot reaches, the child reacts with delight, the machine lights up with a gentle pulse, expressive but controlled character motion, consistent faces and proportions, soft cinematic lighting, clean family-friendly design, no text or logos.",
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

async function authRequest(page, body) {
  const response = await page.request.post(`${BASE_URL}/api/auth`, {
    headers: { "content-type": "application/json" },
    data: body,
    timeout: 30_000,
  });
  return { status: response.status(), ok: response.ok(), payload: await readJson(response) };
}

async function waitForAuthenticatedSession(page) {
  const signup = await authRequest(page, {
    action: "signUp",
    email: QA_EMAIL,
    password: QA_PASSWORD,
    fullName: "Vidger Cloud QA",
  });
  console.log(`VIDGER_QA_SIGNUP email=${QA_EMAIL} status=${signup.status} signedIn=${Boolean(signup.payload?.signedIn)}`);

  if (signup.ok && signup.payload?.signedIn) return;

  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const signIn = await authRequest(page, {
      action: "signIn",
      email: QA_EMAIL,
      password: QA_PASSWORD,
    });
    if (signIn.ok) {
      console.log(`VIDGER_QA_AUTHENTICATED email=${QA_EMAIL} attempt=${attempt}`);
      return;
    }
    if (attempt % 4 === 0) {
      console.log(`VIDGER_QA_WAITING_FOR_CONFIRMATION email=${QA_EMAIL} attempt=${attempt} status=${signIn.status}`);
    }
    await sleep(10_000);
  }

  throw new Error(`QA account was not confirmed in time: ${QA_EMAIL}`);
}

async function ensureWorkspace(page) {
  let response = await page.request.get(`${BASE_URL}/api/account`, { timeout: 30_000 });
  let payload = await readJson(response);
  if (!response.ok()) throw new Error(`Account load failed: ${response.status()} ${JSON.stringify(payload)}`);

  const workspace = Array.isArray(payload.workspace) ? payload.workspace[0] : payload.workspace;
  if (!workspace?.project_id) {
    response = await page.request.post(`${BASE_URL}/api/account`, {
      headers: { "content-type": "application/json" },
      data: { action: "createProject", name: "Vidger Cloud QA" },
      timeout: 30_000,
    });
    payload = await readJson(response);
    if (!response.ok()) throw new Error(`Project creation failed: ${response.status()} ${JSON.stringify(payload)}`);
  }

  const safe = {
    email: QA_EMAIL,
    workspace: payload.workspace ?? null,
    projects: payload.projects ?? [],
  };
  await writeFile(join(OUTPUT_DIR, "qa-account.json"), JSON.stringify(safe, null, 2));
}

async function runCase(context, testCase) {
  const page = await context.newPage();
  const consoleEvents = [];
  page.on("console", (message) => consoleEvents.push({ type: message.type(), text: message.text() }));
  page.on("pageerror", (error) => consoleEvents.push({ type: "pageerror", text: error.message }));

  const startedAt = new Date().toISOString();
  const result = {
    ...testCase,
    startedAt,
    status: "STARTED",
    requestId: null,
    generationId: null,
    providerStatus: null,
    outputFile: null,
    screenshotFile: null,
    error: null,
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
    await form.locator("[data-model-select]").selectOption(testCase.model);
    await form.locator("[data-duration-select]").selectOption(testCase.duration);
    await form.locator("[data-ratio-select]").selectOption(testCase.ratio);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, `${testCase.id}-before.png`),
      fullPage: true,
    });

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
    console.log(`VIDGER_QA_SUBMITTED case=${testCase.id} requestId=${result.requestId} model=${testCase.model}`);

    const video = page.locator("[data-prompt-result] video");
    const stopped = page.locator("[data-prompt-result]").getByText("Generation stopped", { exact: true });
    const completed = await Promise.race([
      video.waitFor({ state: "visible", timeout: 1_200_000 }).then(() => "video"),
      stopped.waitFor({ state: "visible", timeout: 1_200_000 }).then(() => "stopped"),
    ]);
    if (completed !== "video") {
      const detail = await page.locator("[data-prompt-result]").innerText().catch(() => "Unknown generation failure");
      throw new Error(detail);
    }

    await page.waitForTimeout(2_000);
    const screenshotPath = join(SCREENSHOT_DIR, `${testCase.id}-ready.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    result.screenshotFile = screenshotPath;

    const query = new URLSearchParams({ requestId: result.requestId, model: testCase.model });
    const statusResponse = await page.request.get(`${BASE_URL}/api/providers/fal/status?${query.toString()}`, {
      timeout: 60_000,
    });
    const statusPayload = await readJson(statusResponse);
    if (!statusResponse.ok()) {
      throw new Error(`Status fetch failed: ${statusResponse.status()} ${JSON.stringify(statusPayload)}`);
    }
    result.providerStatus = statusPayload;

    const downloadResponse = await page.request.get(`${BASE_URL}/api/providers/fal/download?${query.toString()}`, {
      timeout: 180_000,
    });
    if (!downloadResponse.ok()) {
      const failure = await readJson(downloadResponse);
      throw new Error(`Secure download failed: ${downloadResponse.status()} ${JSON.stringify(failure)}`);
    }
    const outputPath = join(VIDEO_DIR, `${testCase.id}.mp4`);
    await writeFile(outputPath, await downloadResponse.body());
    result.outputFile = outputPath;
    result.status = "COMPLETED";
    console.log(`VIDGER_QA_COMPLETED case=${testCase.id} requestId=${result.requestId} file=${outputPath}`);
  } catch (error) {
    result.status = "FAILED";
    result.error = error instanceof Error ? error.message : String(error);
    console.error(`VIDGER_QA_FAILED case=${testCase.id} error=${result.error}`);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, `${testCase.id}-failure.png`),
      fullPage: true,
    }).catch(() => null);
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

  const bootstrapPage = await context.newPage();
  try {
    await bootstrapPage.goto(`${BASE_URL}/app`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForAuthenticatedSession(bootstrapPage);
    await ensureWorkspace(bootstrapPage);
    await bootstrapPage.screenshot({ path: join(SCREENSHOT_DIR, "authenticated-workspace.png"), fullPage: true });

    const results = await Promise.all(cases.map((testCase) => runCase(context, testCase)));
    const summary = {
      baseUrl: BASE_URL,
      qaEmail: QA_EMAIL,
      runId: RUN_ID,
      completed: results.filter((item) => item.status === "COMPLETED").length,
      failed: results.filter((item) => item.status !== "COMPLETED").length,
      results,
    };
    await writeFile(join(OUTPUT_DIR, "qa-summary.json"), JSON.stringify(summary, null, 2));
    if (summary.completed === 0) process.exitCode = 1;
  } finally {
    await bootstrapPage.close().catch(() => null);
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
