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
const MOBILE_VIEWPORT = { width: 390, height: 844 };
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
        return control.offsetParent !== null && (rect.width < 40 || rect.height < 40);
      }).length,
      controlsBelow40: [...document.querySelectorAll("button, [role='button'], textarea")].flatMap((control) => {
        const rect = control.getBoundingClientRect();
        if (control.offsetParent === null || (rect.width >= 40 && rect.height >= 40)) return [];
        return [{ id: control.id || null, label: (control.getAttribute("aria-label") || control.textContent || "").trim().slice(0, 60), width: Math.round(rect.width), height: Math.round(rect.height) }];
      }),
      viewAllRect: viewAllRect ? { top: Math.round(viewAllRect.top), bottom: Math.round(viewAllRect.bottom), height: Math.round(viewAllRect.height) } : null,
      errors: runtimeErrors,
    };
  }, errors);
}

const { server, origin } = await startServer();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
mkdirSync(OUTPUT_DIR, { recursive: true });

try {
  const desktop = await newPage(browser, origin, DESKTOP_VIEWPORT);
  await desktop.page.screenshot({ path: join(OUTPUT_DIR, `desktop-${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}.png`), fullPage: false });
  const desktopMetrics = await metrics(desktop.page, desktop.errors);
  if (process.env.CLOSEOUT_CAPTURE_STATES === "1") {
    await desktop.page.locator("#stage-proposal").click();
    await desktop.page.waitForFunction(() => window.__closeoutApp?.getState().pending?.status === "awaiting_human");
    await desktop.page.waitForTimeout(3900);
    await desktop.page.screenshot({ path: join(OUTPUT_DIR, `desktop-staged-${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}.png`), fullPage: false });
    await desktop.page.locator("#accept-decision").click();
    await desktop.page.waitForFunction(() => window.__closeoutApp?.getState().pending?.status === "approved");
    await desktop.page.waitForTimeout(3900);
    await desktop.page.screenshot({ path: join(OUTPUT_DIR, `desktop-approved-${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}.png`), fullPage: false });
    await desktop.page.evaluate(async () => {
      const token = window.__closeoutApp.getState().pending.token;
      await window.__registeredSiteTools.closeout_apply_approved_change.execute({ token });
    });
    await desktop.page.waitForFunction(() => window.__closeoutApp?.getState().pending?.status === "consumed");
    await desktop.page.waitForTimeout(3900);
    await desktop.page.screenshot({ path: join(OUTPUT_DIR, `desktop-applied-${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}.png`), fullPage: false });
  }
  await desktop.context.close();

  const mobile = await newPage(browser, origin, MOBILE_VIEWPORT);
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, "mobile-evidence-390x844.png"), fullPage: false });
  await mobile.page.locator('[data-mobile-panel="requirements"]').first().click();
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, "mobile-requirements-390x844.png"), fullPage: false });
  await mobile.page.locator('[data-mobile-panel="decision"]').first().click();
  await mobile.page.screenshot({ path: join(OUTPUT_DIR, "mobile-decision-390x844.png"), fullPage: false });
  const mobileMetrics = await metrics(mobile.page, mobile.errors);
  await mobile.context.close();

  process.stdout.write(`${JSON.stringify({ desktop: desktopMetrics, mobile: mobileMetrics }, null, 2)}\n`);
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
