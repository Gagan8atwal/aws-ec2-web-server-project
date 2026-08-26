import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";

const BASE_URL = "https://omnimedia-engine-git-feat-65ab1f-gagandeep-singh-s-projects559.vercel.app";
const SHARE_TOKEN = "6ZI1c7ecQb5eRm1NzoPFSihnmJCTWkfp";
const TARGET_ORGANIZATION_ID = "4267241c-13d3-45b8-a422-5a05af738d67";
const TARGET_ORGANIZATION_NAME = "Vidger Production Matrix QA Workspace";
const TARGET_REQUEST_ID = "01a0367c-f733-78b1-873c-31eab6a5f3ab";
const TARGET_MODEL = "fal-ai/kling-video/v3/standard/text-to-video";
const RUN_ID = process.env.GITHUB_RUN_ID || String(Date.now());
const QA_EMAIL = `hello+vidgerbranding-${RUN_ID}@pivotcalls.co`;
const QA_PASSWORD = `Vg!${crypto.randomBytes(30).toString("base64url")}9a`;
const OUTPUT_DIR = join(process.cwd(), "artifacts", "vidger-branding-proof");
const SCREENSHOT_DIR = join(OUTPUT_DIR, "screenshots");
const VIDEO_DIR = join(OUTPUT_DIR, "videos");
const FRAME_DIR = join(OUTPUT_DIR, "frames");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function previewUrl(pathOrUrl) {
  const url = new URL(pathOrUrl, BASE_URL);
  url.searchParams.set("_vercel_share", SHARE_TOKEN);
  return url.toString();
}

async function readJson(response) {
  const body = await response.text();
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    return { raw: body };
  }
}

async function signUp(page) {
  const response = await page.request.post(previewUrl("/api/auth"), {
    headers: { "content-type": "application/json" },
    data: {
      action: "signUp",
      email: QA_EMAIL,
      password: QA_PASSWORD,
      fullName: "Vidger Branding QA",
    },
    timeout: 30_000,
  });
  const payload = await readJson(response);
  if (!response.ok() || !payload.signedIn) {
    throw new Error(`QA signup failed: ${response.status()} ${JSON.stringify(payload)}`);
  }
  const account = { email: QA_EMAIL, password: QA_PASSWORD, userId: payload.user?.id || null };
  await writeFile(join(OUTPUT_DIR, "qa-account.json"), JSON.stringify(account, null, 2));
  console.log(`VIDGER_BRANDING_ACCOUNT email=${QA_EMAIL} userId=${account.userId || "unknown"}`);
  return account;
}

async function getAccount(page) {
  const response = await page.request.get(previewUrl("/api/account"), { timeout: 30_000 });
  return { response, payload: await readJson(response) };
}

async function waitForTargetAccess(page) {
  for (let attempt = 1; attempt <= 240; attempt += 1) {
    const { response, payload } = await getAccount(page);
    const workspace = Array.isArray(payload.workspace) ? payload.workspace[0] : payload.workspace;
    const organizationId = workspace?.organization_id || workspace?.organizationId || null;
    if (response.ok() && organizationId === TARGET_ORGANIZATION_ID) {
      console.log(`VIDGER_BRANDING_ACCESS_READY email=${QA_EMAIL} organization=${organizationId}`);
      return payload;
    }
    if (attempt % 12 === 0) console.log(`VIDGER_BRANDING_WAITING_FOR_ACCESS email=${QA_EMAIL} attempt=${attempt}`);
    await sleep(3_000);
  }
  throw new Error("Target workspace access was not granted in time.");
}

async function waitForPlatformAdmin(page) {
  console.log(`VIDGER_BRANDING_WAITING_FOR_PLATFORM_ADMIN email=${QA_EMAIL}`);
  for (let attempt = 1; attempt <= 240; attempt += 1) {
    const response = await page.request.get(previewUrl("/api/branding?owner=1"), { timeout: 30_000 });
    if (response.ok()) {
      console.log(`VIDGER_BRANDING_PLATFORM_ADMIN_READY email=${QA_EMAIL}`);
      return readJson(response);
    }
    if (attempt % 12 === 0) console.log(`VIDGER_BRANDING_WAITING_FOR_PLATFORM_ADMIN email=${QA_EMAIL} attempt=${attempt}`);
    await sleep(3_000);
  }
  throw new Error("Temporary platform owner access was not granted in time.");
}

