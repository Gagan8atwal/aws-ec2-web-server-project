import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE_URL = "https://omnimedia-engine-a5tke54ci-gagandeep-singh-s-projects559.vercel.app";
const SHARE_URL = `${BASE_URL}/?_vercel_share=dIQir8FLcKfjQOzvraIpJCuJnUvgLo0t`;
const OUTPUT_DIR = join(process.cwd(), "artifacts", "vidger-wan-diagnostics");
const REQUESTS = [
  "01a0367c-db28-7410-80bd-eabd5dc11ddb",
  "01a0367c-dc1a-7790-8946-ef5f67d665d4",
  "01a0367c-e921-72f1-aa90-3773478b0253",
  "01a0367c-e991-7021-aa32-deb1db0dade0",
];

async function readJson(response) {
  const body = await response.text();
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    return { raw: body };
  }
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(SHARE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1_500);
    const cookies = await context.cookies(BASE_URL);
    const authCookieNames = cookies.map((cookie) => cookie.name).filter((name) => name.includes("vercel") || name.includes("sso"));
    console.log(`VIDGER_DIAGNOSTIC_PREVIEW_ACCESS cookies=${authCookieNames.join(",") || "none"}`);

    const results = [];
    for (const requestId of REQUESTS) {
      const response = await page.request.get(`${BASE_URL}/api/providers/fal/diagnose?requestId=${encodeURIComponent(requestId)}`, {
        timeout: 180_000,
      });
      const payload = await readJson(response);
      const result = { requestId, httpStatus: response.status(), ok: response.ok(), payload };
      results.push(result);
      console.log(`VIDGER_DIAGNOSTIC_RESULT requestId=${requestId} http=${response.status()} payload=${JSON.stringify(payload)}`);
      await writeFile(join(OUTPUT_DIR, `${requestId}.json`), JSON.stringify(result, null, 2));
    }

    await page.screenshot({ path: join(OUTPUT_DIR, "preview-access.png"), fullPage: true });
    await writeFile(join(OUTPUT_DIR, "diagnostic-summary.json"), JSON.stringify({ baseUrl: BASE_URL, results }, null, 2));
    if (results.some((item) => !item.ok)) process.exitCode = 1;
  } finally {
    await page.close().catch(() => null);
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
