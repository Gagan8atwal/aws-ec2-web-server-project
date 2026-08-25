import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import crypto from "node:crypto";

const BASE_URL = "https://omnimedia-engine.vercel.app";
const RUN_ID = process.env.GITHUB_RUN_ID || String(Date.now());
const QA_EMAIL = `hello+vidgermatrix-${RUN_ID}@pivotcalls.co`;
const QA_PASSWORD = `Vg!${crypto.randomBytes(30).toString("base64url")}9a`;
const OUTPUT_DIR = join(process.cwd(), "artifacts", "vidger-production-matrix");
const SCREENSHOT_DIR = join(OUTPUT_DIR, "screenshots");
const VIDEO_DIR = join(OUTPUT_DIR, "videos");
const REQUIRED_CREDITS = 70;

const WAN = "fal-ai/wan/v2.7/text-to-video";
const KLING = "fal-ai/kling-video/v3/standard/text-to-video";

const cases = [
  {
    id: "vehicle-wan-16x9",
    category: "vehicle",
    model: WAN,
    duration: "5",
    ratio: "16:9",
    prompt: "Premium automotive commercial, one continuous five-second shot. A midnight-blue electric sports coupe drives along an empty coastal highway at sunrise. Keep the complete car visible from bumper to bumper throughout in a stable front three-quarter tracking view. Natural wheel rotation, accurate tire contact, consistent body geometry and reflections, smooth suspension movement, stable horizon, realistic road speed, clean sky and ocean background. No people, signs, lettering, logos, readable license plates, cuts, zooms, duplicated wheels, warped panels, or camera collisions.",
  },
  {
    id: "product-wan-1x1",
    category: "product",
    model: WAN,
    duration: "5",
    ratio: "1:1",
    prompt: "Square luxury product film, one continuous shot. A logo-free mechanical wristwatch with a deep green dial rests upright on a dark stone pedestal and rotates slowly by about ninety degrees. Preserve the exact round case, crown, two hands fixed at ten-ten, twelve hour markers, metal bracelet links, proportions, and reflections in every frame. Controlled studio rim lighting, crisp premium detail, subtle camera push-in, clean black background. No text, branding, extra hands, changing markers, melting metal, duplicate crowns, sudden zooms, or cuts.",
  },
  {
    id: "liquid-wan-9x16",
    category: "fluid-motion",
    model: WAN,
    duration: "5",
    ratio: "9:16",
    prompt: "Vertical beverage commercial, one continuous five-second shot. A single clear tall glass stands centered on a clean stone counter while amber iced tea pours from just above frame into the glass. Keep the glass fully visible, rigid, and unchanged. Use one smooth continuous liquid stream, physically realistic filling level, gentle ice movement, small controlled bubbles, natural splash behavior, warm backlight, stable camera. No labels, text, logos, extra glasses, disappearing liquid, warped rim, impossible splashes, cuts, or zooms.",
  },
  {
    id: "fox-wan-16x9",
    category: "animal",
    model: WAN,
    duration: "5",
    ratio: "16:9",
    prompt: "Natural-history cinematic shot of one healthy red fox walking calmly from left to right across a quiet snowy meadow at dawn. Keep the full fox visible in profile from ears to tail throughout. Preserve one head, four legs, natural paws, consistent orange-white fur pattern, realistic spine and tail motion, correct walking gait and footprints. Stable side-tracking camera, soft winter light, distant trees, shallow controlled depth of field. No other animals, extra limbs, fused paws, changing face, duplicated tail, text, logos, cuts, or sudden camera movement.",
  },
  {
    id: "basketball-kling-9x16",
    category: "human-motion",
    model: KLING,
    duration: "5",
    ratio: "9:16",
    prompt: "Vertical sports commercial, one continuous five-second full-body shot. One athletic woman in a plain blue basketball uniform performs one controlled crossover dribble, takes two steps, and completes a balanced jump shot on an empty indoor court. Keep her entire body and the single basketball visible. Preserve her face, hairstyle, uniform, two arms, two hands, two legs, and shoe design. Natural ball bounce and hand contact, accurate footwork, stable gimbal tracking, premium arena lighting. No crowd, text, logos, duplicate ball, extra fingers, limb morphing, cuts, zooms, or camera collision.",
  },
  {
    id: "dog-kling-16x9",
    category: "animal-motion",
    model: KLING,
    duration: "5",
    ratio: "16:9",
    prompt: "Bright cinematic park scene, one continuous five-second shot. One healthy golden retriever runs a short distance, jumps once, catches one red frisbee cleanly, lands naturally, and continues forward. Keep the complete dog visible throughout. Preserve one head, four legs, natural paws, consistent golden fur, one tail, one frisbee, correct jaw contact, realistic running and landing motion. Smooth low side-tracking camera, soft morning sun, uncluttered grass background. No people, extra animals, duplicate frisbees, extra limbs, fused paws, changing face, text, logos, cuts, or abrupt zooms.",
  },
  {
    id: "robot-kling-16x9",
    category: "stylized-3d",
    model: KLING,
    duration: "5",
    ratio: "16:9",
    prompt: "Premium stylized feature-animation scene, one continuous five-second shot. In a warm clean workshop, a small friendly orange robot and a curious child assemble a simple toy rocket on a workbench. The robot passes one blue fin to the child; the child attaches it; the rocket light gives one soft pulse; both characters exchange a delighted look. Keep both full characters and the full rocket visible. Consistent faces, hands, clothing, robot geometry, proportions, and colors, smooth restrained gestures, stable medium-wide camera. No written labels, logos, extra fingers, duplicate limbs, morphing, frightening expressions, cuts, or zooms.",
  },
  {
    id: "dancer-kling-1x1",
    category: "complex-motion",
    model: KLING,
    duration: "5",
    ratio: "1:1",
    prompt: "Square contemporary dance film, one continuous five-second full-body shot. One professional dancer in a plain flowing white outfit takes two controlled steps, performs exactly one clean turn with arms extended, then settles into a balanced final pose. Keep the entire dancer visible head to toe. Preserve the same face, hair, outfit, two arms, two hands, two legs, and feet. Natural fabric motion, realistic balance and floor contact, stable centered camera, soft studio lighting, blank neutral background. No mirrors, other people, text, logos, extra limbs, fused hands, changing clothing, cuts, zooms, or camera movement.",
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(response) {
  const body = await response.text();
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    return { raw: body };
  }
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function rows(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

async function signup(page) {
  const response = await page.request.post(`${BASE_URL}/api/auth`, {
    headers: { "content-type": "application/json" },
    data: {
      action: "signUp",
      email: QA_EMAIL,
      password: QA_PASSWORD,
      fullName: "Vidger Production Matrix QA",
    },
    timeout: 30_000,
  });
  const payload = await readJson(response);
  if (!response.ok() || !payload.signedIn) {
    throw new Error(`QA signup failed: ${response.status()} ${JSON.stringify(payload)}`);
  }
  console.log(`VIDGER_MATRIX_ACCOUNT email=${QA_EMAIL} userId=${payload.user?.id || "unknown"}`);
  await writeFile(join(OUTPUT_DIR, "qa-account.json"), JSON.stringify({ email: QA_EMAIL, userId: payload.user?.id || null }, null, 2));
}

async function loadAccount(page) {
  const response = await page.request.get(`${BASE_URL}/api/account`, { timeout: 30_000 });
  const payload = await readJson(response);
  if (!response.ok()) throw new Error(`Account load failed: ${response.status()} ${JSON.stringify(payload)}`);
  return payload;
}

async function waitForCredits(page) {
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    const account = await loadAccount(page);
    const workspace = first(account.workspace) || {};
    const remaining = Number(workspace.credits_remaining ?? 0);
    if (remaining >= REQUIRED_CREDITS) {
      console.log(`VIDGER_MATRIX_CREDITS_READY email=${QA_EMAIL} remaining=${remaining}`);
      return account;
    }
    if (attempt % 6 === 0) {
      console.log(`VIDGER_MATRIX_WAITING_FOR_CREDITS email=${QA_EMAIL} remaining=${remaining} required=${REQUIRED_CREDITS}`);
    }
    await sleep(5_000);
  }
  throw new Error(`QA credits were not raised to ${REQUIRED_CREDITS} for ${QA_EMAIL}.`);
}

async function waitForUiResult(page, testCase) {
  const result = page.locator("[data-prompt-result]");
  const video = result.locator("video");
  const stopped = result.getByText("Generation stopped", { exact: true });
  const outcome = await Promise.race([
    video.waitFor({ state: "visible", timeout: 1_500_000 }).then(() => "video"),
    stopped.waitFor({ state: "visible", timeout: 1_500_000 }).then(() => "stopped"),
  ]);
  if (outcome === "stopped") {
    throw new Error(await result.innerText().catch(() => `${testCase.id}: generation stopped`));
  }
  return video;
}

async function runCase(context, testCase) {
  const page = await context.newPage();
  const consoleEvents = [];
  page.on("console", (message) => consoleEvents.push({ type: message.type(), text: message.text() }));
  page.on("pageerror", (error) => consoleEvents.push({ type: "pageerror", text: error.message }));

  const result = {
    ...testCase,
    status: "STARTED",
    requestId: null,
    generationId: null,
    admission: null,
    providerStatus: null,
    persistedStatus: null,
    player: null,
    outputFile: null,
    screenshots: [],
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
    await form.locator("[data-model-select]").selectOption(testCase.model);
    await form.locator("[data-duration-select]").selectOption(testCase.duration);
    await form.locator("[data-ratio-select]").selectOption(testCase.ratio);

    const beforePath = join(SCREENSHOT_DIR, `${testCase.id}-before.png`);
    await page.screenshot({ path: beforePath, fullPage: true });
    result.screenshots.push(beforePath);

    const submitPromise = page.waitForResponse(
      (response) => response.url().includes("/api/providers/fal/submit") && response.request().method() === "POST",
      { timeout: 60_000 },
    );
    await form.locator("button[type=submit]").click();
    const submitResponse = await submitPromise;
    const submitPayload = await readJson(submitResponse);
    if (!submitResponse.ok()) {
      throw new Error(`Submit failed: ${submitResponse.status()} ${JSON.stringify(submitPayload)}`);
    }

    result.requestId = submitPayload.requestId;
    result.generationId = submitPayload.generationId;
    result.admission = submitPayload.admission || null;
    console.log(`VIDGER_MATRIX_SUBMITTED case=${testCase.id} model=${testCase.model} ratio=${testCase.ratio} requestId=${result.requestId}`);

    const video = await waitForUiResult(page, testCase);
    await page.waitForTimeout(1_500);
    result.player = await video.evaluate((element) => ({
      currentSrc: element.currentSrc || element.src,
      duration: Number.isFinite(element.duration) ? element.duration : null,
      width: element.videoWidth || null,
      height: element.videoHeight || null,
      readyState: element.readyState,
    }));

    const readyPath = join(SCREENSHOT_DIR, `${testCase.id}-ready.png`);
    await page.screenshot({ path: readyPath, fullPage: true });
    result.screenshots.push(readyPath);

    const cover = page.locator("[data-prompt-result] .video-cover");
    if (await cover.isVisible().catch(() => false)) {
      await cover.click();
      await page.waitForTimeout(2_000);
      const playingPath = join(SCREENSHOT_DIR, `${testCase.id}-playing.png`);
      await page.screenshot({ path: playingPath, fullPage: true });
      result.screenshots.push(playingPath);
    }

    const query = new URLSearchParams({ requestId: result.requestId, model: testCase.model });
    const statusResponse = await page.request.get(`${BASE_URL}/api/providers/fal/status?${query.toString()}`, { timeout: 60_000 });
    result.providerStatus = await readJson(statusResponse);
    if (!statusResponse.ok()) {
      throw new Error(`Final status failed: ${statusResponse.status()} ${JSON.stringify(result.providerStatus)}`);
    }

    const downloadResponse = await page.request.get(`${BASE_URL}/api/providers/fal/download?${query.toString()}`, { timeout: 180_000 });
    if (!downloadResponse.ok()) {
      throw new Error(`Secure download failed: ${downloadResponse.status()} ${JSON.stringify(await readJson(downloadResponse))}`);
    }
    const outputPath = join(VIDEO_DIR, `${testCase.id}.mp4`);
    await writeFile(outputPath, await downloadResponse.body());
    result.outputFile = outputPath;

    const account = await loadAccount(page);
    const persisted = rows(account.generations).find((item) => String(item.request_id || item.requestId || "") === result.requestId);
    result.persistedStatus = persisted?.status || null;
    if (String(result.persistedStatus || "").toUpperCase() !== "COMPLETED") {
      throw new Error(`Generation completed in provider but persisted as ${result.persistedStatus || "missing"}.`);
    }

    result.status = "COMPLETED";
    console.log(`VIDGER_MATRIX_COMPLETED case=${testCase.id} requestId=${result.requestId} persisted=${result.persistedStatus} file=${outputPath}`);
  } catch (error) {
    result.status = "FAILED";
    result.error = error instanceof Error ? error.message : String(error);
    console.error(`VIDGER_MATRIX_FAILED case=${testCase.id} error=${result.error}`);
    const failurePath = join(SCREENSHOT_DIR, `${testCase.id}-failure.png`);
    await page.screenshot({ path: failurePath, fullPage: true }).catch(() => null);
    result.screenshots.push(failurePath);
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
  ]);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const bootstrap = await context.newPage();

  try {
    await bootstrap.goto(`${BASE_URL}/app`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await signup(bootstrap);
    await waitForCredits(bootstrap);
    await bootstrap.screenshot({ path: join(SCREENSHOT_DIR, "authenticated-matrix-workspace.png"), fullPage: true });

    const results = [];
    for (let index = 0; index < cases.length; index += 2) {
      const batch = cases.slice(index, index + 2);
      results.push(...await Promise.all(batch.map((testCase) => runCase(context, testCase))));
    }

    const summary = {
      baseUrl: BASE_URL,
      qaEmail: QA_EMAIL,
      runId: RUN_ID,
      expectedCases: cases.length,
      completed: results.filter((item) => item.status === "COMPLETED").length,
      failed: results.filter((item) => item.status !== "COMPLETED").length,
      models: {
        wan: results.filter((item) => item.model === WAN).map((item) => ({ id: item.id, status: item.status, persistedStatus: item.persistedStatus })),
        kling: results.filter((item) => item.model === KLING).map((item) => ({ id: item.id, status: item.status, persistedStatus: item.persistedStatus })),
      },
      aspectRatios: Object.fromEntries(["16:9", "9:16", "1:1"].map((ratio) => [ratio, results.filter((item) => item.ratio === ratio).map((item) => ({ id: item.id, status: item.status }))])),
      results,
    };
    await writeFile(join(OUTPUT_DIR, "matrix-summary.json"), JSON.stringify(summary, null, 2));
    console.log(`VIDGER_MATRIX_SUMMARY completed=${summary.completed} failed=${summary.failed}`);
    if (summary.completed !== cases.length) process.exitCode = 1;
  } finally {
    await bootstrap.close().catch(() => null);
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
