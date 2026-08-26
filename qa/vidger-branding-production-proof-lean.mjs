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
  { id: "basketball-kling-9x16", requestId: "01a0367c-f733-78b1-873c-31eab6a5f3ab", model: MODEL },
  { id: "dog-kling-16x9", requestId: "01a0367c-f48a-7190-b407-9d2c4c189e35", model: MODEL },
];
const RUN_ID = process.env.GITHUB_RUN_ID || String(Date.now());
const MEMBER_EMAIL = `hello+vidgerbrandlive-member-${RUN_ID}@pivotcalls.co`;
const OWNER_EMAIL = `hello+vidgerbrandlive-owner-${RUN_ID}@pivotcalls.co`;
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
  console.log(`VIDGER_LIVE_ACCOUNT role=${fullName.includes("Controller") ? "controller" : "member"} email=${email} userId=${payload.user.id}`);
  return { email, userId: payload.user.id };
}

async function waitForGenerationAccess(page) {
  for (let cycle = 1; cycle <= 180; cycle += 1) {
    for (const candidate of CANDIDATES) {
      const query = new URLSearchParams({ requestId: candidate.requestId, model: candidate.model });
      const { response, payload } = await requestJson(page, `${BASE_URL}/api/providers/fal/status?${query.toString()}`);
      if (response.ok() && payload.status === "COMPLETED" && payload.video?.url) {
        console.log(`VIDGER_LIVE_SOURCE_READY candidate=${candidate.id} requestId=${candidate.requestId}`);
        return { candidate, statusPayload: payload };
      }
    }
    if (cycle % 10 === 0) console.log(`VIDGER_LIVE_WAITING_FOR_MEMBER_ACCESS email=${MEMBER_EMAIL} cycle=${cycle}`);
    await sleep(5_000);
  }
  throw new Error("Normal member was not granted access to an existing completed generation.");
}

