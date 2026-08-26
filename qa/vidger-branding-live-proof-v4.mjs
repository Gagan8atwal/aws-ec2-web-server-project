import { chromium } from "playwright";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const BASE_URL = "https://omnimedia-engine-g8n9tj0vh-gagandeep-singh-s-projects559.vercel.app";
const SHARE_URL = `${BASE_URL}/?_vercel_share=0JaTjgzO5Nu7bHpSjIlDMKldgCA1nyqR`;
const TARGET_ORGANIZATION_ID = "4267241c-13d3-45b8-a422-5a05af738d67";
const TARGET_ORGANIZATION_NAME = "Vidger Production Matrix QA Workspace";
const MODEL = "fal-ai/kling-video/v3/standard/text-to-video";
const CANDIDATES = [
  { id: "dog-kling-16x9", requestId: "01a0367c-f48a-7190-b407-9d2c4c189e35", model: MODEL },
  { id: "basketball-kling-9x16", requestId: "01a0367c-f733-78b1-873c-31eab6a5f3ab", model: MODEL },
];
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
  try { return body ? JSON.parse(body) : {}; } catch { return { raw: body }; }
}

async function requestJson(page, url, options = {}) {
  const response = await page.request.fetch(url, { timeout: 360_000, ...options });
  return { response, payload: await readJson(response) };
}

