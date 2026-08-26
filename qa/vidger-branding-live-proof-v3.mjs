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

async function waitForGenerationAccess(page) {
  for (let cycle = 1; cycle <= 180; cycle += 1) {
    for (const candidate of CANDIDATES) {
      const query = new URLSearchParams({ requestId: candidate.requestId, model: candidate.model });
      const { response, payload } = await requestJson(page, `${BASE_URL}/api/providers/fal/status?${query.toString()}`);
      if (response.ok() && payload.status === "COMPLETED" && payload.video?.url) {
        console.log(`VIDGER_BRANDING_ACCESS_READY email=${QA_EMAIL} candidate=${candidate.id} requestId=${candidate.requestId}`);
        return { candidate, statusPayload: payload };
      }
    }
    if (cycle % 10 === 0) console.log(`VIDGER_BRANDING_WAITING_FOR_ACCESS email=${QA_EMAIL} cycle=${cycle}`);
    await sleep(5_000);
  }
  throw new Error(`Generation access was not granted for ${QA_EMAIL}.`);
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
  throw new Error(`Platform-admin access was not granted for ${QA_EMAIL}.`);
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

async function openAppAndInjectResult(page, candidate, statusPayload) {
  await page.goto(`${BASE_URL}/app`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => {
    const gate = document.querySelector("[data-auth-gate]");
    return !gate || gate.hidden || getComputedStyle(gate).display === "none";
  }, null, { timeout: 60_000 });
  await page.waitForSelector("[data-prompt-result]", { state: "attached", timeout: 60_000 });
  await page.evaluate(({ candidateValue, payloadValue }) => {
    const result = document.querySelector("[data-prompt-result]");
    const preview = result?.closest(".preview");
    const empty = preview?.querySelector("[data-preview-empty]");
    if (!result) throw new Error("Vidger result container is missing.");
    if (empty) empty.hidden = true;
    result.hidden = false;
    result.replaceChildren();

    const meta = document.createElement("div");
    meta.className = "result-meta";
    const left = document.createElement("strong");
    left.textContent = "Video ready";
    const right = document.createElement("span");
    right.textContent = "Kling 3 · live proof";
    meta.append(left, right);

    const stage = document.createElement("div");
    stage.className = "video-stage";
    const video = document.createElement("video");
    video.preload = "metadata";
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.src = payloadValue.video.url;
    const cover = document.createElement("button");
    cover.className = "video-cover";
    cover.type = "button";
    const orb = document.createElement("span");
    orb.className = "play-orb";
    orb.textContent = "▶";
    cover.append(orb);
    cover.addEventListener("click", async () => {
      cover.hidden = true;
      video.controls = true;
      try { await video.play(); } catch { cover.hidden = false; }
    });
    stage.append(video, cover);

    const actions = document.createElement("div");
    actions.className = "video-actions";
    const fullscreen = document.createElement("button");
    fullscreen.className = "button secondary";
    fullscreen.type = "button";
    fullscreen.textContent = "Full screen";
    const download = document.createElement("button");
    download.className = "button";
    download.type = "button";
    download.textContent = "Download";
    actions.append(fullscreen, download);
    result.append(meta, stage, actions);
    result.dataset.proofRequestId = candidateValue.requestId;
  }, { candidateValue: candidate, payloadValue: statusPayload });

  await page.waitForFunction(() => {
    const result = document.querySelector("[data-prompt-result]");
    return Boolean(
      result?.querySelector(".video-stage > .vidger-video-mark") &&
      result?.querySelector("[data-vidger-branding-control]") &&
      result?.querySelector("[data-vidger-export]")
    );
  }, null, { timeout: 60_000 });
}

async function saveDownload(page, path) {
  const button = page.locator("[data-prompt-result] [data-vidger-export]");
  await button.scrollIntoViewIfNeeded();
  const downloadPromise = page.waitForEvent("download", { timeout: 360_000 });
  await button.click();
  const download = await downloadPromise;
  await download.saveAs(path);
  const failure = await download.failure();
  if (failure) throw new Error(`Browser download failed: ${failure}`);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${(result.stderr || result.stdout || "").slice(-2000)}`);
  return result.stdout.trim();
}

function probe(path) {
  return JSON.parse(run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,size:format_tags=comment,encoder:stream=codec_type,codec_name,width,height,r_frame_rate",
    "-of", "json", path,
  ]));
}

function storyboard(input, output) {
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", input,
    "-vf", "fps=1,scale=480:-1,tile=3x2:padding=8:margin=8:color=0x111111",
    "-frames:v", "1", output,
  ]);
}

function assertMedia(info, branded) {
  const video = (info.streams || []).find((stream) => stream.codec_type === "video");
  if (!video || video.codec_name !== "h264") throw new Error("Expected H.264 video output.");
  const duration = Number(info.format?.duration || 0);
  if (!(duration > 1 && duration < 20)) throw new Error(`Unexpected duration ${duration}.`);
  const comment = String(info.format?.tags?.comment || "");
  if (branded && !/Branded by Vidger/i.test(comment)) throw new Error(`Branded metadata missing: ${JSON.stringify(info.format?.tags || {})}`);
  if (!branded && /Branded by Vidger/i.test(comment)) throw new Error("Logo-free output unexpectedly contains Vidger branding metadata.");
}

async function hash(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function setPolicyInOwnerUi(page, enabled) {
  await page.goto(`${BASE_URL}/owner`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("[data-vidger-branding-admin]", { state: "attached", timeout: 120_000 });
  const row = page.locator("[data-vidger-branding-admin] tr", { hasText: TARGET_ORGANIZATION_NAME });
  await row.waitFor({ state: "attached", timeout: 60_000 });
  const button = row.getByRole("button", { name: enabled ? "Allow logo-free" : "Disable logo-free", exact: true });
  await button.click();
  await page.waitForFunction(({ name, expected }) => {
    const rows = [...document.querySelectorAll("[data-vidger-branding-admin] tr")];
    const target = rows.find((item) => item.textContent.includes(name));
    return target && target.textContent.includes(expected);
  }, { name: TARGET_ORGANIZATION_NAME, expected: enabled ? "Disable logo-free" : "Allow logo-free" }, { timeout: 60_000 });
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
    submittedNewGenerations: 0,
    candidate: null,
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
    const source = await waitForGenerationAccess(page);
    proof.candidate = source.candidate;

    proof.defaultPolicy = await policy(page);
    if (proof.defaultPolicy.can_export_logo_free === true || proof.defaultPolicy.logo_free_exports_enabled === true) {
      throw new Error(`Logo-free should be disabled before owner grant: ${JSON.stringify(proof.defaultPolicy)}`);
    }

    const denied = await requestJson(page, exportUrl(source.candidate, "none"));
    proof.deniedLogoFree = { status: denied.response.status(), payload: denied.payload };
    if (denied.response.status() !== 403 || denied.payload.error !== "LOGO_FREE_NOT_ENABLED") {
      throw new Error(`Logo-free fail-closed proof failed: ${denied.response.status()} ${JSON.stringify(denied.payload)}`);
    }
    console.log("VIDGER_BRANDING_LOGO_FREE_DENIED status=403");

    await openAppAndInjectResult(page, source.candidate, source.statusPayload);
    const defaultUi = await page.evaluate(() => {
      const mark = document.querySelector("[data-prompt-result] .video-stage > .vidger-video-mark");
      const logoFree = [...document.querySelectorAll("[data-prompt-result] .vidger-mode-button")].find((item) => item.textContent.trim() === "Logo-free");
      return { markHidden: mark?.dataset.hidden || null, markDisplay: mark ? getComputedStyle(mark).display : null, logoFreeDisabled: logoFree?.disabled };
    });
    if (defaultUi.markHidden === "true" || defaultUi.markDisplay === "none" || defaultUi.logoFreeDisabled !== true) {
      throw new Error(`Default branding UI invalid: ${JSON.stringify(defaultUi)}`);
    }
    await page.screenshot({ path: join(SCREENSHOT_DIR, "01-default-vidger-preview.png"), fullPage: true });

    const brandedPath = join(VIDEO_DIR, "vidger-branded.mp4");
    await saveDownload(page, brandedPath);
    const brandedProbe = probe(brandedPath);
    assertMedia(brandedProbe, true);
    const brandedStoryboard = join(STORYBOARD_DIR, "vidger-branded-storyboard.jpg");
    storyboard(brandedPath, brandedStoryboard);
    proof.branded = { path: brandedPath, storyboard: brandedStoryboard, sha256: await hash(brandedPath), probe: brandedProbe, previewMarkVisible: true };
    console.log(`VIDGER_BRANDING_BRANDED_COMPLETED file=${brandedPath}`);

    await waitForAdmin(page);
    await setPolicyInOwnerUi(page, true);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "02-owner-logo-free-granted.png"), fullPage: true });
    proof.ownerGrant = { organizationId: TARGET_ORGANIZATION_ID, enabled: true };
    console.log("VIDGER_BRANDING_OWNER_GRANTED logoFree=true");

    const refreshedStatus = (await requestJson(page, `${BASE_URL}/api/providers/fal/status?${new URLSearchParams({ requestId: source.candidate.requestId, model: source.candidate.model }).toString()}`)).payload;
    await openAppAndInjectResult(page, source.candidate, refreshedStatus);
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("[data-prompt-result] .vidger-mode-button")].find((item) => item.textContent.trim() === "Logo-free");
      return button && !button.disabled;
    }, null, { timeout: 60_000 });
    await page.getByRole("button", { name: "Logo-free", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-prompt-result] .video-stage > .vidger-video-mark")?.dataset.hidden === "true", null, { timeout: 30_000 });
    await page.screenshot({ path: join(SCREENSHOT_DIR, "03-logo-free-preview-selected.png"), fullPage: true });

    const logoFreePath = join(VIDEO_DIR, "vidger-logo-free.mp4");
    await saveDownload(page, logoFreePath);
    const logoFreeProbe = probe(logoFreePath);
    assertMedia(logoFreeProbe, false);
    const logoFreeStoryboard = join(STORYBOARD_DIR, "vidger-logo-free-storyboard.jpg");
    storyboard(logoFreePath, logoFreeStoryboard);
    proof.logoFree = { path: logoFreePath, storyboard: logoFreeStoryboard, sha256: await hash(logoFreePath), probe: logoFreeProbe, previewMarkHidden: true };
    if (proof.logoFree.sha256 === proof.branded.sha256) throw new Error("Branded and logo-free outputs are unexpectedly identical.");
    console.log(`VIDGER_BRANDING_LOGO_FREE_COMPLETED file=${logoFreePath}`);

    await setPolicyInOwnerUi(page, false);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "04-owner-policy-reset.png"), fullPage: true });
    proof.policyReset = await policy(page);
    if (proof.policyReset.logo_free_exports_enabled === true) throw new Error("Logo-free policy did not reset to disabled.");
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
