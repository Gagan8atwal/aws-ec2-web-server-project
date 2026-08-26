import { chromium } from "playwright";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const BASE_URL = "https://omnimedia-engine.vercel.app";
const TARGET_ORGANIZATION_ID = "4267241c-13d3-45b8-a422-5a05af738d67";
const TARGET_ORGANIZATION_NAME = "Vidger Production Matrix QA Workspace";
const MODEL = "fal-ai/kling-video/v3/standard/text-to-video";
const CANDIDATES = [
  { id: "dog-kling-16x9", requestId: "01a0367c-f48a-7190-b407-9d2c4c189e35", model: MODEL },
  { id: "basketball-kling-9x16", requestId: "01a0367c-f733-78b1-873c-31eab6a5f3ab", model: MODEL },
];
const RUN_ID = process.env.GITHUB_RUN_ID || String(Date.now());
const MEMBER_EMAIL = `hello+vidgerbranding-member-${RUN_ID}@pivotcalls.co`;
const OWNER_EMAIL = `hello+vidgerbranding-owner-${RUN_ID}@pivotcalls.co`;
const MEMBER_PASSWORD = `Vm!${randomBytes(30).toString("base64url")}8b`;
const OWNER_PASSWORD = `Vo!${randomBytes(30).toString("base64url")}7c`;
const OUTPUT_DIR = join(process.cwd(), "artifacts", "vidger-branding-production-proof");
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