async function signUp(page) {
  const { response, payload } = await requestJson(page, `${BASE_URL}/api/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    data: { action: "signUp", email: QA_EMAIL, password: QA_PASSWORD, fullName: "Vidger Branding Live Proof" },
  });
  if (!response.ok() || !payload.signedIn || !payload.user?.id) {
    throw new Error(`QA signup failed: ${response.status()} ${JSON.stringify(payload)}`);
  }
  const account = { email: QA_EMAIL, userId: payload.user.id };
  await writeFile(join(OUTPUT_DIR, "qa-account.json"), JSON.stringify(account, null, 2));
  console.log(`VIDGER_BRANDING_ACCOUNT email=${QA_EMAIL} userId=${account.userId}`);
  return account;
}

async function waitForSource(page) {
  for (let cycle = 1; cycle <= 180; cycle += 1) {
    for (const candidate of CANDIDATES) {
      const query = new URLSearchParams({ requestId: candidate.requestId, model: candidate.model });
      const { response, payload } = await requestJson(page, `${BASE_URL}/api/providers/fal/status?${query.toString()}`);
      if (response.ok() && payload.status === "COMPLETED" && payload.video?.url) {
        console.log(`VIDGER_BRANDING_ACCESS_READY email=${QA_EMAIL} candidate=${candidate.id}`);
        return { candidate, payload };
      }
    }
    if (cycle % 10 === 0) console.log(`VIDGER_BRANDING_WAITING_FOR_ACCESS email=${QA_EMAIL} cycle=${cycle}`);
    await sleep(5_000);
  }
  throw new Error("Existing completed generation was not accessible.");
}

async function waitForAdmin(page) {
  console.log(`VIDGER_BRANDING_WAITING_FOR_ADMIN email=${QA_EMAIL}`);
  for (let attempt = 1; attempt <= 180; attempt += 1) {
    const { response } = await requestJson(page, `${BASE_URL}/api/branding?owner=1`);
    if (response.ok()) {
      console.log(`VIDGER_BRANDING_ADMIN_READY email=${QA_EMAIL}`);
      return;
    }
    if (attempt % 10 === 0) console.log(`VIDGER_BRANDING_ADMIN_PENDING email=${QA_EMAIL} attempt=${attempt}`);
    await sleep(5_000);
  }
  throw new Error("Platform-admin access was not granted.");
}

async function policy(page) {
  const { response, payload } = await requestJson(page, `${BASE_URL}/api/branding`);
  if (!response.ok()) throw new Error(`Policy request failed: ${response.status()} ${JSON.stringify(payload)}`);
  return payload.policy || {};
}

function exportUrl(candidate, mode) {
  return `${BASE_URL}/api/providers/fal/export?${new URLSearchParams({
    requestId: candidate.requestId,
    model: candidate.model,
    branding: mode,
    disposition: "attachment",
  }).toString()}`;
}

async function downloadExport(page, candidate, mode, path) {
  const response = await page.request.get(exportUrl(candidate, mode), { timeout: 360_000 });
  if (!response.ok()) throw new Error(`${mode} export failed: ${response.status()} ${JSON.stringify(await readJson(response))}`);
  await writeFile(path, await response.body());
  return {
    status: response.status(),
    contentType: response.headers()["content-type"] || null,
    disposition: response.headers()["content-disposition"] || null,
    brandingHeader: response.headers()["x-vidger-branding"] || null,
  };
}

async function ensureBrandingAssets(page) {
  const cssLoaded = await page.evaluate(() => Boolean(document.querySelector('link[href="/assets/vidger-branding.css"]')));
  if (!cssLoaded) await page.addStyleTag({ url: `${BASE_URL}/assets/vidger-branding.css` });
  const scriptLoaded = await page.evaluate(() => Boolean(document.querySelector('script[src="/assets/vidger-branding.js"]')));
  if (!scriptLoaded) await page.addScriptTag({ url: `${BASE_URL}/assets/vidger-branding.js` });
}

async function injectResult(page, candidate, statusPayload) {
  await page.goto(`${BASE_URL}/app`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("[data-prompt-result]", { state: "attached", timeout: 60_000 });
  await page.evaluate(() => {
    const gate = document.querySelector("[data-auth-gate]");
    if (gate) gate.hidden = true;
  });
  await ensureBrandingAssets(page);
  await page.evaluate(({ candidateValue, payloadValue }) => {
    const result = document.querySelector("[data-prompt-result]");
    const empty = result?.closest(".preview")?.querySelector("[data-preview-empty]");
    if (!result) throw new Error("Vidger result container missing.");
    if (empty) empty.hidden = true;
    result.hidden = false;
    result.replaceChildren();
    const meta = document.createElement("div");
    meta.className = "result-meta";
    meta.innerHTML = "<strong>Video ready</strong><span>Live branding proof</span>";
    const stage = document.createElement("div");
    stage.className = "video-stage";
    const video = document.createElement("video");
    video.preload = "metadata";
    video.playsInline = true;
    video.muted = true;
    video.src = payloadValue.video.url;
    const cover = document.createElement("button");
    cover.className = "video-cover";
    cover.type = "button";
    cover.innerHTML = '<span class="play-orb">▶</span>';
    stage.append(video, cover);
    const actions = document.createElement("div");
    actions.className = "video-actions";
    actions.innerHTML = '<button class="button secondary" type="button">Full screen</button><button class="button" type="button">Download</button>';
    result.append(meta, stage, actions);
    result.dataset.proofRequest = candidateValue.requestId;
  }, { candidateValue: candidate, payloadValue: statusPayload });
  await page.addScriptTag({ url: `${BASE_URL}/assets/vidger-branding.js` });
  await page.waitForFunction(() => Boolean(
    document.querySelector("[data-prompt-result] .video-stage > .vidger-video-mark") &&
    document.querySelector("[data-prompt-result] [data-vidger-branding-control]") &&
    document.querySelector("[data-prompt-result] [data-vidger-export]")
  ), null, { timeout: 60_000 });
}

async function renderOwnerControls(page) {
  await page.goto(`${BASE_URL}/owner`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.evaluate(() => {
    const gate = document.querySelector("[data-auth-gate]");
    if (gate) gate.hidden = true;
  });
  await ensureBrandingAssets(page);
  await page.addScriptTag({ url: `${BASE_URL}/assets/vidger-branding.js` });
  await page.waitForSelector("[data-vidger-branding-admin]", { state: "attached", timeout: 120_000 });
}

async function setPolicy(page, enabled) {
  await renderOwnerControls(page);
  const row = page.locator("[data-vidger-branding-admin] tr", { hasText: TARGET_ORGANIZATION_NAME });
  await row.waitFor({ state: "attached", timeout: 60_000 });
  const label = enabled ? "Allow logo-free" : "Disable logo-free";
  const button = row.getByRole("button", { name: label, exact: true });
  if (await button.count()) {
    await button.click();
  } else {
    const { response, payload } = await requestJson(page, `${BASE_URL}/api/branding`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      data: { action: "setOrganizationLogoFree", organizationId: TARGET_ORGANIZATION_ID, enabled },
    });
    if (!response.ok()) throw new Error(`Owner policy API failed: ${response.status()} ${JSON.stringify(payload)}`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await renderOwnerControls(page);
  }
  await page.waitForFunction(({ name, expected }) => {
    const target = [...document.querySelectorAll("[data-vidger-branding-admin] tr")].find((rowValue) => rowValue.textContent.includes(name));
    return target && target.textContent.includes(expected);
  }, { name: TARGET_ORGANIZATION_NAME, expected: enabled ? "Disable logo-free" : "Allow logo-free" }, { timeout: 60_000 });
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout || "").slice(-2000)}`);
  return result.stdout.trim();
}