function exportQuery(mode, disposition = "attachment") {
  return new URLSearchParams({
    requestId: TARGET_REQUEST_ID,
    model: TARGET_MODEL,
    branding: mode,
    disposition,
  });
}

async function fetchExport(page, mode, outputPath) {
  const response = await page.request.get(previewUrl(`/api/providers/fal/export?${exportQuery(mode)}`), {
    timeout: 360_000,
  });
  if (!response.ok()) throw new Error(`${mode} export failed: ${response.status()} ${JSON.stringify(await readJson(response))}`);
  const branding = response.headers()["x-vidger-branding"] || null;
  const contentType = response.headers()["content-type"] || "";
  if (!contentType.startsWith("video/mp4")) throw new Error(`Unexpected ${mode} content type: ${contentType}`);
  if (branding !== mode) throw new Error(`Unexpected branding header for ${mode}: ${branding}`);
  await writeFile(outputPath, await response.body());
  console.log(`VIDGER_BRANDING_EXPORT_COMPLETED mode=${mode} file=${outputPath}`);
}

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
  return result;
}

async function inspectVideos(brandedPath, logoFreePath) {
  const probeArgs = [
    "-v", "error",
    "-show_entries", "format=duration:format_tags=comment,encoder:stream=codec_type,codec_name,width,height",
    "-of", "json",
  ];
  const branded = JSON.parse(run("ffprobe", [...probeArgs, brandedPath], "branded ffprobe").stdout);
  const logoFree = JSON.parse(run("ffprobe", [...probeArgs, logoFreePath], "logo-free ffprobe").stdout);
  if (branded.format?.tags?.comment !== "Branded by Vidger") {
    throw new Error(`Branded MP4 metadata missing: ${JSON.stringify(branded.format?.tags || {})}`);
  }
  if (!branded.streams?.some((stream) => stream.codec_type === "video" && stream.codec_name === "h264")) {
    throw new Error("Branded MP4 does not contain H.264 video.");
  }
  await writeFile(join(OUTPUT_DIR, "ffprobe.json"), JSON.stringify({ branded, logoFree }, null, 2));

  const brandedFrame = join(FRAME_DIR, "branded-frame.jpg");
  const logoFreeFrame = join(FRAME_DIR, "logo-free-frame.jpg");
  const comparison = join(FRAME_DIR, "branded-vs-logo-free.jpg");
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "2", "-i", brandedPath, "-frames:v", "1", "-q:v", "2", brandedFrame], "branded frame");
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "2", "-i", logoFreePath, "-frames:v", "1", "-q:v", "2", logoFreeFrame], "logo-free frame");
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", logoFreeFrame,
    "-i", brandedFrame,
    "-filter_complex", "[0:v]drawtext=text='LOGO-FREE':x=24:y=24:fontsize=32:fontcolor=white:box=1:boxcolor=black@0.65[left];[1:v]drawtext=text='VIDGER BRANDED':x=24:y=24:fontsize=32:fontcolor=white:box=1:boxcolor=black@0.65[right];[left][right]hstack=inputs=2[out]",
    "-map", "[out]", "-frames:v", "1", comparison,
  ], "comparison frame");
  console.log(`VIDGER_BRANDING_FRAME_PROOF file=${comparison}`);
}