async function waitForPlatformController(page) {
  for (let attempt = 1; attempt <= 180; attempt += 1) {
    const { response } = await requestJson(page, `${BASE_URL}/api/branding?owner=1`);
    if (response.ok()) {
      console.log(`VIDGER_LIVE_CONTROLLER_READY email=${OWNER_EMAIL}`);
      return;
    }
    if (attempt % 10 === 0) console.log(`VIDGER_LIVE_CONTROLLER_PENDING email=${OWNER_EMAIL} attempt=${attempt}`);
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
  console.log(`VIDGER_LIVE_EXPORT_STARTED mode=${mode} requestId=${candidate.requestId}`);
  const response = await page.request.get(exportUrl(candidate, mode), { timeout: 360_000 });
  if (!response.ok()) {
    throw new Error(`${mode} export failed: ${response.status()} ${JSON.stringify(await readJson(response))}`);
  }
  await writeFile(outputPath, await response.body());
  const headers = response.headers();
  console.log(`VIDGER_LIVE_EXPORT_COMPLETED mode=${mode} requestId=${candidate.requestId}`);
  return {
    status: response.status(),
    contentType: headers["content-type"] || null,
    contentDisposition: headers["content-disposition"] || null,
    branding: headers["x-vidger-branding"] || null,
  };
}

async function waitForApp(page) {
  await page.goto(`${BASE_URL}/app`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => {
    const gate = document.querySelector("[data-auth-gate]");
    return !gate || gate.hidden || getComputedStyle(gate).display === "none";
  }, null, { timeout: 90_000 });
  await page.waitForSelector("[data-vidger-branding-note]", { state: "visible", timeout: 60_000 });
}

async function renderProofResult(page, candidate, expectLogoFreeEnabled) {
  await waitForApp(page);
  await page.evaluate(({ requestId, model }) => {
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
    span.textContent = "Live production branding proof";
    meta.append(strong, span);

    const stage = document.createElement("div");
    stage.className = "video-stage";
    const video = document.createElement("video");
    video.preload = "metadata";
    video.playsInline = true;
    video.muted = true;
    video.controls = true;
    const playback = new URL("/api/providers/fal/playback", location.origin);
    playback.searchParams.set("requestId", requestId);
    playback.searchParams.set("model", model);
    video.src = playback.toString();
    stage.append(video);

    const actions = document.createElement("div");
    actions.className = "video-actions";
    const fullscreen = document.createElement("button");
    fullscreen.type = "button";
    fullscreen.className = "button secondary";
    fullscreen.textContent = "Full screen";
    const download = document.createElement("button");
    download.type = "button";
    download.className = "button";
    download.textContent = "Download";
    actions.append(fullscreen, download);
    result.append(meta, stage, actions);
  }, { requestId: candidate.requestId, model: candidate.model });

  await page.waitForSelector("[data-prompt-result] .video-stage > .vidger-video-mark", { state: "visible", timeout: 60_000 });
  await page.waitForSelector("[data-prompt-result] [data-vidger-branding-control]", { state: "visible", timeout: 60_000 });
  const video = page.locator("[data-prompt-result] video");
  await video.evaluate((element) => element.play().catch(() => null));
  await page.waitForTimeout(1_500);

  const logoFreeButton = page.getByRole("button", { name: "Logo-free", exact: true });
  const disabled = await logoFreeButton.isDisabled();
  if (disabled === expectLogoFreeEnabled) {
    throw new Error(`Logo-free selector state is incorrect. enabledExpected=${expectLogoFreeEnabled} disabled=${disabled}`);
  }

  return {
    markText: await page.locator("[data-prompt-result] .vidger-video-mark").innerText(),
    noteText: await page.locator("[data-vidger-branding-note]").innerText(),
    logoFreeDisabled: disabled,
  };
}

async function selectLogoFree(page) {
  const button = page.getByRole("button", { name: "Logo-free", exact: true });
  await button.click();
  await page.waitForFunction(() => {
    const mark = document.querySelector("[data-prompt-result] .vidger-video-mark");
    return mark?.dataset.hidden === "true" || (mark && getComputedStyle(mark).display === "none");
  }, null, { timeout: 30_000 });
}

async function openOwnerRow(page) {
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
  const row = await openOwnerRow(page);
  const button = row.getByRole("button", { name: enabled ? "Allow logo-free" : "Disable logo-free", exact: true });
  await button.click();
  await page.waitForFunction(({ name, expected }) => {
    const target = [...document.querySelectorAll("[data-vidger-branding-admin] tr")]
      .find((item) => item.textContent.includes(name));
    return target && target.textContent.includes(expected);
  }, { name: TARGET_ORGANIZATION_NAME, expected: enabled ? "Disable logo-free" : "Allow logo-free" }, { timeout: 60_000 });
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
  const memberContext = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const memberPage = await memberContext.newPage();
  const ownerPage = await ownerContext.newPage();
  const proof = {
    baseUrl: BASE_URL,
    runId: RUN_ID,
    submittedNewGenerations: 0,
    status: "STARTED",
  };

  try {
    proof.member = await signUp(memberPage, MEMBER_EMAIL, MEMBER_PASSWORD, "Vidger Branding Live Member");
    proof.controller = await signUp(ownerPage, OWNER_EMAIL, OWNER_PASSWORD, "Vidger Branding Live Controller");
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
    console.log("VIDGER_LIVE_LOGO_FREE_DENIED_BEFORE_GRANT status=403");

    proof.defaultUi = await renderProofResult(memberPage, source.candidate, false);
    await memberPage.screenshot({ path: join(SCREENSHOT_DIR, "01-default-vidger-preview.png"), fullPage: true });

    const brandedPath = join(VIDEO_DIR, "Vidger_Branded_Production_Proof.mp4");
    const brandedHeaders = await downloadExport(memberPage, source.candidate, "vidger", brandedPath);
    const brandedProbe = probe(brandedPath);
    assertMedia(brandedProbe, true);
    const brandedStoryboard = join(STORYBOARD_DIR, "Vidger_Branded_Storyboard.jpg");
    createStoryboard(brandedPath, brandedStoryboard);
    proof.branded = {
      path: brandedPath,
      storyboard: brandedStoryboard,
      sha256: await sha256(brandedPath),
      headers: brandedHeaders,
      probe: brandedProbe,
    };

    await waitForPlatformController(ownerPage);
    await setOwnerPolicy(ownerPage, true);
    await ownerPage.screenshot({ path: join(SCREENSHOT_DIR, "02-owner-logo-free-granted.png"), fullPage: true });
    proof.ownerGrant = { organizationId: TARGET_ORGANIZATION_ID, enabled: true };

    proof.logoFreePolicy = await getPolicy(memberPage);
    if (proof.logoFreePolicy.logo_free_exports_enabled !== true || proof.logoFreePolicy.can_export_logo_free !== true) {
      throw new Error(`Member did not receive owner-granted logo-free access: ${JSON.stringify(proof.logoFreePolicy)}`);
    }

    proof.logoFreeUi = await renderProofResult(memberPage, source.candidate, true);
    await selectLogoFree(memberPage);
    await memberPage.screenshot({ path: join(SCREENSHOT_DIR, "03-logo-free-preview-selected.png"), fullPage: true });

    const logoFreePath = join(VIDEO_DIR, "Vidger_Logo_Free_Production_Proof.mp4");
    const logoFreeHeaders = await downloadExport(memberPage, source.candidate, "none", logoFreePath);
    const logoFreeProbe = probe(logoFreePath);
    assertMedia(logoFreeProbe, false);
    const logoFreeStoryboard = join(STORYBOARD_DIR, "Vidger_Logo_Free_Storyboard.jpg");
    createStoryboard(logoFreePath, logoFreeStoryboard);
    proof.logoFree = {
      path: logoFreePath,
      storyboard: logoFreeStoryboard,
      sha256: await sha256(logoFreePath),
      headers: logoFreeHeaders,
      probe: logoFreeProbe,
    };
    if (proof.logoFree.sha256 === proof.branded.sha256) throw new Error("Branded and logo-free outputs are identical.");

    await setOwnerPolicy(ownerPage, false);
    await ownerPage.screenshot({ path: join(SCREENSHOT_DIR, "04-owner-policy-reset.png"), fullPage: true });
    proof.resetPolicy = await getPolicy(memberPage);
    if (proof.resetPolicy.logo_free_exports_enabled === true || proof.resetPolicy.can_export_logo_free === true) {
      throw new Error(`Logo-free policy did not reset: ${JSON.stringify(proof.resetPolicy)}`);
    }

    proof.deniedAfterReset = await requestDeniedLogoFree(memberPage, source.candidate);
    if (proof.deniedAfterReset.status !== 403 || proof.deniedAfterReset.payload.error !== "LOGO_FREE_NOT_ENABLED") {
      throw new Error(`Logo-free did not fail closed after reset: ${JSON.stringify(proof.deniedAfterReset)}`);
    }
    proof.status = "PASSED";
    console.log("VIDGER_LIVE_PROOF_PASSED newGenerations=0");
  } catch (error) {
    proof.status = "FAILED";
    proof.error = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`VIDGER_LIVE_PROOF_FAILED error=${error instanceof Error ? error.message : String(error)}`);
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