function probe(path) {
  return JSON.parse(run("ffprobe", ["-v", "error", "-show_entries", "format=duration,size:format_tags=comment,encoder:stream=codec_type,codec_name,width,height", "-of", "json", path]));
}

function createStoryboard(input, output) {
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vf", "fps=1,scale=480:-1,tile=3x2:padding=8:margin=8:color=0x111111", "-frames:v", "1", output]);
}

function assertMedia(info, branded) {
  const video = (info.streams || []).find((stream) => stream.codec_type === "video");
  if (!video || video.codec_name !== "h264") throw new Error("Expected H.264 output.");
  const comment = String(info.format?.tags?.comment || "");
  if (branded && !/Branded by Vidger/i.test(comment)) throw new Error(`Branded metadata missing: ${JSON.stringify(info.format?.tags || {})}`);
  if (!branded && /Branded by Vidger/i.test(comment)) throw new Error("Logo-free output contains branded metadata.");
}

async function hash(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function main() {
  await Promise.all([mkdir(OUTPUT_DIR, { recursive: true }), mkdir(SCREENSHOT_DIR, { recursive: true }), mkdir(VIDEO_DIR, { recursive: true }), mkdir(STORYBOARD_DIR, { recursive: true })]);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  const page = await context.newPage();
  const browserEvents = [];
  page.on("console", (message) => browserEvents.push({ type: message.type(), text: message.text() }));
  page.on("pageerror", (error) => browserEvents.push({ type: "pageerror", text: error.message }));
  const proof = { baseUrl: BASE_URL, runId: RUN_ID, qaEmail: QA_EMAIL, submittedNewGenerations: 0, candidate: null, defaultPolicy: null, deniedLogoFree: null, branded: null, ownerGrant: null, logoFree: null, policyReset: null, browserEvents };

  try {
    await page.goto(SHARE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await signUp(page);
    const source = await waitForSource(page);
    proof.candidate = source.candidate;
    proof.defaultPolicy = await policy(page);
    if (proof.defaultPolicy.logo_free_exports_enabled === true || proof.defaultPolicy.can_export_logo_free === true) throw new Error("Logo-free was not disabled by default.");

    const denied = await requestJson(page, exportUrl(source.candidate, "none"));
    proof.deniedLogoFree = { status: denied.response.status(), payload: denied.payload };
    if (denied.response.status() !== 403 || denied.payload.error !== "LOGO_FREE_NOT_ENABLED") throw new Error(`Fail-closed check failed: ${denied.response.status()} ${JSON.stringify(denied.payload)}`);
    console.log("VIDGER_BRANDING_LOGO_FREE_DENIED status=403");

    await injectResult(page, source.candidate, source.payload);
    const defaultUi = await page.evaluate(() => {
      const mark = document.querySelector("[data-prompt-result] .video-stage > .vidger-video-mark");
      const clean = [...document.querySelectorAll("[data-prompt-result] .vidger-mode-button")].find((item) => item.textContent.trim() === "Logo-free");
      return { markDisplay: mark ? getComputedStyle(mark).display : null, markHidden: mark?.dataset.hidden || null, logoFreeDisabled: clean?.disabled };
    });
    if (defaultUi.markDisplay === "none" || defaultUi.markHidden === "true" || defaultUi.logoFreeDisabled !== true) throw new Error(`Default preview branding invalid: ${JSON.stringify(defaultUi)}`);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "01-default-vidger-preview.png"), fullPage: true });

    const brandedPath = join(VIDEO_DIR, "vidger-branded.mp4");
    const brandedHeaders = await downloadExport(page, source.candidate, "vidger", brandedPath);
    const brandedProbe = probe(brandedPath);
    assertMedia(brandedProbe, true);
    const brandedStoryboard = join(STORYBOARD_DIR, "vidger-branded-storyboard.jpg");
    createStoryboard(brandedPath, brandedStoryboard);
    proof.branded = { headers: brandedHeaders, sha256: await hash(brandedPath), probe: brandedProbe, path: brandedPath, storyboard: brandedStoryboard, previewMarkVisible: true };
    console.log(`VIDGER_BRANDING_BRANDED_COMPLETED file=${brandedPath}`);

    await waitForAdmin(page);
    await setPolicy(page, true);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "02-owner-logo-free-granted.png"), fullPage: true });
    proof.ownerGrant = { organizationId: TARGET_ORGANIZATION_ID, enabled: true };
    console.log("VIDGER_BRANDING_OWNER_GRANTED logoFree=true");

    const refreshed = (await requestJson(page, `${BASE_URL}/api/providers/fal/status?${new URLSearchParams({ requestId: source.candidate.requestId, model: source.candidate.model }).toString()}`)).payload;
    await injectResult(page, source.candidate, refreshed);
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("[data-prompt-result] .vidger-mode-button")].find((item) => item.textContent.trim() === "Logo-free");
      return button && !button.disabled;
    }, null, { timeout: 60_000 });
    await page.getByRole("button", { name: "Logo-free", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-prompt-result] .video-stage > .vidger-video-mark")?.dataset.hidden === "true", null, { timeout: 30_000 });
    await page.screenshot({ path: join(SCREENSHOT_DIR, "03-logo-free-preview-selected.png"), fullPage: true });

    const logoFreePath = join(VIDEO_DIR, "vidger-logo-free.mp4");
    const logoFreeHeaders = await downloadExport(page, source.candidate, "none", logoFreePath);
    const logoFreeProbe = probe(logoFreePath);
    assertMedia(logoFreeProbe, false);
    const logoFreeStoryboard = join(STORYBOARD_DIR, "vidger-logo-free-storyboard.jpg");
    createStoryboard(logoFreePath, logoFreeStoryboard);
    proof.logoFree = { headers: logoFreeHeaders, sha256: await hash(logoFreePath), probe: logoFreeProbe, path: logoFreePath, storyboard: logoFreeStoryboard, previewMarkHidden: true };
    if (proof.logoFree.sha256 === proof.branded.sha256) throw new Error("Branded and logo-free outputs are identical.");
    console.log(`VIDGER_BRANDING_LOGO_FREE_COMPLETED file=${logoFreePath}`);

    await setPolicy(page, false);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "04-owner-policy-reset.png"), fullPage: true });
    proof.policyReset = await policy(page);
    if (proof.policyReset.logo_free_exports_enabled === true) throw new Error("Policy reset failed.");
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
