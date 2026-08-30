import assert from "node:assert/strict";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(TEST_DIR, "..");
const MACOS_CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SEED_FIXTURE_FINGERPRINT = "fnv1a-2d7afc64";
const SEED_STATE_FINGERPRINT = "fnv1a-927cf098";
const SEED_DIGEST = "sha256-0265e6e8a84f77996a886deb71e8df1d85b1bc5af001e712f96054433b2141c6";
const AUTOMATED_APPLIED_STATE_FINGERPRINT = "fnv1a-43cb4a90";
const AUTOMATED_APPLIED_DIGEST = "sha256-2c70d7bb4e0dfc038b8720ef9fff5b0b8165c05ccbe60a0b0bc3405c6aba1b59";
const EXPECTED_TOOLS = [
  "closeout_read_state",
  "closeout_read_requirement_detail",
  "closeout_identify_blockers",
  "closeout_propose_plan",
  "closeout_pending_approval",
  "closeout_read_audit_log",
  "closeout_stage_change",
  "closeout_apply_approved_change",
  "closeout_preview_handoff_package",
  "closeout_reset_demo",
];
const STAGE_INPUT = {
  requirementId: "fire-test",
  evidenceId: "ev-fire-photo",
  reason: "Current Rev 2 passing test directly satisfies the FD-204 fire damper requirement.",
};
const PAINT_STAGE_INPUT = {
  requirementId: "paint",
  evidenceId: "ev-paint-photo",
  reason: "Photo 12 documents the corrected entry-wall finish for the owner's visible acceptance decision.",
};

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