async function openGeneration(page, label) {
  const target = previewUrl(`/app?request=${encodeURIComponent(TARGET_REQUEST_ID)}&model=${encodeURIComponent(TARGET_MODEL)}`);
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60_000 });

  let state = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await page.waitForFunction(() => {
        const result = document.querySelector("[data-prompt-result]");
        const video = result?.querySelector("video");
        const mark = result?.querySelector(".video-stage > .vidger-video-mark");
        const control = result?.querySelector("[data-vidger-branding-control]");
        return Boolean(result && !result.hidden && video && mark && control);
      }, null, { timeout: 55_000 });
      state = await page.evaluate(() => {
        const result = document.querySelector("[data-prompt-result]");
        const video = result?.querySelector("video");
        const mark = result?.querySelector(".video-stage > .vidger-video-mark");
        const control = result?.querySelector("[data-vidger-branding-control]");
        const rect = (element) => element ? {
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
          display: getComputedStyle(element).display,
          visibility: getComputedStyle(element).visibility,
          opacity: getComputedStyle(element).opacity,
        } : null;
        return {
          resultHidden: result?.hidden ?? null,
          resultText: result?.innerText || "",
          video: video ? {
            src: video.currentSrc || video.src,
            readyState: video.readyState,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            rect: rect(video),
          } : null,
          mark: rect(mark),
          control: rect(control),
        };
      });
      if (!state.video?.src.includes("/api/providers/fal/playback?")) throw new Error(`Unexpected player source: ${state.video?.src}`);
      if (!state.mark || state.mark.width <= 0 || state.mark.height <= 0 || state.mark.display === "none" || state.mark.visibility === "hidden") {
        throw new Error(`Vidger mark is not visibly rendered: ${JSON.stringify(state.mark)}`);
      }
      if (!state.control || state.control.width <= 0 || state.control.height <= 0 || state.control.display === "none") {
        throw new Error(`Branding control is not visibly rendered: ${JSON.stringify(state.control)}`);
      }
      await page.locator("[data-prompt-result]").scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SCREENSHOT_DIR, `${label}.png`), fullPage: true });
      await writeFile(join(OUTPUT_DIR, `${label}-ui-state.json`), JSON.stringify(state, null, 2));
      return state;
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        body: document.body.innerText.slice(0, 12_000),
        result: document.querySelector("[data-prompt-result]")?.innerHTML || null,
      })).catch(() => ({ body: "", result: null }));
      await writeFile(join(OUTPUT_DIR, `${label}-attempt-${attempt}.json`), JSON.stringify({ error: error.message, diagnostic }, null, 2));
      if (attempt === 4) throw error;
      await sleep(1_500 * attempt);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    }
  }
  return state;
}

