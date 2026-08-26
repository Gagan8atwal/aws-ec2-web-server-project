import { chromium } from "playwright";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const BASE_URL = "https://omnimedia-engine-g8n9tj0vh-gagandeep-singh-s-projects559.vercel.app";
const SHARE_URL = `${BASE_URL}/?_vercel_share=0JaTjgzO5Nu7bHpSjIlDMKldgCA1nyqR`;
const REQUEST_ID = "01a0367d-e0df-7513-be18-e110b7fb9f9f";
const MODEL = "fal-ai/kling-video/v3/standard/text-to-video";
const TARGET_ORGANIZATION_ID = "4267241c-13d3-45b8-a422-5a05af738d67";
const TARGET_ORGANIZATION_NAME = "Vidger Production Matrix QA Workspace";
const RUN_ID = process.env.GITHUB_RUN_ID || String(Date.now());
const QA_EMAIL = `hello+vidgerbranding-${RUN_ID}@pivotcalls.co`;
const QA_PASSWORD = `Vg!${randomBytes(30).toString("base64url")}9a`;
const OUTPUT_DIR = join(process.cwd(), "artifacts", "vidger-branding-proof");
const SCREENSHOT_DIR = join(OUTPUT_DIR, "screenshots");
const VIDEO_DIR = join(OUTPUT_DIR, "videos");
const STORYBOARD_DIR = join(OUTPUT_DIR, "storyboards");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(response) {
  const body = await response.text();
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    return { raw: body };
  }
}

async function requestJson(page, url, options = {}) {
  const response = await page.request.fetch(url, { timeout: 360_000, ...options });
  return { response, payload: await readJson(response) };
}

