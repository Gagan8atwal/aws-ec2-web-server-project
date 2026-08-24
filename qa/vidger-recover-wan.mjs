import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import crypto from "node:crypto";

const BASE_URL = "https://omnimedia-engine.vercel.app";
const RUN_ID = process.env.GITHUB_RUN_ID || String(Date.now());
const QA_EMAIL = `hello+vidgerrecovery-${RUN_ID}@pivotcalls.co`;
const QA_PASSWORD = `Vg!${crypto.randomBytes(30).toString("base64url")}9a`;
const OUTPUT_DIR = join(process.cwd(), "artifacts", "vidger-recovery");
const SCREENSHOT_DIR = join(OUTPUT_DIR, "screenshots");
const VIDEO_DIR = join(OUTPUT_DIR, "videos");
const BROWSER_VIDEO_DIR = join(OUTPUT_DIR, "browser-recordings");

const cases = [
  {
    id: "commercial-semi-truck",
    model: "fal-ai/wan/v2.7/text-to-video",
    requestId: "01a0340a-8a35-7f91-841e-d1308b9e9718",
  },
  {
    id: "stylized-3d-character",
    model: "fal-ai/wan/v2.7/text-to-video",
    requestId: "01a0340a-8a80-77c3-aa7b-8aac83d85311",
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
      fullName: "Vidger Recovery QA",
    },
    timeout: 30_000,
  });
  const payload = await readJson(response);
  if (!response.ok() || !payload.signedIn) {
    throw new Error(`Recovery signup failed: ${response.status()} ${JSON.stringify(payload)}`);
  }
  console.log(`VIDGER_RECOVERY_ACCOUNT email=${QA_EMAIL} userId=${payload.user?.id || "unknown"}`);
  await writeFile(join(OUTPUT_DIR, "recovery-account.json"), JSON.stringify({ email: QA_EMAIL, userId: payload.user?.id || null }, null, 2));
}

async function resilientStatus(page, testCase) {
  const query = new URLSearchParams({ requestId: testCase.requestId, model: testCase.model });
  let last = null;
  for (let attempt = 1; attempt <= 120; attempt += 1) {
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
    if (attempt % 6 === 0) {
      console.log(`VIDGER_RECOVERY_WAIT case=${testCase.id} attempt=${attempt} http=${last.status} provider=${last.payload?.status || last.payload?.error || "unknown"}`);
    }
    await sleep(5_000);
  }
  throw new Error(`Recovery timed out: ${JSON.stringify(last)}`);
}

async function recoverCase(context, testCase) {
  const page = await context.newPage();
  const result = { ...testCase, status: "STARTED", outputFile: null, screenshotFile: null, providerStatus: null, error: null };
  try {
    const payload = await resilientStatus(page, testCase);
    result.providerStatus = payload;

    const query = new URLSearchParams({ requestId: testCase.requestId, model: testCase.model });
    const download = await page.request.get(`${BASE_URL}/api/providers/fal/download?${query.toString()}`, { timeout: 180_000 });
    if (!download.ok()) throw new Error(`Secure download failed: ${download.status()} ${JSON.stringify(await readJson(download))}`);
    const outputPath = join(VIDEO_DIR, `${testCase.id}.mp4`);
    await writeFile(outputPath, await download.body());
    result.outputFile = outputPath;

    await page.goto(`${BASE_URL}/app?${query.toString()}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("[data-prompt-result] video", { state: "visible", timeout: 120_000 });
    const screenshotPath = join(SCREENSHOT_DIR, `${testCase.id}-recovered.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    result.screenshotFile = screenshotPath;
    result.status = "COMPLETED";
    console.log(`VIDGER_RECOVERY_COMPLETED case=${testCase.id} requestId=${testCase.requestId} file=${outputPath}`);
  } catch (error) {
    result.status = "FAILED";
    result.error = error instanceof Error ? error.message : String(error);
    console.error(`VIDGER_RECOVERY_FAILED case=${testCase.id} error=${result.error}`);
    await page.screenshot({ path: join(SCREENSHOT_DIR, `${testCase.id}-failure.png`), fullPage: true }).catch(() => null);
  } finally {
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
    const results = await Promise.all(cases.map((testCase) => recoverCase(context, testCase)));
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
