import { createReadStream, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(TEST_DIR, "..");
const OUTPUT_DIR = process.env.CLOSEOUT_CAPTURE_DIR
  ? resolve(PROJECT_ROOT, process.env.CLOSEOUT_CAPTURE_DIR)
  : join(PROJECT_ROOT, "artifacts", "ui-qa", "20260828-final");
const DESKTOP_VIEWPORT = {
  width: Number.parseInt(process.env.CLOSEOUT_DESKTOP_WIDTH || "1440", 10),
  height: Number.parseInt(process.env.CLOSEOUT_DESKTOP_HEIGHT || "900", 10),
};
const MOBILE_VIEWPORT = {
  width: Number.parseInt(process.env.CLOSEOUT_MOBILE_WIDTH || "390", 10),
  height: Number.parseInt(process.env.CLOSEOUT_MOBILE_HEIGHT || "844", 10),
};
const MOBILE_VIEWPORT_TAG = `${MOBILE_VIEWPORT.width}x${MOBILE_VIEWPORT.height}`;
const MOBILE_WIDTH_TAG = String(MOBILE_VIEWPORT.width);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
};

function startServer() {
  return new Promise((resolveServer, rejectServer) => {
    const server = createServer((request, response) => {
      try {
        const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
        const relative = normalize(decodeURIComponent(requestUrl.pathname)).replace(/^[/\\]+/, "");
        const candidate = resolve(PROJECT_ROOT, relative || "app/index.html");
        if (candidate !== PROJECT_ROOT && !candidate.startsWith(`${PROJECT_ROOT}${sep}`)) {
          response.writeHead(403).end("Forbidden");
          return;
        }
        const file = statSync(candidate).isDirectory() ? join(candidate, "index.html") : candidate;
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": MIME[extname(file)] || "application/octet-stream",
        });
        createReadStream(file).pipe(response);
      } catch (error) {
        response.writeHead(error && error.code === "ENOENT" ? 404 : 500).end("Not found");
      }
    });
    server.once("error", rejectServer);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolveServer({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function newPage(browser, origin, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript(() => {
    const registry = Object.create(null);
    Object.defineProperty(window, "__registeredSiteTools", { value: registry, configurable: false });
    Object.defineProperty(document, "modelContext", {
      configurable: false,
      value: {
        async registerTool(definition) {
          registry[definition.name] = definition;
        },
      },
    });
  });
  await page.goto(`${origin}/app/index.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__closeoutApp?.registration === "resolved");
  return { context, page, errors };
}

async function metrics(page, errors) {
  return await page.evaluate((runtimeErrors) => {
    const viewAllRect = document.querySelector("#filter-all")?.getBoundingClientRect();
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      registeredTools: Object.keys(window.__registeredSiteTools).length,
      readiness: `${document.querySelector("#ready-count")?.textContent || "?"}/14`,
      brokenImages: [...document.images].filter((image) => image.offsetParent !== null && (!image.complete || image.naturalWidth === 0)).length,
      visibleCoreControlsBelow40: [...document.querySelectorAll("button, [role='button'], textarea")].filter((control) => {
        const rect = control.getBoundingClientRect();
        return control.offsetParent !== null && !control.closest("[inert], [aria-hidden='true']") && (rect.width < 40 || rect.height < 40);
      }).length,
      visibleCoreControlsBelow44: [...document.querySelectorAll("button, [role='button'], textarea")].filter((control) => {
        const rect = control.getBoundingClientRect();
        return control.offsetParent !== null && !control.closest("[inert], [aria-hidden='true']") && (rect.width < 44 || rect.height < 44);
      }).length,
      controlsBelow40: [...document.querySelectorAll("button, [role='button'], textarea")].flatMap((control) => {
        const rect = control.getBoundingClientRect();
        if (control.offsetParent === null || control.closest("[inert], [aria-hidden='true']") || (rect.width >= 40 && rect.height >= 40)) return [];
        return [{ id: control.id || null, label: (control.getAttribute("aria-label") || control.textContent || "").trim().slice(0, 60), width: Math.round(rect.width), height: Math.round(rect.height) }];
      }),
      controlsBelow44: [...document.querySelectorAll("button, [role='button'], textarea")].flatMap((control) => {
        const rect = control.getBoundingClientRect();
        if (control.offsetParent === null || control.closest("[inert], [aria-hidden='true']") || (rect.width >= 44 && rect.height >= 44)) return [];
        return [{ id: control.id || null, label: (control.getAttribute("aria-label") || control.textContent || "").trim().slice(0, 60), width: Math.round(rect.width), height: Math.round(rect.height) }];
      }),
      viewAllRect: viewAllRect ? { top: Math.round(viewAllRect.top), bottom: Math.round(viewAllRect.bottom), height: Math.round(viewAllRect.height) } : null,
      errors: runtimeErrors,
    };
  }, errors);
}

async function prepareScreenshot(page) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll(".requirements-rail, .requirement-list, .evidence-workspace, .decision-desk, .evidence-tabs").forEach((region) => {
      region.scrollTop = 0;
      region.scrollLeft = 0;
    });
    document.querySelectorAll(".toast").forEach((toast) => toast.remove());
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.waitForTimeout(120);
}

async function focusWithKeyboard(page, selector, maxTabs = 80) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press("Tab");
    if (await page.locator(selector).evaluate((target) => document.activeElement === target)) return;
  }
  throw new Error(`Keyboard focus did not reach ${selector}`);
}

const { server, origin } = await startServer();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
mkdirSync(OUTPUT_DIR, { recursive: true });

try {
  const desktop = await newPage(browser, origin, DESKTOP_VIEWPORT);
  await prepareScreenshot(desktop.page);
  await desktop.page.screenshot({ path: join(OUTPUT_DIR, `desktop-${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}.png`), fullPage: false });
  if (await desktop.page.locator("#stage-proposal").isVisible()) {
    await focusWithKeyboard(desktop.page, "#stage-proposal");
    await desktop.page.screenshot({ path: join(OUTPUT_DIR, `desktop-keyboard-focus-${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}.png`), fullPage: false });
    await prepareScreenshot(desktop.page);
  }
  const desktopMetrics = await metrics(desktop.page, desktop.errors);
  let desktopNextLaneMetrics = null;
  if (process.env.CLOSEOUT_CAPTURE_STATES === "1") {
    if (!(await desktop.page.locator("#stage-proposal").isVisible())) {
      await desktop.page.locator('.mobile-workspace-nav [data-mobile-panel="decision"]').click();
      await desktop.page.waitForTimeout(250);
    }
    await desktop.page.locator("#stage-proposal").click();
    await desktop.page.waitForFunction(() => document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "true");
    await desktop.page.screenshot({ path: join(OUTPUT_DIR, `desktop-loading-${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}.png`), fullPage: false });
    await desktop.page.waitForFunction(() => window.__closeoutApp?.getState().pending?.status === "awaiting_human" && document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "false");
    await prepareScreenshot(desktop.page);
    await desktop.page.screenshot({ path: join(OUTPUT_DIR, `desktop-staged-${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}.png`), fullPage: false });
    await desktop.page.locator("#reject-decision").click();
    await desktop.page.locator("#decision-note").fill("too short");
    await desktop.page.locator("#dialog-confirm").click();
    await desktop.page.waitForFunction(() => document.querySelector("#decision-note")?.getAttribute("aria-invalid") === "true");
    await desktop.page.screenshot({ path: join(OUTPUT_DIR, `desktop-validation-error-${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}.png`), fullPage: false });
    await desktop.page.locator("#dialog-cancel").click();
    await desktop.page.locator("#accept-decision").click();
    await desktop.page.waitForFunction(() => window.__closeoutApp?.getState().pending?.status === "approved" && document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "false");
    await prepareScreenshot(desktop.page);
    await desktop.page.screenshot({ path: join(OUTPUT_DIR, `desktop-approved-${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}.png`), fullPage: false });
    await desktop.page.evaluate(async () => {
      const token = window.__closeoutApp.getState().pending.token;
      await window.__registeredSiteTools.closeout_apply_approved_change.execute({ token });
    });
    await desktop.page.waitForFunction(() => window.__closeoutApp?.getState().pending?.status === "consumed");
    await prepareScreenshot(desktop.page);
    await desktop.page.screenshot({ path: join(OUTPUT_DIR, `desktop-applied-${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}.png`), fullPage: false });
    await desktop.page.locator('[data-requirement-id="paint"]').click();
    await desktop.page.locator('[data-requirement-id="paint"][aria-current="true"]').waitFor();
    if (!(await desktop.page.locator("#stage-proposal").isEnabled())) {
      throw new Error("Consumed proposal did not expose the next eligible desktop lane");
    }
    await prepareScreenshot(desktop.page);
    await desktop.page.screenshot({ path: join(OUTPUT_DIR, `desktop-consumed-next-lane-${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}.png`), fullPage: false });
    desktopNextLaneMetrics = await metrics(desktop.page, desktop.errors);
    await desktop.page.locator("#stage-proposal").click();
    await desktop.page.waitForFunction(() => window.__closeoutApp?.getState().pending?.requirementId === "paint"
      && window.__closeoutApp?.getState().pending?.status === "awaiting_human"
      && document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "false");
    await prepareScreenshot(desktop.page);
    await desktop.page.screenshot({ path: join(OUTPUT_DIR, `desktop-next-lane-staged-${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}.png`), fullPage: false });
    await desktop.page.evaluate(async () => window.__registeredSiteTools.closeout_reset_demo.execute({}));
    if (!(await desktop.page.locator("#stage-proposal").isVisible())) {
      await desktop.page.locator('.mobile-workspace-nav [data-mobile-panel="decision"]').click();
    }
    await desktop.page.locator("#stage-proposal").click();
    await desktop.page.waitForFunction(() => window.__closeoutApp?.getState().pending?.status === "awaiting_human" && document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "false");
    await desktop.page.locator("#reject-decision").click();
    await desktop.page.locator("#decision-note").fill("The evidence does not prove the required functional cycle under load.");
    await desktop.page.locator("#dialog-confirm").click();
    await desktop.page.waitForFunction(() => window.__closeoutApp?.getState().pending?.status === "rejected" && document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "false");
    await prepareScreenshot(desktop.page);
    await desktop.page.screenshot({ path: join(OUTPUT_DIR, `desktop-rejected-${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}.png`), fullPage: false });
    await desktop.page.locator("#reopen-decision").click();
    await desktop.page.waitForFunction(() => window.__closeoutApp?.getState().pending === null && document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "false");
    await desktop.page.locator("#stage-proposal").click();
    await desktop.page.waitForFunction(() => window.__closeoutApp?.getState().pending?.status === "awaiting_human" && document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "false");
    await desktop.page.locator("#defer-decision").click();
    await desktop.page.locator("#decision-note").fill("Owner witness is unavailable until the scheduled Monday walkthrough.");
    await desktop.page.locator("#dialog-confirm").click();
    await desktop.page.waitForFunction(() => window.__closeoutApp?.getState().pending?.status === "deferred" && document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "false");
    await prepareScreenshot(desktop.page);
    await desktop.page.screenshot({ path: join(OUTPUT_DIR, `desktop-deferred-${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}.png`), fullPage: false });
  }
  await desktop.context.close();

  const mobile = await newPage(browser, origin, MOBILE_VIEWPORT);
  await prepareScreenshot(mobile.page);
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-evidence-${MOBILE_VIEWPORT_TAG}.png`), fullPage: false });
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-evidence-full-${MOBILE_WIDTH_TAG}.png`), fullPage: true });
  const mobileEvidenceMetrics = await metrics(mobile.page, mobile.errors);
  await mobile.page.locator('.mobile-workspace-nav [data-mobile-panel="requirements"]').click();
  await mobile.page.waitForTimeout(250);
  await prepareScreenshot(mobile.page);
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-requirements-${MOBILE_VIEWPORT_TAG}.png`), fullPage: false });
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-requirements-full-${MOBILE_WIDTH_TAG}.png`), fullPage: true });
  const mobileRequirementsMetrics = await metrics(mobile.page, mobile.errors);
  const mobileIssuesToggle = mobile.page.locator("#mobile-toggle-issues");
  if (await mobileIssuesToggle.isVisible()) {
    await mobileIssuesToggle.click();
    await mobile.page.waitForTimeout(150);
    await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-requirements-expanded-full-${MOBILE_WIDTH_TAG}.png`), fullPage: true });
    await mobileIssuesToggle.click();
  }
  await mobile.page.locator('.mobile-workspace-nav [data-mobile-panel="decision"]').click();
  await mobile.page.waitForTimeout(250);
  await prepareScreenshot(mobile.page);
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-decision-${MOBILE_VIEWPORT_TAG}.png`), fullPage: false });
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-decision-full-${MOBILE_WIDTH_TAG}.png`), fullPage: true });
  await focusWithKeyboard(mobile.page, "#stage-proposal");
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-decision-keyboard-focus-${MOBILE_VIEWPORT_TAG}.png`), fullPage: false });
  await prepareScreenshot(mobile.page);
  const mobileDecisionMetrics = await metrics(mobile.page, mobile.errors);
  await mobile.page.locator("#stage-proposal").click();
  await mobile.page.waitForFunction(() => document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "true");
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-decision-loading-${MOBILE_VIEWPORT_TAG}.png`), fullPage: false });
  await mobile.page.waitForFunction(() => window.__closeoutApp?.getState().pending?.status === "awaiting_human" && document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "false");
  await prepareScreenshot(mobile.page);
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-decision-staged-${MOBILE_VIEWPORT_TAG}.png`), fullPage: false });
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-decision-staged-full-${MOBILE_WIDTH_TAG}.png`), fullPage: true });
  const mobileStagedMetrics = await metrics(mobile.page, mobile.errors);
  await mobile.page.locator("#reject-decision").click();
  await mobile.page.locator("#decision-note").fill("too short");
  await mobile.page.locator("#dialog-confirm").click();
  await mobile.page.waitForFunction(() => document.querySelector("#decision-note")?.getAttribute("aria-invalid") === "true");
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-decision-validation-error-${MOBILE_VIEWPORT_TAG}.png`), fullPage: false });
  await mobile.page.locator("#dialog-cancel").click();
  await mobile.page.locator("#accept-decision").click();
  await mobile.page.waitForFunction(() => window.__closeoutApp?.getState().pending?.status === "approved" && document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "false");
  await prepareScreenshot(mobile.page);
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-decision-approved-${MOBILE_VIEWPORT_TAG}.png`), fullPage: false });
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-decision-approved-full-${MOBILE_WIDTH_TAG}.png`), fullPage: true });
  const mobileApprovedMetrics = await metrics(mobile.page, mobile.errors);
  await mobile.page.evaluate(async () => {
    const token = window.__closeoutApp.getState().pending.token;
    await window.__registeredSiteTools.closeout_apply_approved_change.execute({ token });
  });
  await mobile.page.waitForFunction(() => window.__closeoutApp?.getState().pending?.status === "consumed");
  await prepareScreenshot(mobile.page);
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-decision-applied-${MOBILE_VIEWPORT_TAG}.png`), fullPage: false });
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-decision-applied-full-${MOBILE_WIDTH_TAG}.png`), fullPage: true });
  const mobileAppliedMetrics = await metrics(mobile.page, mobile.errors);
  await mobile.page.locator('.mobile-workspace-nav [data-mobile-panel="requirements"]').click();
  await mobile.page.locator('[data-requirement-id="paint"]').click();
  await mobile.page.waitForFunction(() => document.querySelector('[data-requirement-id="paint"]')?.getAttribute("aria-current") === "true");
  await mobile.page.locator('.mobile-workspace-nav [data-mobile-panel="decision"]').click();
  if (!(await mobile.page.locator("#stage-proposal").isEnabled())) {
    throw new Error("Consumed proposal did not expose the next eligible mobile lane");
  }
  await prepareScreenshot(mobile.page);
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-decision-consumed-next-lane-${MOBILE_VIEWPORT_TAG}.png`), fullPage: false });
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-decision-consumed-next-lane-full-${MOBILE_WIDTH_TAG}.png`), fullPage: true });
  const mobileNextLaneMetrics = await metrics(mobile.page, mobile.errors);
  await mobile.page.locator("#stage-proposal").click();
  await mobile.page.waitForFunction(() => window.__closeoutApp?.getState().pending?.requirementId === "paint"
    && window.__closeoutApp?.getState().pending?.status === "awaiting_human"
    && document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "false");
  await prepareScreenshot(mobile.page);
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-decision-next-lane-staged-${MOBILE_VIEWPORT_TAG}.png`), fullPage: false });
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-decision-next-lane-staged-full-${MOBILE_WIDTH_TAG}.png`), fullPage: true });
  await mobile.page.evaluate(async () => window.__registeredSiteTools.closeout_reset_demo.execute({}));
  await mobile.page.locator('.mobile-workspace-nav [data-mobile-panel="decision"]').click();
  await mobile.page.locator("#stage-proposal").click();
  await mobile.page.waitForFunction(() => window.__closeoutApp?.getState().pending?.status === "awaiting_human" && document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "false");
  await mobile.page.locator("#reject-decision").click();
  await mobile.page.locator("#decision-note").fill("The evidence does not prove the required functional cycle under load.");
  await mobile.page.locator("#dialog-confirm").click();
  await mobile.page.waitForFunction(() => window.__closeoutApp?.getState().pending?.status === "rejected" && document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "false");
  await prepareScreenshot(mobile.page);
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-decision-rejected-${MOBILE_VIEWPORT_TAG}.png`), fullPage: false });
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-decision-rejected-full-${MOBILE_WIDTH_TAG}.png`), fullPage: true });
  await mobile.page.locator("#reopen-decision").click();
  await mobile.page.waitForFunction(() => window.__closeoutApp?.getState().pending === null && document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "false");
  await mobile.page.locator("#stage-proposal").click();
  await mobile.page.waitForFunction(() => window.__closeoutApp?.getState().pending?.status === "awaiting_human" && document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "false");
  await mobile.page.locator("#defer-decision").click();
  await mobile.page.locator("#decision-note").fill("Owner witness is unavailable until the scheduled Monday walkthrough.");
  await mobile.page.locator("#dialog-confirm").click();
  await mobile.page.waitForFunction(() => window.__closeoutApp?.getState().pending?.status === "deferred" && document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "false");
  await prepareScreenshot(mobile.page);
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-decision-deferred-${MOBILE_VIEWPORT_TAG}.png`), fullPage: false });
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, `mobile-decision-deferred-full-${MOBILE_WIDTH_TAG}.png`), fullPage: true });
  await mobile.context.close();

  process.stdout.write(`${JSON.stringify({
    desktop: {
      seed: desktopMetrics,
      consumedNextLane: desktopNextLaneMetrics,
    },
    mobile: {
      evidence: mobileEvidenceMetrics,
      requirements: mobileRequirementsMetrics,
      decisionSeed: mobileDecisionMetrics,
      decisionStaged: mobileStagedMetrics,
      decisionApproved: mobileApprovedMetrics,
      decisionApplied: mobileAppliedMetrics,
      consumedNextLane: mobileNextLaneMetrics,
    },
  }, null, 2)}\n`);
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