async function main() {
  await Promise.all([
    mkdir(OUTPUT_DIR, { recursive: true }),
    mkdir(SCREENSHOT_DIR, { recursive: true }),
    mkdir(VIDEO_DIR, { recursive: true }),
    mkdir(FRAME_DIR, { recursive: true }),
  ]);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const consoleEvents = [];
  page.on("console", (message) => consoleEvents.push({ type: message.type(), text: message.text() }));
  page.on("pageerror", (error) => consoleEvents.push({ type: "pageerror", text: error.message }));
  const summary = {
    baseUrl: BASE_URL,
    runId: RUN_ID,
    qaEmail: QA_EMAIL,
    sourceGeneration: TARGET_REQUEST_ID,
    submittedNewGenerations: 0,
    checks: {},
  };

  try {
    await page.goto(previewUrl("/"), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await signUp(page);
    await waitForTargetAccess(page);

    const policyResponse = await page.request.get(previewUrl("/api/branding"));
    const initialPolicy = await readJson(policyResponse);
    if (!policyResponse.ok() || initialPolicy.policy?.can_export_logo_free !== false) {
      throw new Error(`Logo-free must default to false: ${JSON.stringify(initialPolicy)}`);
    }
    summary.checks.defaultPolicyDenied = true;

    const statusQuery = new URLSearchParams({ requestId: TARGET_REQUEST_ID, model: TARGET_MODEL });
    const statusResponse = await page.request.get(previewUrl(`/api/providers/fal/status?${statusQuery}`));
    const statusPayload = await readJson(statusResponse);
    if (!statusResponse.ok() || statusPayload.status !== "COMPLETED") {
      throw new Error(`Completed generation status unavailable: ${statusResponse.status()} ${JSON.stringify(statusPayload)}`);
    }
    if (!String(statusPayload.video?.url || "").startsWith("/api/providers/fal/playback?")) {
      throw new Error(`Provider media URL was exposed: ${JSON.stringify(statusPayload.video)}`);
    }
    summary.checks.providerUrlHidden = true;

    await openGeneration(page, "default-vidger-preview");
    const defaultLogoFree = page.locator('.vidger-mode-button[data-mode="none"]');
    if (!await defaultLogoFree.isDisabled()) throw new Error("Logo-free control was enabled before entitlement.");
    const defaultDownload = await page.locator("[data-vidger-export]").innerText();
    if (!/Download with Vidger/i.test(defaultDownload)) throw new Error(`Unexpected default download label: ${defaultDownload}`);
    summary.checks.defaultPreviewMarked = true;

    const denied = await page.request.get(previewUrl(`/api/providers/fal/export?${exportQuery("none")}`), { timeout: 60_000 });
    if (denied.status() !== 403) throw new Error(`Logo-free direct request should be 403, received ${denied.status()}.`);
    summary.checks.directLogoFreeDenied = true;

    const brandedPath = join(VIDEO_DIR, "vidger-branded.mp4");
    await fetchExport(page, "vidger", brandedPath);
    summary.checks.brandedExportCompleted = true;

    await waitForPlatformAdmin(page);
    await page.goto(previewUrl("/owner"), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("[data-vidger-branding-admin]", { state: "attached", timeout: 120_000 });
    const row = page.locator("[data-vidger-branding-admin] tbody tr").filter({ hasText: TARGET_ORGANIZATION_NAME });
    if (await row.count() !== 1) throw new Error("Target organization branding row was not found.");
    await page.screenshot({ path: join(SCREENSHOT_DIR, "owner-branding-controls-before.png"), fullPage: true });
    await row.getByRole("button", { name: "Allow logo-free" }).click();
    await page.waitForFunction((name) => {
      const rows = Array.from(document.querySelectorAll("[data-vidger-branding-admin] tbody tr"));
      const target = rows.find((item) => item.textContent.includes(name));
      return target && target.textContent.includes("Enabled") && target.textContent.includes("Disable logo-free");
    }, TARGET_ORGANIZATION_NAME, { timeout: 60_000 });
    await page.screenshot({ path: join(SCREENSHOT_DIR, "owner-branding-controls-enabled.png"), fullPage: true });
    summary.checks.ownerGrantedLogoFree = true;

    await openGeneration(page, "logo-free-option-enabled");
    const logoFreeButton = page.locator('.vidger-mode-button[data-mode="none"]');
    if (await logoFreeButton.isDisabled()) throw new Error("Logo-free control remained disabled after owner grant.");
    await logoFreeButton.click();
    await page.waitForFunction(() => document.querySelector(".video-stage > .vidger-video-mark")?.dataset.hidden === "true");
    await page.screenshot({ path: join(SCREENSHOT_DIR, "logo-free-selected.png"), fullPage: true });
    summary.checks.logoFreeUiEnabled = true;

    const logoFreePath = join(VIDEO_DIR, "logo-free.mp4");
    await fetchExport(page, "none", logoFreePath);
    summary.checks.logoFreeExportCompleted = true;
    await inspectVideos(brandedPath, logoFreePath);
    summary.checks.burnedWatermarkVerified = true;

    await page.goto(previewUrl("/owner"), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("[data-vidger-branding-admin]", { state: "attached", timeout: 120_000 });
    const enabledRow = page.locator("[data-vidger-branding-admin] tbody tr").filter({ hasText: TARGET_ORGANIZATION_NAME });
    await enabledRow.getByRole("button", { name: "Disable logo-free" }).click();
    await page.waitForFunction((name) => {
      const rows = Array.from(document.querySelectorAll("[data-vidger-branding-admin] tbody tr"));
      const target = rows.find((item) => item.textContent.includes(name));
      return target && target.textContent.includes("Disabled") && target.textContent.includes("Allow logo-free");
    }, TARGET_ORGANIZATION_NAME, { timeout: 60_000 });
    const deniedAgain = await page.request.get(previewUrl(`/api/providers/fal/export?${exportQuery("none")}`), { timeout: 60_000 });
    if (deniedAgain.status() !== 403) throw new Error(`Logo-free should be denied again, received ${deniedAgain.status()}.`);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "owner-branding-controls-disabled-again.png"), fullPage: true });
    summary.checks.ownerRevokedLogoFree = true;

    summary.success = true;
    await writeFile(join(OUTPUT_DIR, "proof-summary.json"), JSON.stringify(summary, null, 2));
    console.log(`VIDGER_BRANDING_PROOF_COMPLETE email=${QA_EMAIL} newGenerations=0`);
  } catch (error) {
    summary.success = false;
    summary.error = error instanceof Error ? error.stack || error.message : String(error);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "failure.png"), fullPage: true }).catch(() => null);
    await writeFile(join(OUTPUT_DIR, "proof-summary.json"), JSON.stringify(summary, null, 2));
    throw error;
  } finally {
    await writeFile(join(OUTPUT_DIR, "browser-console.json"), JSON.stringify(consoleEvents.slice(-250), null, 2)).catch(() => null);
    await page.close().catch(() => null);
    await context.close().catch(() => null);
    await browser.close().catch(() => null);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