async function newHarness(browser, origin, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
  });
  await page.addInitScript(() => {
    const registry = Object.create(null);
    Object.defineProperty(window, "__registeredSiteTools", { value: registry, configurable: false });
    Object.defineProperty(document, "modelContext", {
      configurable: false,
      value: {
        async registerTool(definition) {
          if (!definition || typeof definition.name !== "string" || typeof definition.execute !== "function") {
            throw new TypeError("Invalid Site Tool definition");
          }
          if (registry[definition.name]) throw new Error(`Duplicate Site Tool: ${definition.name}`);
          registry[definition.name] = definition;
        },
      },
    });
  });
  await page.goto(`${origin}/app/index.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__closeoutApp?.registration === "resolved");
  return { context, page, runtimeErrors };
}

async function callTool(page, name, input = {}) {
  return await page.evaluate(async ({ toolName, toolInput }) => {
    const tool = window.__registeredSiteTools[toolName];
    if (!tool) throw new Error(`Site Tool not registered: ${toolName}`);
    return await tool.execute(toolInput);
  }, { toolName: name, toolInput: input });
}

async function callToolsConcurrently(page, calls) {
  return await page.evaluate(async (toolCalls) => await Promise.all(toolCalls.map(async ({ name, input }) => {
    const tool = window.__registeredSiteTools[name];
    if (!tool) throw new Error(`Site Tool not registered: ${name}`);
    return await tool.execute(input || {});
  })), calls);
}

async function registrationSnapshot(page) {
  return await page.evaluate(() => Object.values(window.__registeredSiteTools).map((tool) => ({
    name: tool.name,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  })));
}

function assertSeedState(result, generation) {
  assert.equal(result.ok, true);
  assert.equal(result.ready, 9);
  assert.equal(result.total, 14);
  assert.equal(result.exceptions.length, 5);
  assert.deepEqual(result.exceptions.map((item) => item.id), ["fire-test", "warranty", "ceiling-repair", "training", "paint"]);
  assert.equal(result.pending, null);
  assert.equal(result.generation, generation);
  assert.equal(result.validationFixtureFingerprint, SEED_FIXTURE_FINGERPRINT);
  assert.equal(result.projectStateFingerprint, SEED_STATE_FINGERPRINT);
  assert.equal(result.projectStateDigest, SEED_DIGEST);
}

async function assertNoRuntimeErrors(harness) {
  await harness.page.waitForTimeout(50);
  assert.deepEqual(harness.runtimeErrors, []);
}

async function testRegistrationAndReadContracts(browser, origin) {
  const harness = await newHarness(browser, origin);
  try {
    const definitions = await registrationSnapshot(harness.page);
    assert.deepEqual(definitions.map((tool) => tool.name), EXPECTED_TOOLS);
    assert.equal(definitions.filter((tool) => tool.annotations.readOnlyHint).length, 7);
    assert.equal(definitions.filter((tool) => !tool.annotations.readOnlyHint).length, 3);
    for (const definition of definitions) {
      assert.equal(definition.inputSchema.type, "object");
      assert.equal(definition.inputSchema.additionalProperties, false);
      assert.equal(definition.annotations.openWorldHint, false);
    }
    const resetDefinition = definitions.find((tool) => tool.name === "closeout_reset_demo");
    assert.equal(resetDefinition.annotations.destructiveHint, true);

    const state = await callTool(harness.page, "closeout_read_state");
    assertSeedState(state, 1);
    assert.equal(JSON.parse(JSON.stringify(state)).requirements.length, 14);
    const blockers = await callTool(harness.page, "closeout_identify_blockers");
    assert.equal(blockers.ok, true);
    assert.equal(blockers.count, 5);
    assert.equal(blockers.projectStateDigest, SEED_DIGEST);
    const unknown = await callTool(harness.page, "closeout_read_requirement_detail", { requirementId: "<script>nope</script>" });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error.code, "UNKNOWN_REQUIREMENT");
    assert.equal(unknown.projectStateFingerprint, SEED_STATE_FINGERPRINT);
    await harness.page.locator('[data-requirement-id="ceiling-repair"]').click();
    const scopeChecks = await harness.page.locator("#rule-checks li").evaluateAll((items) => items.map((item) => ({ text: item.textContent.trim(), unknown: item.classList.contains("is-unknown") })));
    assert.equal(scopeChecks.length, 3);
    assert.equal(scopeChecks[1].text, "·Required revision is current");
    assert.equal(scopeChecks[1].unknown, true);
    assert.equal(scopeChecks[2].unknown, true);
    await harness.page.locator('[data-requirement-id="paint"]').click();
    const paintChecks = await harness.page.locator("#rule-checks li").evaluateAll((items) => items.map((item) => ({ text: item.textContent.trim(), unknown: item.classList.contains("is-unknown") })));
    assert.equal(paintChecks.length, 3);
    assert.equal(paintChecks[2].text, "·Acceptance decision is recorded");
    assert.equal(paintChecks[2].unknown, true);
    assert.equal(await harness.page.locator("#stage-proposal").textContent(), "Stage owner evidence for review");
    assert.equal(await harness.page.locator("#item-position").textContent(), "Item 14 of 14");
    await assertNoRuntimeErrors(harness);
  } finally {
    await harness.context.close();
  }
}

async function testTenSecureFlows(browser, origin) {
  const harness = await newHarness(browser, origin);
  try {
    for (let flow = 1; flow <= 10; flow += 1) {
      const before = await callTool(harness.page, "closeout_read_state");
      assertSeedState(before, flow);

      const staged = await callTool(harness.page, "closeout_stage_change", STAGE_INPUT);
      assert.equal(staged.ok, true);
      assert.equal(staged.pending.generation, flow);
      assert.equal(staged.pending.status, "awaiting_human");
      assert.equal(staged.projectStateDigest, SEED_DIGEST);
      const token = staged.pending.token;
      assert.match(token, new RegExp(`^approval-[a-f0-9]{24}-g${flow}-s1$`));

      const beforeApproval = await callTool(harness.page, "closeout_apply_approved_change", { token });
      assert.equal(beforeApproval.ok, false);
      assert.equal(beforeApproval.error.code, "HUMAN_APPROVAL_REQUIRED");
      assert.equal((await callTool(harness.page, "closeout_read_state")).ready, 9);

      await harness.page.locator("#accept-decision").click();
      await harness.page.waitForFunction(() => window.__closeoutApp.getState().pending?.status === "approved");
      const approvedState = await callTool(harness.page, "closeout_read_state");
      assert.equal(approvedState.ready, 9);
      assert.equal(approvedState.pending.status, "approved");
      assert.equal(approvedState.projectStateDigest, SEED_DIGEST);

      const applied = await callTool(harness.page, "closeout_apply_approved_change", { token });
      assert.equal(applied.ok, true);
      assert.equal(applied.ready, 10);
      assert.equal(applied.total, 14);
      assert.equal(applied.exceptionCount, 4);
      assert.equal(applied.pending.status, "consumed");
      assert.equal(applied.pending.token, token);
      assert.equal(applied.pending.payload.requirementId, "fire-test");
      assert.equal(applied.pending.payload.evidenceId, "ev-fire-photo");
      assert.equal(applied.requirement.id, "fire-test");
      assert.equal(applied.requirement.status, "ready");
      assert.equal(applied.requirement.acceptance.evidenceId, "ev-fire-photo");
      assert.equal(applied.requirement.acceptance.reason, STAGE_INPUT.reason);
      const appliedDigest = applied.projectStateDigest;
      assert.equal(applied.projectStateFingerprint, AUTOMATED_APPLIED_STATE_FINGERPRINT);
      assert.equal(appliedDigest, AUTOMATED_APPLIED_DIGEST);
      if (flow === 1) console.log(`INFO applied state ${applied.projectStateFingerprint} ${appliedDigest}`);

      const replay = await callTool(harness.page, "closeout_apply_approved_change", { token });
      assert.equal(replay.ok, false);
      assert.equal(replay.error.code, "APPROVAL_CONSUMED");
      const afterReplay = await callTool(harness.page, "closeout_read_state");
      assert.equal(afterReplay.ready, 10);
      assert.equal(afterReplay.projectStateDigest, appliedDigest);
      assert.deepEqual(afterReplay.exceptions.map((item) => item.id), ["warranty", "ceiling-repair", "training", "paint"]);
      const fireRequirement = afterReplay.requirements.find((item) => item.id === "fire-test");
      assert.equal(fireRequirement.status, "ready");
      assert.equal(fireRequirement.acceptance.evidenceId, "ev-fire-photo");
      assert.equal(fireRequirement.evidence.find((item) => item.id === "ev-fire-photo").linked, true);

      const audit = await callTool(harness.page, "closeout_read_audit_log");
      assert.equal(audit.count, 3);
      assert.deepEqual(audit.audit.map((event) => event.event), ["proposal_staged", "human_approved", "approved_change_applied"]);
      for (const event of audit.audit) {
        assert.equal(event.approvalToken, token);
        assert.equal(event.generation, flow);
        assert.equal(event.requirementId, "fire-test");
        assert.equal(event.evidenceId, "ev-fire-photo");
        assert.equal(event.payloadDigest, staged.pending.payloadDigest);
        assert.equal(event.payloadSnapshot.requirementId, "fire-test");
        assert.equal(event.payloadSnapshot.evidenceId, "ev-fire-photo");
      }
      assert.equal(audit.audit[1].approvalDigest, applied.pending.approvalDigest);
      assert.equal(audit.audit[2].resultingStateDigest, appliedDigest);
      await harness.page.locator('[data-open-drawer="audit"]').first().click();
      assert.equal(await harness.page.locator("#audit-empty").isVisible(), false);
      assert.equal(await harness.page.locator("#audit-timeline .audit-event").count(), 3);
      await harness.page.locator("#audit-drawer [data-close-drawer]").click();
      const handoff = await callTool(harness.page, "closeout_preview_handoff_package");
      assert.equal(handoff.package.status, "not_ready_to_issue");
      assert.equal(handoff.package.readyCount, 10);
      assert.equal(handoff.package.exceptionCount, 4);
      assert.deepEqual(handoff.package.exceptions.map((item) => item.id), ["warranty", "ceiling-repair", "training", "paint"]);
      const acceptedFire = handoff.package.accepted.find((item) => item.id === "fire-test");
      assert.equal(acceptedFire.acceptance.evidenceId, "ev-fire-photo");
      assert.deepEqual(acceptedFire.evidenceIds, ["ev-fire-photo"]);
      assert.deepEqual(acceptedFire.evidenceChainIds, ["ev-fire-photo", "ev-fire-report", "ev-fire-plan"]);
      await harness.page.locator('[data-open-drawer="handoff"]').first().click();
      assert.equal((await harness.page.locator("#package-footer-copy").textContent()).trim(), "Resolve or explicitly carry all 4 exceptions before issue.");
      await harness.page.locator("#handoff-drawer [data-close-drawer]").click();

      let reset;
      if (flow === 1) {
        const concurrent = await callToolsConcurrently(harness.page, [
          { name: "closeout_reset_demo", input: {} },
          { name: "closeout_apply_approved_change", input: { token } },
        ]);
        [reset] = concurrent;
        assert.equal(concurrent[1].ok, false);
        assert.equal(concurrent[1].error.code, "OPERATION_IN_PROGRESS");
      } else {
        reset = await callTool(harness.page, "closeout_reset_demo");
      }
      assert.equal(reset.ok, true);
      assert.equal(reset.priorGeneration, flow);
      assert.equal(reset.generation, flow + 1);
      assert.equal(reset.ready, 9);
      assert.equal(reset.total, 14);
      assert.equal(reset.pending, null);
      assert.deepEqual(reset.audit, []);
      assert.equal(reset.validationFixtureFingerprint, SEED_FIXTURE_FINGERPRINT);
      assert.equal(reset.projectStateFingerprint, SEED_STATE_FINGERPRINT);
      assert.equal(reset.projectStateDigest, SEED_DIGEST);

      const stale = await callTool(harness.page, "closeout_apply_approved_change", { token });
      assert.equal(stale.ok, false);
      assert.equal(stale.error.code, "TOKEN_GENERATION_STALE");
      assertSeedState(await callTool(harness.page, "closeout_read_state"), flow + 1);
    }
    await assertNoRuntimeErrors(harness);
  } finally {
    await harness.context.close();
  }
}

async function testDecisionStatesAndKeyboard(browser, origin) {
  const harness = await newHarness(browser, origin);
  try {
    assert.equal(await harness.page.locator("#accept-decision").isDisabled(), true);
    assert.equal(await harness.page.locator("#accept-decision-icon").getAttribute("href"), "#icon-lock");
    assert.equal(await harness.page.locator("#decision-actions").isVisible(), true);
    assert.equal(await harness.page.locator("#decision-result").isVisible(), false);

    await harness.page.locator("#stage-proposal").click();
    await harness.page.waitForFunction(() => document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "true");
    assert.equal(await harness.page.locator("#decision-state").textContent(), "Updating decision");
    await harness.page.waitForFunction(() => window.__closeoutApp.getState().pending?.status === "awaiting_human" && document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "false");
    assert.equal(await harness.page.locator("#accept-decision").isEnabled(), true);
    assert.equal(await harness.page.locator("#accept-decision-icon").getAttribute("href"), "#icon-tick");
    assert.equal(await harness.page.locator("#stage-status").isVisible(), true);
    assert.equal(await harness.page.locator("#stage-proposal").isVisible(), false);

    await harness.page.locator("#accept-decision").click();
    await harness.page.waitForFunction(() => window.__closeoutApp.getState().pending?.status === "approved" && document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "false");
    assert.equal(await harness.page.locator("#decision-actions").isVisible(), false);
    assert.equal(await harness.page.locator("#decision-result").isVisible(), true);
    assert.equal(await harness.page.locator("#decision-result-title").textContent(), "Approved · awaiting agent apply");
    assert.equal(await harness.page.locator("#reopen-decision").textContent(), "Withdraw approval");
    await harness.page.locator("#reopen-decision").click();
    await harness.page.waitForFunction(() => window.__closeoutApp.getState().pending === null && document.querySelector("#human-decision-card")?.getAttribute("aria-busy") === "false");
    assert.deepEqual((await callTool(harness.page, "closeout_read_audit_log")).audit.map((event) => event.event), ["proposal_staged", "human_approved", "human_withdrew_approval"]);
    assert.equal((await callTool(harness.page, "closeout_read_state")).ready, 9);
    await callTool(harness.page, "closeout_reset_demo");

    const staged = await callTool(harness.page, "closeout_stage_change", STAGE_INPUT);
    const token = staged.pending.token;
    await harness.page.locator("#reject-decision").click();
    assert.equal(await harness.page.locator("#decision-dialog").getAttribute("aria-hidden"), "false");
    assert.equal(await harness.page.evaluate(() => document.activeElement?.id), "decision-note");
    await harness.page.locator("#decision-note").fill("too short");
    await harness.page.locator("#dialog-confirm").click();
    assert.equal(await harness.page.locator("#decision-note").getAttribute("aria-invalid"), "true");
    assert.equal(await harness.page.locator("#decision-note-error").isVisible(), true);
    await harness.page.locator("#decision-note").fill("The photo does not prove the required functional cycle under load.");
    await harness.page.locator("#dialog-confirm").click();
    await harness.page.waitForFunction(() => window.__closeoutApp.getState().pending?.status === "rejected");
    const rejectedApply = await callTool(harness.page, "closeout_apply_approved_change", { token });
    assert.equal(rejectedApply.ok, false);
    assert.equal(rejectedApply.error.code, "PROPOSAL_REJECTED");
    assert.equal((await callTool(harness.page, "closeout_read_state")).ready, 9);
    await harness.page.locator("#reopen-decision").click();
    await harness.page.waitForFunction(() => window.__closeoutApp.getState().pending === null);
    assert.equal((await callTool(harness.page, "closeout_read_audit_log")).count, 3);

    const stagedAgain = await callTool(harness.page, "closeout_stage_change", STAGE_INPUT);
    await harness.page.locator("#defer-decision").click();
    await harness.page.locator("#decision-note").fill("Owner witness is unavailable until the scheduled Monday walkthrough.");
    await harness.page.locator("#dialog-confirm").click();
    await harness.page.waitForFunction(() => window.__closeoutApp.getState().pending?.status === "deferred");
    const deferredApply = await callTool(harness.page, "closeout_apply_approved_change", { token: stagedAgain.pending.token });
    assert.equal(deferredApply.ok, false);
    assert.equal(deferredApply.error.code, "PROPOSAL_DEFERRED");
    assert.equal((await callTool(harness.page, "closeout_read_state")).ready, 9);

    const auditTrigger = harness.page.locator('[data-open-drawer="audit"]').first();
    await auditTrigger.click();
    assert.equal(await harness.page.locator("#audit-drawer").getAttribute("aria-hidden"), "false");
    assert.equal(await harness.page.evaluate(() => document.querySelector(".app-shell").inert), true);
    assert.equal(await harness.page.evaluate(() => document.activeElement?.closest("#audit-drawer")?.id), "audit-drawer");
    await harness.page.keyboard.press("Shift+Tab");
    assert.equal(await harness.page.evaluate(() => document.activeElement?.closest("#audit-drawer")?.id), "audit-drawer");
    await harness.page.keyboard.press("Tab");
    assert.equal(await harness.page.evaluate(() => document.activeElement?.closest("#audit-drawer")?.id), "audit-drawer");
    await harness.page.keyboard.press("Escape");
    assert.equal(await harness.page.locator("#audit-drawer").getAttribute("aria-hidden"), "true");
    assert.equal(await harness.page.evaluate(() => document.activeElement?.getAttribute("data-open-drawer")), "audit");

    await harness.page.locator("#filter-all").focus();
    await harness.page.keyboard.press("ArrowRight");
    assert.equal(await harness.page.evaluate(() => document.activeElement?.id), "filter-exceptions");
    assert.equal(await harness.page.locator("#filter-exceptions").getAttribute("aria-selected"), "true");
    await harness.page.keyboard.press("End");
    assert.equal(await harness.page.evaluate(() => document.activeElement?.id), "filter-ready");
    await harness.page.keyboard.press("Home");
    assert.equal(await harness.page.evaluate(() => document.activeElement?.id), "filter-all");
    await harness.page.keyboard.press("ArrowLeft");
    assert.equal(await harness.page.evaluate(() => document.activeElement?.id), "filter-ready");
    await assertNoRuntimeErrors(harness);
  } finally {
    await harness.context.close();
  }
}

async function testSelectionFocus(browser, origin) {
  const desktop = await newHarness(browser, origin);
  try {
    const requirement = desktop.page.locator('[data-requirement-id="fire-test"]');
    await requirement.focus();
    await desktop.page.keyboard.press("Enter");
    await desktop.page.waitForFunction(() => document.activeElement?.dataset.requirementId === "fire-test");
    assert.equal(await desktop.page.evaluate(() => document.activeElement?.dataset.requirementId), "fire-test");

    const evidence = desktop.page.locator("#evidence-tab-ev-fire-photo");
    await evidence.focus();
    await desktop.page.keyboard.press("Enter");
    await desktop.page.waitForFunction(() => document.activeElement?.id === "evidence-tab-ev-fire-photo");
    assert.equal(await desktop.page.evaluate(() => document.activeElement?.id), "evidence-tab-ev-fire-photo");
    await assertNoRuntimeErrors(desktop);
  } finally {
    await desktop.context.close();
  }

  const mobile = await newHarness(browser, origin, { width: 390, height: 844 });
  try {
    await mobile.page.locator('[data-mobile-panel="requirements"]').focus();
    await mobile.page.keyboard.press("Enter");
    await mobile.page.waitForFunction(() => document.activeElement?.id === "requirements-heading");
    assert.equal(await mobile.page.evaluate(() => document.activeElement?.id), "requirements-heading");
    const requirement = mobile.page.locator('[data-requirement-id="fire-test"]');
    await requirement.focus();
    await mobile.page.keyboard.press("Enter");
    await mobile.page.waitForFunction(() => document.activeElement?.id === "evidence-heading");
    assert.equal(await mobile.page.evaluate(() => document.activeElement?.id), "evidence-heading");
    assert.equal(await mobile.page.locator(".app-shell").getAttribute("data-mobile-panel"), "evidence");
    await assertNoRuntimeErrors(mobile);
  } finally {
    await mobile.context.close();
  }
}

async function testOwnerAcceptanceFlow(browser, origin) {
  const harness = await newHarness(browser, origin);
  try {
    await harness.page.locator('[data-requirement-id="paint"]').click();
    const staged = await callTool(harness.page, "closeout_stage_change", PAINT_STAGE_INPUT);
    assert.equal(staged.ok, true);
    assert.equal(staged.pending.payload.type, "record_owner_acceptance");
    assert.equal(staged.pending.payload.resultStatus, "ready");
    assert.equal(staged.pending.payload.resultEvidenceVerdict, "Accepted by owner");
    assert.equal((await callTool(harness.page, "closeout_read_state")).ready, 9);

    await harness.page.locator("#accept-decision").click();
    await harness.page.waitForFunction(() => window.__closeoutApp.getState().pending?.status === "approved");
    const applied = await callTool(harness.page, "closeout_apply_approved_change", { token: staged.pending.token });
    assert.equal(applied.ok, true);
    assert.equal(applied.ready, 10);
    assert.equal(applied.exceptionCount, 4);
    assert.equal(applied.requirement.id, "paint");
    assert.equal(applied.requirement.status, "ready");
    assert.equal(applied.requirement.acceptance.evidenceId, "ev-paint-photo");

    const acceptedState = await callTool(harness.page, "closeout_read_state");
    const paint = acceptedState.requirements.find((item) => item.id === "paint");
    assert.equal(paint.acceptance.evidenceId, "ev-paint-photo");
    assert.equal(paint.evidence[0].linked, true);
    assert.equal(paint.evidence[0].verdict, "Accepted by owner");
    const handoff = await callTool(harness.page, "closeout_preview_handoff_package");
    const acceptedPaint = handoff.package.accepted.find((item) => item.id === "paint");
    assert.deepEqual(acceptedPaint.evidenceIds, ["ev-paint-photo"]);
    assert.deepEqual(acceptedPaint.evidenceChainIds, ["ev-paint-photo"]);

    await harness.page.locator("#reopen-decision").click();
    await harness.page.waitForFunction(() => window.__closeoutApp.getState().pending === null);
    const reopened = await callTool(harness.page, "closeout_read_state");
    const reopenedPaint = reopened.requirements.find((item) => item.id === "paint");
    assert.equal(reopened.ready, 9);
    assert.equal(reopenedPaint.status, "owner_review");
    assert.equal(reopenedPaint.acceptance, null);
    assert.equal(reopenedPaint.evidence[0].linked, false);
    assert.equal(reopenedPaint.evidence[0].verdict, "Awaiting owner");
    assert.equal(reopened.projectStateDigest, SEED_DIGEST);
    assert.deepEqual((await callTool(harness.page, "closeout_read_audit_log")).audit.map((event) => event.event), ["proposal_staged", "human_approved", "approved_change_applied", "human_reopened"]);
    await assertNoRuntimeErrors(harness);
  } finally {
    await harness.context.close();
  }
}

async function testUntrustedInputAndMutationGuards(browser, origin) {
  const harness = await newHarness(browser, origin);
  try {
    const before = await callTool(harness.page, "closeout_read_state");
    const unknownRequirement = await callTool(harness.page, "closeout_stage_change", {
      requirementId: "<img src=x onerror=globalThis.__xssTriggered=true>",
      evidenceId: "ev-fire-photo",
      reason: "This is intentionally untrusted input for the regression harness.",
    });
    assert.equal(unknownRequirement.ok, false);
    assert.equal(unknownRequirement.error.code, "UNKNOWN_REQUIREMENT");
    const ineligible = await callTool(harness.page, "closeout_stage_change", {
      requirementId: "warranty",
      evidenceId: "ev-warranty-r1",
      reason: "Attempt to mutate an item outside the bounded eligible evidence match.",
    });
    assert.equal(ineligible.ok, false);
    assert.equal(ineligible.error.code, "EVIDENCE_NOT_ELIGIBLE");
    const shortReason = await callTool(harness.page, "closeout_stage_change", {
      requirementId: "fire-test",
      evidenceId: "ev-fire-photo",
      reason: "short",
    });
    assert.equal(shortReason.ok, false);
    assert.equal(shortReason.error.code, "REASON_REQUIRED");
    const afterGuards = await callTool(harness.page, "closeout_read_state");
    assert.equal(afterGuards.projectStateDigest, before.projectStateDigest);
    assert.equal(afterGuards.ready, 9);
    assert.equal(afterGuards.pending, null);
    assert.equal((await callTool(harness.page, "closeout_read_audit_log")).count, 0);

    const untrustedReason = "<img src=x onerror=globalThis.__xssTriggered=true> Exact Rev 2 evidence still matches FD-204.";
    const staged = await callTool(harness.page, "closeout_stage_change", { ...STAGE_INPUT, reason: untrustedReason });
    assert.equal(staged.ok, true);
    assert.equal(staged.pending.payload.reason, untrustedReason);
    await harness.page.locator('[data-open-drawer="audit"]').first().click();
    await harness.page.waitForTimeout(100);
    assert.equal(await harness.page.locator('img[src="x"]').count(), 0);
    assert.equal(await harness.page.evaluate(() => Boolean(window.__xssTriggered)), false);
    await harness.page.keyboard.press("Escape");
    await callTool(harness.page, "closeout_reset_demo");
    assertSeedState(await callTool(harness.page, "closeout_read_state"), 2);
    await assertNoRuntimeErrors(harness);
  } finally {
    await harness.context.close();
  }
}

async function main() {
  const { server, origin } = await startServer();
  let browser;
  const startedAt = Date.now();
  try {
    const requestedExecutable = process.env.CHROME_PATH || (existsSync(MACOS_CHROME_EXECUTABLE) ? MACOS_CHROME_EXECUTABLE : null);
    browser = await chromium.launch({ ...(requestedExecutable ? { executablePath: requestedExecutable } : {}), headless: true });
    await testRegistrationAndReadContracts(browser, origin);
    console.log("PASS registration and read/output contracts");
    await testTenSecureFlows(browser, origin);
    console.log("PASS ten consecutive secure apply/reset/stale-token flows");
    await testDecisionStatesAndKeyboard(browser, origin);
    console.log("PASS reject/defer/reopen and keyboard behavior");
    await testSelectionFocus(browser, origin);
    console.log("PASS desktop/mobile selection focus restoration");
    await testOwnerAcceptanceFlow(browser, origin);
    console.log("PASS owner acceptance apply/reopen flow");
    await testUntrustedInputAndMutationGuards(browser, origin);
    console.log("PASS untrusted input and mutation guards");
    console.log(`PASS production regression suite (${Date.now() - startedAt} ms)`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
