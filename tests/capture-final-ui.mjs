import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(TEST_DIR, "..");
const OUTPUT_DIR = join(PROJECT_ROOT, "artifacts", "ui-qa", "20260828-final");
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
  return await page.evaluate((runtimeErrors) => ({
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
    errors: runtimeErrors,
  }), errors);
}

const { server, origin } = await startServer();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

try {
  const desktop = await newPage(browser, origin, { width: 1440, height: 900 });
  await desktop.page.screenshot({ path: join(OUTPUT_DIR, "desktop-1440x900.png"), fullPage: false });
  const desktopMetrics = await metrics(desktop.page, desktop.errors);
  await desktop.context.close();

  const mobile = await newPage(browser, origin, { width: 390, height: 844 });
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