async function signUp(page) {
  const { response, payload } = await requestJson(page, `${BASE_URL}/api/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    data: {
      action: "signUp",
      email: QA_EMAIL,
      password: QA_PASSWORD,
      fullName: "Vidger Branding Live Proof",
    },
  });
  if (!response.ok() || !payload.signedIn || !payload.user?.id) {
    throw new Error(`QA signup failed: ${response.status()} ${JSON.stringify(payload)}`);
  }
  const account = { email: QA_EMAIL, userId: payload.user.id };
  await writeFile(join(OUTPUT_DIR, "qa-account.json"), JSON.stringify(account, null, 2));
  console.log(`VIDGER_BRANDING_ACCOUNT email=${QA_EMAIL} userId=${account.userId}`);
  return account;
}

async function getAccount(page, owner = false) {
  return requestJson(page, `${BASE_URL}/api/account${owner ? "?owner=1" : ""}`);
}

async function waitForTargetWorkspace(page) {
  for (let attempt = 1; attempt <= 180; attempt += 1) {
    const { response, payload } = await getAccount(page);
    const workspace = Array.isArray(payload.workspace) ? payload.workspace[0] : payload.workspace;
    if (response.ok() && workspace?.organization_id === TARGET_ORGANIZATION_ID) {
      console.log(`VIDGER_BRANDING_ACCESS_READY email=${QA_EMAIL} organization=${TARGET_ORGANIZATION_ID}`);
      return payload;
    }
    if (attempt % 10 === 0) {
      console.log(`VIDGER_BRANDING_WAITING_FOR_ACCESS email=${QA_EMAIL} attempt=${attempt}`);
    }
    await sleep(5_000);
  }
  throw new Error(`Target organization access was not granted for ${QA_EMAIL}.`);
}

async function waitForPlatformAdmin(page) {
  console.log(`VIDGER_BRANDING_WAITING_FOR_ADMIN email=${QA_EMAIL}`);
  for (let attempt = 1; attempt <= 180; attempt += 1) {
    const { response } = await getAccount(page, true);
    if (response.ok()) {
      console.log(`VIDGER_BRANDING_ADMIN_READY email=${QA_EMAIL}`);
      return;
    }
    if (attempt % 10 === 0) {
      console.log(`VIDGER_BRANDING_ADMIN_PENDING email=${QA_EMAIL} attempt=${attempt}`);
    }
    await sleep(5_000);
  }
  throw new Error(`Platform-admin access was not granted for ${QA_EMAIL}.`);
}

function appUrl() {
  const query = new URLSearchParams({ request: REQUEST_ID, model: MODEL });
  return `${BASE_URL}/app?${query.toString()}`;
}

function exportUrl(mode) {
  const query = new URLSearchParams({
    requestId: REQUEST_ID,
    model: MODEL,
    branding: mode,
    disposition: "attachment",
  });
  return `${BASE_URL}/api/providers/fal/export?${query.toString()}`;
}

async function saveUiDownload(page, button, path) {
  const downloadPromise = page.waitForEvent("download", { timeout: 360_000 });
  await button.click();
  const download = await downloadPromise;
  await download.saveAs(path);
  const failure = await download.failure();
  if (failure) throw new Error(`Browser download failed: ${failure}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${(result.stderr || result.stdout || "").slice(-2000)}`);
  }
  return result.stdout.trim();
}

function ffprobeJson(path) {
  return JSON.parse(run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,size:format_tags=comment,encoder:stream=codec_type,codec_name,width,height,r_frame_rate",
    "-of", "json",
    path,
  ]));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readFileSync(path) {
  return requireFs().readFileSync(path);
}

let fsModule;
function requireFs() {
  if (!fsModule) {
    const loaded = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
    void loaded;
    throw new Error("unreachable");
  }
  return fsModule;
}

async function fileSha256(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

function createStoryboard(input, output) {
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", input,
    "-vf", "fps=1,scale=480:-1,tile=3x2:padding=8:margin=8:color=0x111111",
    "-frames:v", "1",
    output,
  ]);
}

function assertMedia(probe, { branded }) {
  const video = (probe.streams || []).find((stream) => stream.codec_type === "video");
  if (!video || video.codec_name !== "h264") throw new Error("Expected H.264 video output.");
  const duration = Number(probe.format?.duration || 0);
  if (!(duration > 1 && duration < 20)) throw new Error(`Unexpected output duration ${duration}.`);
  const comment = String(probe.format?.tags?.comment || "");
  if (branded && !/Branded by Vidger/i.test(comment)) {
    throw new Error(`Branded output metadata missing: ${JSON.stringify(probe.format?.tags || {})}`);
  }
  if (!branded && /Branded by Vidger/i.test(comment)) {
    throw new Error("Logo-free output unexpectedly carries Vidger branding metadata.");
  }
}

async function policy(page) {
  const { response, payload } = await requestJson(page, `${BASE_URL}/api/branding`);
  if (!response.ok()) throw new Error(`Policy request failed: ${response.status()} ${JSON.stringify(payload)}`);
  return payload.policy || {};
}

async function waitForVideoUi(page) {
  await page.waitForSelector("[data-prompt-result] video", { state: "visible", timeout: 180_000 });
  await page.waitForSelector(".vidger-video-mark", { state: "visible", timeout: 60_000 });
  await page.waitForSelector("[data-vidger-branding-control]", { state: "visible", timeout: 60_000 });
  await page.waitForSelector("[data-vidger-export]", { state: "visible", timeout: 60_000 });
}

async function main() {
  await Promise.all([
    mkdir(OUTPUT_DIR, { recursive: true }),
    mkdir(SCREENSHOT_DIR, { recursive: true }),
    mkdir(VIDEO_DIR, { recursive: true }),
    mkdir(STORYBOARD_DIR, { recursive: true }),
  ]);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  const page = await context.newPage();
  const browserEvents = [];
  page.on("console", (message) => browserEvents.push({ type: message.type(), text: message.text() }));
  page.on("pageerror", (error) => browserEvents.push({ type: "pageerror", text: error.message }));

  const proof = {
    baseUrl: BASE_URL,
    runId: RUN_ID,
    qaEmail: QA_EMAIL,
    requestId: REQUEST_ID,
    model: MODEL,
    submittedNewGenerations: 0,
    defaultPolicy: null,
    deniedLogoFree: null,
    branded: null,
    ownerGrant: null,
    logoFree: null,
    policyReset: null,
    browserEvents,
  };

  try {
    await page.goto(SHARE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await signUp(page);
    await waitForTargetWorkspace(page);

    proof.defaultPolicy = await policy(page);
    if (proof.defaultPolicy.can_export_logo_free === true || proof.defaultPolicy.logo_free_exports_enabled === true) {
      throw new Error(`Expected logo-free to be disabled by default: ${JSON.stringify(proof.defaultPolicy)}`);
    }

    const denied = await requestJson(page, exportUrl("none"), { method: "GET" });
    proof.deniedLogoFree = { status: denied.response.status(), payload: denied.payload };
    if (denied.response.status() !== 403 || denied.payload.error !== "LOGO_FREE_NOT_ENABLED") {
      throw new Error(`Logo-free fail-closed proof failed: ${denied.response.status()} ${JSON.stringify(denied.payload)}`);
    }
    console.log("VIDGER_BRANDING_LOGO_FREE_DENIED status=403");

    await page.goto(appUrl(), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => {
      const gate = document.querySelector("[data-auth-gate]");
      return !gate || gate.hidden || getComputedStyle(gate).display === "none";
    }, null, { timeout: 60_000 });
    await waitForVideoUi(page);
    const brandedMark = page.locator(".video-stage > .vidger-video-mark");
    if (!(await brandedMark.isVisible())) throw new Error("Default Vidger preview mark is not visible.");
    const logoFreeButtonBefore = page.getByRole("button", { name: "Logo-free", exact: true });
    if (!(await logoFreeButtonBefore.isDisabled())) throw new Error("Logo-free selector should be disabled before owner grant.");
    await page.screenshot({ path: join(SCREENSHOT_DIR, "01-default-vidger-preview.png"), fullPage: true });

    const brandedPath = join(VIDEO_DIR, "vidger-branded.mp4");
    await saveUiDownload(page, page.locator("[data-vidger-export]"), brandedPath);
    const brandedProbe = ffprobeJson(brandedPath);
    assertMedia(brandedProbe, { branded: true });
    const brandedStoryboard = join(STORYBOARD_DIR, "vidger-branded-storyboard.jpg");
    createStoryboard(brandedPath, brandedStoryboard);
    proof.branded = {
      path: brandedPath,
      storyboard: brandedStoryboard,
      sha256: await fileSha256(brandedPath),
      probe: brandedProbe,
      previewMarkVisible: true,
    };
    console.log(`VIDGER_BRANDING_BRANDED_COMPLETED file=${brandedPath}`);

    await waitForPlatformAdmin(page);
    await page.goto(`${BASE_URL}/owner`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("[data-vidger-branding-admin]", { state: "visible", timeout: 120_000 });
    const targetRow = page.locator("[data-vidger-branding-admin] tr", { hasText: TARGET_ORGANIZATION_NAME });
    await targetRow.waitFor({ state: "visible", timeout: 60_000 });
    const allowButton = targetRow.getByRole("button", { name: "Allow logo-free", exact: true });
    await allowButton.click();
    await page.waitForFunction((name) => {
      const rows = [...document.querySelectorAll("[data-vidger-branding-admin] tr")];
      const row = rows.find((item) => item.textContent.includes(name));
      return row && row.textContent.includes("Enabled") && row.textContent.includes("Disable logo-free");
    }, TARGET_ORGANIZATION_NAME, { timeout: 60_000 });
    await page.screenshot({ path: join(SCREENSHOT_DIR, "02-owner-logo-free-granted.png"), fullPage: true });
    proof.ownerGrant = { organizationId: TARGET_ORGANIZATION_ID, enabled: true };
    console.log("VIDGER_BRANDING_OWNER_GRANTED logoFree=true");

    await page.goto(appUrl(), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => {
      const gate = document.querySelector("[data-auth-gate]");
      return !gate || gate.hidden || getComputedStyle(gate).display === "none";
    }, null, { timeout: 60_000 });
    await waitForVideoUi(page);
    const logoFreeButton = page.getByRole("button", { name: "Logo-free", exact: true });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll(".vidger-mode-button")].find((item) => item.textContent.trim() === "Logo-free");
      return button && !button.disabled;
    }, null, { timeout: 60_000 });
    await logoFreeButton.click();
    await page.waitForFunction(() => {
      const mark = document.querySelector(".video-stage > .vidger-video-mark");
      return mark && mark.dataset.hidden === "true";
    }, null, { timeout: 30_000 });
    await page.screenshot({ path: join(SCREENSHOT_DIR, "03-logo-free-preview-selected.png"), fullPage: true });

    const logoFreePath = join(VIDEO_DIR, "vidger-logo-free.mp4");
    await saveUiDownload(page, page.locator("[data-vidger-export]"), logoFreePath);
    const logoFreeProbe = ffprobeJson(logoFreePath);
    assertMedia(logoFreeProbe, { branded: false });
    const logoFreeStoryboard = join(STORYBOARD_DIR, "vidger-logo-free-storyboard.jpg");
    createStoryboard(logoFreePath, logoFreeStoryboard);
    proof.logoFree = {
      path: logoFreePath,
      storyboard: logoFreeStoryboard,
      sha256: await fileSha256(logoFreePath),
      probe: logoFreeProbe,
      previewMarkHidden: true,
    };
    if (proof.logoFree.sha256 === proof.branded.sha256) throw new Error("Branded and logo-free outputs are unexpectedly identical.");
    console.log(`VIDGER_BRANDING_LOGO_FREE_COMPLETED file=${logoFreePath}`);

    await page.goto(`${BASE_URL}/owner`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("[data-vidger-branding-admin]", { state: "visible", timeout: 120_000 });
    const resetRow = page.locator("[data-vidger-branding-admin] tr", { hasText: TARGET_ORGANIZATION_NAME });
    const disableButton = resetRow.getByRole("button", { name: "Disable logo-free", exact: true });
    await disableButton.click();
    await page.waitForFunction((name) => {
      const rows = [...document.querySelectorAll("[data-vidger-branding-admin] tr")];
      const row = rows.find((item) => item.textContent.includes(name));
      return row && row.textContent.includes("Disabled") && row.textContent.includes("Allow logo-free");
    }, TARGET_ORGANIZATION_NAME, { timeout: 60_000 });
    await page.screenshot({ path: join(SCREENSHOT_DIR, "04-owner-policy-reset.png"), fullPage: true });
    const resetPolicy = await policy(page);
    proof.policyReset = resetPolicy;
    if (resetPolicy.logo_free_exports_enabled === true) throw new Error("Logo-free policy did not reset to disabled.");
    console.log("VIDGER_BRANDING_POLICY_RESET logoFree=false");

    proof.status = "PASSED";
  } catch (error) {
    proof.status = "FAILED";
    proof.error = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`VIDGER_BRANDING_PROOF_FAILED error=${error instanceof Error ? error.message : String(error)}`);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "failure.png"), fullPage: true }).catch(() => null);
    process.exitCode = 1;
  } finally {
    await writeFile(join(OUTPUT_DIR, "proof-summary.json"), JSON.stringify(proof, null, 2));
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
