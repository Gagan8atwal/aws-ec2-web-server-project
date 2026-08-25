import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import crypto from "node:crypto";

const BASE_URL = "https://omnimedia-engine-3hxmw6919-gagandeep-singh-s-projects559.vercel.app";
const SHARE_URL = `${BASE_URL}/?_vercel_share=dkgOcK6s76vXJDqDQxcKDySxQ1sF7YHw`;
const TARGET_ORGANIZATION_ID = "4267241c-13d3-45b8-a422-5a05af738d67";
const RUN_ID = process.env.GITHUB_RUN_ID || String(Date.now());
const QA_EMAIL = `hello+vidgerrecover-${RUN_ID}@pivotcalls.co`;
const QA_PASSWORD = `Vg!${crypto.randomBytes(30).toString("base64url")}9a`;
const OUTPUT_DIR = join(process.cwd(), "artifacts", "vidger-wan-recovery-preview");
const SCREENSHOT_DIR = join(OUTPUT_DIR, "screenshots");
const VIDEO_DIR = join(OUTPUT_DIR, "videos");

const WAN = "fal-ai/wan/v2.7/text-to-video";
const KLING = "fal-ai/kling-video/v3/standard/text-to-video";

const cases = [
  { id: "vehicle-wan-16x9", category: "vehicle", model: WAN, requestId: "01a0367c-db28-7410-80bd-eabd5dc11ddb" },
  { id: "product-wan-1x1", category: "product", model: WAN, requestId: "01a0367c-dc1a-7790-8946-ef5f67d665d4" },
  { id: "fox-wan-16x9", category: "animal", model: WAN, requestId: "01a0367c-e921-72f1-aa90-3773478b0253" },
  { id: "liquid-wan-9x16", category: "fluid-motion", model: WAN, requestId: "01a0367c-e991-7021-aa32-deb1db0dade0" },
  { id: "robot-kling-16x9", category: "stylized-3d", model: KLING, requestId: "01a0367d-e0df-7513-be18-e110b7fb9f9f" },
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

async function signUp(page) {
  const response = await page.request.post(`${BASE_URL}/api/auth`, {
    headers: { "content-type": "application/json" },
    data: {
      action: "signUp",
      email: QA_EMAIL,
      password: QA_PASSWORD,
      fullName: "Vidger Wan Recovery QA",
    },
    timeout: 30_000,
  });
  const payload = await readJson(response);
  if (!response.ok() || !payload.signedIn) {
    throw new Error(`Recovery signup failed: ${response.status()} ${JSON.stringify(payload)}`);
  }
  const safeAccount = { email: QA_EMAIL, userId: payload.user?.id || null };
  await writeFile(join(OUTPUT_DIR, "qa-account.json"), JSON.stringify(safeAccount, null, 2));
  console.log(`VIDGER_RECOVERY_ACCOUNT email=${QA_EMAIL} userId=${safeAccount.userId || "unknown"}`);
}

async function loadAccount(page) {
  const response = await page.request.get(`${BASE_URL}/api/account`, { timeout: 30_000 });
  const payload = await readJson(response);
  return { response, payload };
}

async function waitForSharedWorkspace(page) {
  for (let attempt = 1; attempt <= 180; attempt += 1) {
    const { response, payload } = await loadAccount(page);
    if (response.ok()) {
      const workspace = first(payload.workspace) || {};
      const organizationId = workspace.organization_id || workspace.organizationId || null;
      if (organizationId === TARGET_ORGANIZATION_ID) {
        console.log(`VIDGER_RECOVERY_ACCESS_READY email=${QA_EMAIL} organization=${organizationId}`);
        return payload;
      }
    }
    if (attempt % 12 === 0) {
      console.log(`VIDGER_RECOVERY_WAITING_FOR_ACCESS email=${QA_EMAIL} attempt=${attempt}`);
    }
    await sleep(5_000);
  }
  throw new Error(`Shared QA workspace access was not granted for ${QA_EMAIL}.`);
}

async function pollStatus(page, testCase) {
  const query = new URLSearchParams({ requestId: testCase.requestId, model: testCase.model });
  let last = null;
  for (let attempt = 1; attempt <= 300; attempt += 1) {
    const response = await page.request.get(`${BASE_URL}/api/providers/fal/status?${query.toString()}`, {
      timeout: 60_000,
    }).catch(() => null);
    if (!response) {
      last = { http: 0, payload: { error: "NETWORK_FAILURE" } };
    } else {
      const payload = await readJson(response);
      last = { http: response.status(), payload };
      if (response.ok()) {
        if (payload.status === "COMPLETED" && payload.video?.url) return payload;
        if (payload.error) throw new Error(String(payload.error));
      }
    }
    if (attempt % 10 === 0) {
      console.log(`VIDGER_RECOVERY_WAIT case=${testCase.id} attempt=${attempt} http=${last.http} provider=${last.payload?.status || last.payload?.error || "unknown"}`);
    }
    await sleep(3_000);
  }
  throw new Error(`Recovery timed out: ${JSON.stringify(last)}`);
}

async function recoverCase(context, testCase) {
  const page = await context.newPage();
  const result = {
    ...testCase,
    status: "STARTED",
    providerStatus: null,
    persistedStatus: null,
    outputFile: null,
    screenshots: [],
    player: null,
    error: null,
    startedAt: new Date().toISOString(),
  };

  try {
    result.providerStatus = await pollStatus(page, testCase);
    const query = new URLSearchParams({ requestId: testCase.requestId, model: testCase.model });

    const download = await page.request.get(`${BASE_URL}/api/providers/fal/download?${query.toString()}`, {
      timeout: 180_000,
    });
    if (!download.ok()) {
      throw new Error(`Secure download failed: ${download.status()} ${JSON.stringify(await readJson(download))}`);
    }
    const outputPath = join(VIDEO_DIR, `${testCase.id}.mp4`);
    await writeFile(outputPath, await download.body());
    result.outputFile = outputPath;

    await page.goto(`${BASE_URL}/app?${query.toString()}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("[data-prompt-result] video", { state: "visible", timeout: 180_000 });
    await page.waitForTimeout(1_500);

    result.player = await page.evaluate(() => {
      const player = document.querySelector("[data-prompt-result] video");
      if (!player) return null;
      return {
        currentSrc: player.currentSrc || player.src,
        duration: Number.isFinite(player.duration) ? player.duration : null,
        width: player.videoWidth || null,
        height: player.videoHeight || null,
        readyState: player.readyState,
      };
    });

    const readyPath = join(SCREENSHOT_DIR, `${testCase.id}-ready.png`);
    await page.screenshot({ path: readyPath, fullPage: true });
    result.screenshots.push(readyPath);

    const cover = page.locator("[data-prompt-result] .video-cover");
    if (await cover.isVisible().catch(() => false)) {
      await cover.click().catch(() => null);
      await page.waitForTimeout(1_500);
      const playingPath = join(SCREENSHOT_DIR, `${testCase.id}-playing.png`);
      await page.screenshot({ path: playingPath, fullPage: true });
      result.screenshots.push(playingPath);
    }

    const { response: accountResponse, payload: account } = await loadAccount(page);
    if (!accountResponse.ok()) throw new Error(`Final account check failed: ${accountResponse.status()}`);
    const generation = rows(account.generations).find((item) => String(item.request_id || item.requestId || "") === testCase.requestId);
    result.persistedStatus = generation?.status || null;
    if (String(result.persistedStatus || "").toUpperCase() !== "COMPLETED") {
      throw new Error(`Recovered provider video persisted as ${result.persistedStatus || "missing"}.`);
    }

    result.status = "COMPLETED";
    console.log(`VIDGER_RECOVERY_COMPLETED case=${testCase.id} requestId=${testCase.requestId} persisted=${result.persistedStatus} file=${outputPath}`);
  } catch (error) {
    result.status = "FAILED";
    result.error = error instanceof Error ? error.message : String(error);
    console.error(`VIDGER_RECOVERY_FAILED case=${testCase.id} error=${result.error}`);
    const failurePath = join(SCREENSHOT_DIR, `${testCase.id}-failure.png`);
    await page.screenshot({ path: failurePath, fullPage: true }).catch(() => null);
    result.screenshots.push(failurePath);
  } finally {
    result.finishedAt = new Date().toISOString();
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
    await bootstrap.goto(SHARE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await signUp(bootstrap);
    await waitForSharedWorkspace(bootstrap);
    await bootstrap.goto(`${BASE_URL}/app`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const workspacePath = join(SCREENSHOT_DIR, "shared-recovery-workspace.png");
    await bootstrap.screenshot({ path: workspacePath, fullPage: true });

    const results = [];
    for (const testCase of cases) results.push(await recoverCase(context, testCase));

    const summary = {
      baseUrl: BASE_URL,
      qaEmail: QA_EMAIL,
      runId: RUN_ID,
      submittedNewGenerations: 0,
      completed: results.filter((item) => item.status === "COMPLETED").length,
      failed: results.filter((item) => item.status !== "COMPLETED").length,
      results,
    };
    await writeFile(join(OUTPUT_DIR, "recovery-summary.json"), JSON.stringify(summary, null, 2));
    console.log(`VIDGER_RECOVERY_SUMMARY completed=${summary.completed} failed=${summary.failed} newGenerations=0`);
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
