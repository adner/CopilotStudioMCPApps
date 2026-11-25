/**
 * Headless check of the probe UI in the ext-apps reference host (basic-host).
 * Needs: probe server on :3001 and basic-host on :8080 (examples/basic-host from github.com/modelcontextprotocol/ext-apps).
 * Usage: node scripts/check-basic-host.mjs [screenshot.png]
 * Uses the installed Microsoft Edge (playwright-core, channel "msedge").
 */
import { chromium } from "playwright-core";

const url =
  "http://localhost:8080/index.html?server=" +
  encodeURIComponent("MCP Apps Capability Probe") +
  "&tool=open_capability_probe&call=true";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (/probe|error/i.test(t)) console.log("[console]", t.slice(0, 200));
});
await page.goto(url);
await page.waitForTimeout(8000);

// Find the (nested, sandboxed) frame that contains our app.
let app;
for (const f of page.frames()) {
  if (await f.locator("#probe-rows").count().catch(() => 0)) app = f;
}
if (!app) {
  console.log("APP FRAME NOT FOUND. frames:", page.frames().map((f) => f.url()));
  await page.screenshot({ path: process.argv[2] ?? "shot.png", fullPage: true });
  await browser.close();
  process.exit(1);
}

for (const action of ["model-context", "message", "open-link-bad", "download", "log", "fullscreen"]) {
  await app.locator(`button[data-action="${action}"]`).click();
  await page.waitForTimeout(1200);
}
await page.waitForTimeout(2500);
const rows = await app.locator("#probe-rows tr").allInnerTexts();
console.log(rows.map((r) => r.replace(/\t/g, " | ")).join("\n"));
await page.screenshot({ path: process.argv[2] ?? "shot.png", fullPage: true });
await browser.close();