async function signUp(page, email, password, fullName) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const { response, payload } = await requestJson(page, `${BASE_URL}/api/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    data: { action: "signUp", email, password, fullName },
  });
  if (!response.ok() || !payload.signedIn || !payload.user?.id) {
    throw new Error(`Signup failed for ${email}: ${response.status()} ${JSON.stringify(payload)}`);
  }
  console.log(`VIDGER_PROOF_ACCOUNT role=${fullName.includes("Controller") ? "controller" : "member"} email=${email} userId=${payload.user.id}`);
  return { email, userId: payload.user.id };
}

async function waitForGenerationAccess(page) {
  for (let cycle = 1; cycle <= 180; cycle += 1) {
    for (const candidate of CANDIDATES) {
      const query = new URLSearchParams({ requestId: candidate.requestId, model: candidate.model });
      const { response, payload } = await requestJson(page, `${BASE_URL}/api/providers/fal/status?${query.toString()}`);
      if (response.ok() && payload.status === "COMPLETED" && payload.video?.url) {
        console.log(`VIDGER_PROOF_SOURCE_READY candidate=${candidate.id} requestId=${candidate.requestId}`);
        return { candidate, statusPayload: payload };
      }
    }
    if (cycle % 10 === 0) console.log(`VIDGER_PROOF_WAITING_FOR_MEMBER_ACCESS email=${MEMBER_EMAIL} cycle=${cycle}`);
    await sleep(5_000);
  }
  throw new Error("Normal member was not granted access to an existing completed generation.");
}

async function waitForPlatformController(page) {
  console.log(`VIDGER_PROOF_WAITING_FOR_CONTROLLER email=${OWNER_EMAIL}`);
  for (let attempt = 1; attempt <= 180; attempt += 1) {
    const { response } = await requestJson(page, `${BASE_URL}/api/branding?owner=1`);
    if (response.ok()) {
      console.log(`VIDGER_PROOF_CONTROLLER_READY email=${OWNER_EMAIL}`);
      return;
    }
    if (attempt % 10 === 0) console.log(`VIDGER_PROOF_CONTROLLER_PENDING email=${OWNER_EMAIL} attempt=${attempt}`);
    await sleep(5_000);
  }
  throw new Error("Temporary platform controller was not granted access.");
}

async function getPolicy(page) {
  const { response, payload } = await requestJson(page, `${BASE_URL}/api/branding`);
  if (!response.ok()) throw new Error(`Branding policy failed: ${response.status()} ${JSON.stringify(payload)}`);
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

async function requestDeniedLogoFree(page, candidate) {
  const { response, payload } = await requestJson(page, exportUrl(candidate, "none"));
  return { status: response.status(), payload };
}

async function downloadExport(page, candidate, mode, outputPath) {
  const response = await page.request.get(exportUrl(candidate, mode), { timeout: 360_000 });
  if (!response.ok()) throw new Error(`${mode} export failed: ${response.status()} ${JSON.stringify(await readJson(response))}`);
  await writeFile(outputPath, await response.body());
  const headers = response.headers();
  return {
    status: response.status(),
    contentType: headers["content-type"] || null,
    contentDisposition: headers["content-disposition"] || null,
    branding: headers["x-vidger-branding"] || null,
  };
}

async function waitForAppReady(page) {
  await page.goto(`${BASE_URL}/app`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => {
    const gate = document.querySelector("[data-auth-gate]");
    return !gate || gate.hidden || getComputedStyle(gate).display === "none";
  }, null, { timeout: 90_000 });
  await page.waitForSelector("[data-prompt-result]", { state: "attached", timeout: 60_000 });
  await page.waitForFunction(() => Boolean(document.querySelector('script[src="/assets/vidger-branding.js"]')), null, { timeout: 30_000 });
}

async function injectCompletedResult(page, candidate, statusPayload) {
  await waitForAppReady(page);
  await page.evaluate(({ candidateValue, payloadValue }) => {
    const result = document.querySelector("[data-prompt-result]");
    const empty = result?.closest(".preview")?.querySelector("[data-preview-empty]");
    if (!result) throw new Error("Vidger result container is missing.");
    if (empty) empty.hidden = true;
    result.hidden = false;
    result.replaceChildren();

    const meta = document.createElement("div");
    meta.className = "result-meta";
    const strong = document.createElement("strong");
    strong.textContent = "Video ready";
    const span = document.createElement("span");
    span.textContent = "Production branding proof";
    meta.append(strong, span);

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

  await page.waitForFunction(() => Boolean(
    document.querySelector("[data-prompt-result] .video-stage > .vidger-video-mark") &&
    document.querySelector("[data-prompt-result] [data-vidger-branding-control]") &&
    document.querySelector("[data-prompt-result] [data-vidger-export]")
  ), null, { timeout: 60_000 });
}

async function verifyDefaultUi(page) {
  const state = await page.evaluate(() => {
    const mark = document.querySelector("[data-prompt-result] .video-stage > .vidger-video-mark");
    const logoFree = [...document.querySelectorAll("[data-prompt-result] .vidger-mode-button")]
      .find((item) => item.textContent.trim() === "Logo-free");
    return {
      markDisplay: mark ? getComputedStyle(mark).display : null,
      markHidden: mark?.dataset.hidden || null,
      logoFreeDisabled: logoFree?.disabled,
      exportText: document.querySelector("[data-prompt-result] [data-vidger-export]")?.textContent || null,
    };
  });
  if (state.markDisplay === "none" || state.markHidden === "true" || state.logoFreeDisabled !== true) {
    throw new Error(`Default Vidger UI is invalid: ${JSON.stringify(state)}`);
  }
  return state;
}

async function verifyLogoFreeUi(page) {
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("[data-prompt-result] .vidger-mode-button")]
      .find((item) => item.textContent.trim() === "Logo-free");
    return button && !button.disabled;
  }, null, { timeout: 60_000 });
  await page.getByRole("button", { name: "Logo-free", exact: true }).click();
  await page.waitForFunction(() => {
    const mark = document.querySelector("[data-prompt-result] .video-stage > .vidger-video-mark");
    return mark?.dataset.hidden === "true" || (mark && getComputedStyle(mark).display === "none");
  }, null, { timeout: 30_000 });
  return page.evaluate(() => ({
    markHidden: document.querySelector("[data-prompt-result] .video-stage > .vidger-video-mark")?.dataset.hidden || null,
    exportText: document.querySelector("[data-prompt-result] [data-vidger-export]")?.textContent || null,
  }));
}

async function openOwnerControls(page) {
  await page.goto(`${BASE_URL}/owner`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => {
    const gate = document.querySelector("[data-auth-gate]");
    return !gate || gate.hidden || getComputedStyle(gate).display === "none";
  }, null, { timeout: 90_000 });
  await page.waitForSelector("[data-vidger-branding-admin]", { state: "visible", timeout: 120_000 });
  const row = page.locator("[data-vidger-branding-admin] tr", { hasText: TARGET_ORGANIZATION_NAME });
  await row.waitFor({ state: "visible", timeout: 60_000 });
  return row;
}

async function setOwnerPolicy(page, enabled) {
  const row = await openOwnerControls(page);
  const expectedButton = enabled ? "Allow logo-free" : "Disable logo-free";
  const button = row.getByRole("button", { name: expectedButton, exact: true });
  await button.click();
  await page.waitForFunction(({ organizationName, expected }) => {
    const target = [...document.querySelectorAll("[data-vidger-branding-admin] tr")]
      .find((item) => item.textContent.includes(organizationName));
    return target && target.textContent.includes(expected);
  }, {
    organizationName: TARGET_ORGANIZATION_NAME,
    expected: enabled ? "Disable logo-free" : "Allow logo-free",
  }, { timeout: 60_000 });
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${(result.stderr || result.stdout || "").slice(-2000)}`);
  }
  return result.stdout.trim();
}

