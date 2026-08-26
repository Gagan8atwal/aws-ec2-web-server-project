import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";

const BASE_URL = "https://omnimedia-engine-ie3pa7bo7-gagandeep-singh-s-projects559.vercel.app";
const SHARE_TOKEN = "On0mBmUlmVrdh4j0XHv6pIoYxXN1H8At";
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
    if (attempt % 12 === 0) {
      console.log(`VIDGER_BRANDING_WAITING_FOR_ACCESS email=${QA_EMAIL} attempt=${attempt}`);
    }
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
    if (attempt % 12 === 0) {
      console.log(`VIDGER_BRANDING_WAITING_FOR_PLATFORM_ADMIN email=${QA_EMAIL} attempt=${attempt}`);
    }
    await sleep(3_000);
  }
  throw new Error("Temporary platform owner access was not granted in time.");
}

function queryFor(mode, disposition = "attachment") {
  return new URLSearchParams({
    requestId: TARGET_REQUEST_ID,
    model: TARGET_MODEL,
    branding: mode,
    disposition,
  });
}

async function fetchExport(page, mode, outputPath) {
  const response = await page.request.get(previewUrl(`/api/providers/fal/export?${queryFor(mode)}`), {
    timeout: 360_000,
  });
  if (!response.ok()) {
    throw new Error(`${mode} export failed: ${response.status()} ${JSON.stringify(await readJson(response))}`);
  }
  const branding = response.headers()["x-vidger-branding"] || null;
  const contentType = response.headers()["content-type"] || "";
  if (!contentType.startsWith("video/mp4")) throw new Error(`Unexpected ${mode} content type: ${contentType}`);
  if (branding !== mode) throw new Error(`Unexpected branding header for ${mode}: ${branding}`);
  await writeFile(outputPath, await response.body());
  console.log(`VIDGER_BRANDING_EXPORT_COMPLETED mode=${mode} file=${outputPath}`);
}

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

async function inspectVideos(brandedPath, logoFreePath) {
  const brandedProbe = run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:format_tags=comment,encoder:stream=codec_type,codec_name,width,height",
    "-of", "json",
    brandedPath,
  ], "branded ffprobe");
  const logoFreeProbe = run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:format_tags=comment,encoder:stream=codec_type,codec_name,width,height",
    "-of", "json",
    logoFreePath,
  ], "logo-free ffprobe");
  const branded = JSON.parse(brandedProbe.stdout);
  const logoFree = JSON.parse(logoFreeProbe.stdout);
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

async function openGeneration(page) {
  const target = previewUrl(`/app?request=${encodeURIComponent(TARGET_REQUEST_ID)}&model=${encodeURIComponent(TARGET_MODEL)}`);
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("[data-prompt-result] video", { state: "visible", timeout: 180_000 });
  await page.waitForSelector(".video-stage > .vidger-video-mark", { state: "visible", timeout: 60_000 });
  await page.waitForSelector("[data-vidger-branding-control]", { state: "visible", timeout: 60_000 });
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

    await openGeneration(page);
    const defaultLogoFree = page.locator('.vidger-mode-button[data-mode="none"]');
    if (!await defaultLogoFree.isDisabled()) throw new Error("Logo-free control was enabled before entitlement.");
    const defaultDownload = await page.locator("[data-vidger-export]").innerText();
    if (!/Download with Vidger/i.test(defaultDownload)) throw new Error(`Unexpected default download label: ${defaultDownload}`);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "default-vidger-preview.png"), fullPage: true });
    summary.checks.defaultPreviewMarked = true;

    const denied = await page.request.get(previewUrl(`/api/providers/fal/export?${queryFor("none")}`), { timeout: 60_000 });
    if (denied.status() !== 403) throw new Error(`Logo-free direct request should be 403, received ${denied.status()}.`);
    summary.checks.directLogoFreeDenied = true;

    const brandedPath = join(VIDEO_DIR, "vidger-branded.mp4");
    await fetchExport(page, "vidger", brandedPath);
    summary.checks.brandedExportCompleted = true;

    await waitForPlatformAdmin(page);
    await page.goto(previewUrl("/owner"), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("[data-vidger-branding-admin]", { state: "visible", timeout: 120_000 });
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

    await openGeneration(page);
    const logoFreeButton = page.locator('.vidger-mode-button[data-mode="none"]');
    if (await logoFreeButton.isDisabled()) throw new Error("Logo-free control remained disabled after owner grant.");
    await logoFreeButton.click();
    await page.waitForFunction(() => document.querySelector(".video-stage > .vidger-video-mark")?.dataset.hidden === "true");
    await page.screenshot({ path: join(SCREENSHOT_DIR, "logo-free-option-enabled.png"), fullPage: true });
    summary.checks.logoFreeUiEnabled = true;

    const logoFreePath = join(VIDEO_DIR, "logo-free.mp4");
    await fetchExport(page, "none", logoFreePath);
    summary.checks.logoFreeExportCompleted = true;
    await inspectVideos(brandedPath, logoFreePath);
    summary.checks.burnedWatermarkVerified = true;

    await page.goto(previewUrl("/owner"), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("[data-vidger-branding-admin]", { state: "visible", timeout: 120_000 });
    const enabledRow = page.locator("[data-vidger-branding-admin] tbody tr").filter({ hasText: TARGET_ORGANIZATION_NAME });
    await enabledRow.getByRole("button", { name: "Disable logo-free" }).click();
    await page.waitForFunction((name) => {
      const rows = Array.from(document.querySelectorAll("[data-vidger-branding-admin] tbody tr"));
      const target = rows.find((item) => item.textContent.includes(name));
      return target && target.textContent.includes("Disabled") && target.textContent.includes("Allow logo-free");
    }, TARGET_ORGANIZATION_NAME, { timeout: 60_000 });
    const deniedAgain = await page.request.get(previewUrl(`/api/providers/fal/export?${queryFor("none")}`), { timeout: 60_000 });
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
    await page.close().catch(() => null);
    await context.close().catch(() => null);
    await browser.close().catch(() => null);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