function probe(path) {
  return JSON.parse(run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,size:format_tags=comment,encoder:stream=codec_type,codec_name,width,height,r_frame_rate",
    "-of", "json",
    path,
  ]));
}

function createStoryboard(input, output) {
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
  if (branded && !/Branded by Vidger/i.test(comment)) {
    throw new Error(`Branded output metadata is missing: ${JSON.stringify(info.format?.tags || {})}`);
  }
  if (!branded && /Branded by Vidger/i.test(comment)) {
    throw new Error("Logo-free output unexpectedly carries Vidger branding metadata.");
  }
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function main() {
  await Promise.all([
    mkdir(OUTPUT_DIR, { recursive: true }),
    mkdir(SCREENSHOT_DIR, { recursive: true }),
    mkdir(VIDEO_DIR, { recursive: true }),
    mkdir(STORYBOARD_DIR, { recursive: true }),
  ]);

  const browser = await chromium.launch({ headless: true });
  const memberContext = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  const memberPage = await memberContext.newPage();
  const ownerPage = await ownerContext.newPage();
  const events = [];
  for (const [role, page] of [["member", memberPage], ["owner", ownerPage]]) {
    page.on("console", (message) => events.push({ role, type: message.type(), text: message.text() }));
    page.on("pageerror", (error) => events.push({ role, type: "pageerror", text: error.message }));
  }

  const proof = {
    baseUrl: BASE_URL,
    runId: RUN_ID,
    submittedNewGenerations: 0,
    member: null,
    controller: null,
    candidate: null,
    defaultPolicy: null,
    deniedBeforeGrant: null,
    branded: null,
    ownerGrant: null,
    logoFreePolicy: null,
    logoFree: null,
    resetPolicy: null,
    deniedAfterReset: null,
    browserEvents: events,
  };

  try {
    proof.member = await signUp(memberPage, MEMBER_EMAIL, MEMBER_PASSWORD, "Vidger Branding Member Proof");
    proof.controller = await signUp(ownerPage, OWNER_EMAIL, OWNER_PASSWORD, "Vidger Branding Controller Proof");
    await writeFile(join(OUTPUT_DIR, "proof-accounts.json"), JSON.stringify({ member: proof.member, controller: proof.controller }, null, 2));

    const source = await waitForGenerationAccess(memberPage);
    proof.candidate = source.candidate;
    proof.defaultPolicy = await getPolicy(memberPage);
    if (proof.defaultPolicy.logo_free_exports_enabled === true || proof.defaultPolicy.can_export_logo_free === true) {
      throw new Error(`Normal member unexpectedly has logo-free access: ${JSON.stringify(proof.defaultPolicy)}`);
    }

    proof.deniedBeforeGrant = await requestDeniedLogoFree(memberPage, source.candidate);
    if (proof.deniedBeforeGrant.status !== 403 || proof.deniedBeforeGrant.payload.error !== "LOGO_FREE_NOT_ENABLED") {
      throw new Error(`Logo-free did not fail closed before grant: ${JSON.stringify(proof.deniedBeforeGrant)}`);
    }
    console.log("VIDGER_PROOF_LOGO_FREE_DENIED_BEFORE_GRANT status=403");

    await injectCompletedResult(memberPage, source.candidate, source.statusPayload);
    proof.defaultUi = await verifyDefaultUi(memberPage);
    await memberPage.screenshot({ path: join(SCREENSHOT_DIR, "01-default-vidger-preview.png"), fullPage: true });

    const brandedPath = join(VIDEO_DIR, "vidger-branded.mp4");
    const brandedHeaders = await downloadExport(memberPage, source.candidate, "vidger", brandedPath);
    const brandedProbe = probe(brandedPath);
    assertMedia(brandedProbe, true);
    const brandedStoryboard = join(STORYBOARD_DIR, "vidger-branded-storyboard.jpg");
    createStoryboard(brandedPath, brandedStoryboard);
    proof.branded = {
      path: brandedPath,
      storyboard: brandedStoryboard,
      sha256: await sha256(brandedPath),
      headers: brandedHeaders,
      probe: brandedProbe,
    };
    console.log(`VIDGER_PROOF_BRANDED_COMPLETED member=${MEMBER_EMAIL} file=${brandedPath}`);

    await waitForPlatformController(ownerPage);
    await setOwnerPolicy(ownerPage, true);
    await ownerPage.screenshot({ path: join(SCREENSHOT_DIR, "02-owner-logo-free-granted.png"), fullPage: true });
    proof.ownerGrant = { organizationId: TARGET_ORGANIZATION_ID, enabled: true };
    console.log(`VIDGER_PROOF_OWNER_GRANTED organization=${TARGET_ORGANIZATION_ID}`);

    proof.logoFreePolicy = await getPolicy(memberPage);
    if (proof.logoFreePolicy.logo_free_exports_enabled !== true || proof.logoFreePolicy.can_export_logo_free !== true) {
      throw new Error(`Member did not receive owner-granted logo-free access: ${JSON.stringify(proof.logoFreePolicy)}`);
    }

    const refreshedStatus = (await requestJson(memberPage, `${BASE_URL}/api/providers/fal/status?${new URLSearchParams({ requestId: source.candidate.requestId, model: source.candidate.model }).toString()}`)).payload;
    await injectCompletedResult(memberPage, source.candidate, refreshedStatus);
    proof.logoFreeUi = await verifyLogoFreeUi(memberPage);
    await memberPage.screenshot({ path: join(SCREENSHOT_DIR, "03-logo-free-preview-selected.png"), fullPage: true });

    const logoFreePath = join(VIDEO_DIR, "vidger-logo-free.mp4");
    const logoFreeHeaders = await downloadExport(memberPage, source.candidate, "none", logoFreePath);
    const logoFreeProbe = probe(logoFreePath);
    assertMedia(logoFreeProbe, false);
    const logoFreeStoryboard = join(STORYBOARD_DIR, "vidger-logo-free-storyboard.jpg");
    createStoryboard(logoFreePath, logoFreeStoryboard);
    proof.logoFree = {
      path: logoFreePath,
      storyboard: logoFreeStoryboard,
      sha256: await sha256(logoFreePath),
      headers: logoFreeHeaders,
      probe: logoFreeProbe,
    };
    if (proof.logoFree.sha256 === proof.branded.sha256) throw new Error("Branded and logo-free outputs are identical.");
    console.log(`VIDGER_PROOF_LOGO_FREE_COMPLETED member=${MEMBER_EMAIL} file=${logoFreePath}`);

    await setOwnerPolicy(ownerPage, false);
    await ownerPage.screenshot({ path: join(SCREENSHOT_DIR, "04-owner-policy-reset.png"), fullPage: true });
    proof.resetPolicy = await getPolicy(memberPage);
    if (proof.resetPolicy.logo_free_exports_enabled === true || proof.resetPolicy.can_export_logo_free === true) {
      throw new Error(`Logo-free policy did not reset for normal member: ${JSON.stringify(proof.resetPolicy)}`);
    }

    proof.deniedAfterReset = await requestDeniedLogoFree(memberPage, source.candidate);
    if (proof.deniedAfterReset.status !== 403 || proof.deniedAfterReset.payload.error !== "LOGO_FREE_NOT_ENABLED") {
      throw new Error(`Logo-free did not fail closed after reset: ${JSON.stringify(proof.deniedAfterReset)}`);
    }
    console.log("VIDGER_PROOF_POLICY_RESET_AND_DENIED status=403");
    proof.status = "PASSED";
  } catch (error) {
    proof.status = "FAILED";
    proof.error = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`VIDGER_PROOF_FAILED error=${error instanceof Error ? error.message : String(error)}`);
    await memberPage.screenshot({ path: join(SCREENSHOT_DIR, "member-failure.png"), fullPage: true }).catch(() => null);
    await ownerPage.screenshot({ path: join(SCREENSHOT_DIR, "owner-failure.png"), fullPage: true }).catch(() => null);
    process.exitCode = 1;
  } finally {
    await writeFile(join(OUTPUT_DIR, "proof-summary.json"), JSON.stringify(proof, null, 2));
    await memberContext.close().catch(() => null);
    await ownerContext.close().catch(() => null);
    await browser.close().catch(() => null);
  }
}

main().catch(async (error) => {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(join(OUTPUT_DIR, "fatal-error.txt"), error?.stack || String(error));
  console.error(error);
  process.exitCode = 1;
});
