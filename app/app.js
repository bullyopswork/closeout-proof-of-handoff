(async function () {
  "use strict";

  const data = window.CloseoutData;
  if (!data) throw new Error("CloseoutData did not load.");
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function" || !globalThis.crypto.subtle) {
    throw new Error("Secure browser cryptography is required for approval integrity.");
  }

  const VALIDATION_SEED_HASH = "fnv1a-2d7afc64";
  const VALIDATION_APPLIED_HASH = "fnv1a-75d1e85b";
  const deepClone = (value) => JSON.parse(JSON.stringify(value));
  const initialRequirements = deepClone(data.requirements);
  const initialEvidence = deepClone(data.evidence);
  const mutationPolicies = {
    "fire-test": {
      evidenceId: "ev-fire-photo",
      openStatus: "unmatched_evidence",
      payloadType: "link_evidence",
      stageLabel: "Stage exact match for review",
      defaultReason: "Current Rev 2 passing test directly satisfies the FD-204 fire damper requirement.",
      appliedSummary: "Current Rev 2 passing test accepted and linked to the FD-204 requirement.",
      appliedEvidenceVerdict: "Pass",
    },
    paint: {
      evidenceId: "ev-paint-photo",
      openStatus: "owner_review",
      payloadType: "record_owner_acceptance",
      stageLabel: "Stage owner evidence for review",
      defaultReason: "Photo 12 documents the corrected entry-wall finish for the owner's visible acceptance decision.",
      appliedSummary: "Owner accepted the corrected finish shown in Photo 12 through the visible review control.",
      appliedEvidenceVerdict: "Accepted by owner",
    },
  };
  const nonceBytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(nonceBytes);
  const sessionNonce = Array.from(nonceBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

  const state = {
    requirements: deepClone(initialRequirements),
    evidence: deepClone(initialEvidence),
    selectedRequirementId: "fire-test",
    selectedEvidenceId: "ev-fire-photo",
    filter: "all",
    pending: null,
    sequence: 0,
    generation: 1,
    writeLocked: false,
    audit: [],
    mobilePanel: "evidence",
    activeDrawer: null,
    dialogMode: null,
  };

  const refs = Object.fromEntries([
    "app-shell", "project-title", "project-subtitle", "last-verified", "ready-count", "handoff-state",
    "readiness-meter-fill", "handoff-target", "exception-count", "filter-exception-count", "filter-ready-count",
    "mobile-exception-count", "requirement-list", "filter-empty", "item-position", "item-location",
    "evidence-heading", "selected-status", "evidence-kind", "evidence-label", "evidence-verdict", "evidence-viewport",
    "evidence-fallback", "evidence-source", "evidence-captured", "evidence-revision", "evidence-hash", "evidence-count",
    "evidence-tabs", "criterion-text", "required-revision", "current-revision", "scope-lane", "decision-heading",
    "decision-summary", "recommendation-match", "recommendation-text", "rule-checks", "stage-proposal", "decision-state",
    "decision-helper", "accept-decision", "reject-decision", "defer-decision", "reopen-decision", "owner-initials",
    "owner-name", "due-date", "tool-registration", "tool-registration-copy", "audit-count", "drawer-backdrop",
    "handoff-drawer", "audit-drawer", "package-ready-count", "package-exception-count", "package-state",
    "drawer-exception-count", "drawer-ready-count", "exception-package", "accepted-package", "audit-empty",
    "audit-timeline", "dialog-backdrop", "decision-dialog", "dialog-eyebrow", "dialog-heading", "dialog-copy",
    "decision-note", "decision-note-error", "dialog-cancel", "dialog-confirm", "toast-region", "zoom-toggle",
    "plan-template", "workflow-stage-label", "workflow-stage-copy", "workflow-human-label", "workflow-human-copy",
    "workflow-applied-copy", "match-location", "match-identity-label", "match-identity-copy", "match-revision",
    "match-verdict", "match-verdict-copy"
  ].map((id) => [id, document.getElementById(id)]));

  refs["app-shell"] = document.querySelector(".app-shell");
  refs["project-title"].textContent = data.project.name;
  refs["project-subtitle"].textContent = data.project.building;
  refs["last-verified"].textContent = data.project.lastVerified;
  refs["handoff-target"].textContent = data.project.handoffTarget;
  refs["app-shell"].dataset.mobilePanel = state.mobilePanel;

  function createElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }

  function fingerprint(value) {
    const input = stableStringify(value);
    let result = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
      result ^= input.charCodeAt(index);
      result = Math.imul(result, 0x01000193);
    }
    return `fnv1a-${(result >>> 0).toString(16).padStart(8, "0")}`;
  }

  function projectStateFingerprint() {
    return fingerprint({ requirements: state.requirements, evidence: state.evidence });
  }

  function validationFixtureFingerprint() {
    const fireTest = getRequirement("fire-test");
    return fireTest && fireTest.status === "ready" ? VALIDATION_APPLIED_HASH : VALIDATION_SEED_HASH;
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(stableStringify(value));
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return `sha256-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  function stateBasis() {
    return { requirements: state.requirements, evidence: state.evidence };
  }

  function projectStateDigest() {
    return sha256(stateBasis());
  }

  function acquireWriteLock() {
    if (state.writeLocked) return false;
    state.writeLocked = true;
    return true;
  }

  function releaseWriteLock() {
    state.writeLocked = false;
  }

  function getRequirement(id) {
    return state.requirements.find((item) => item.id === id) || null;
  }

  function getEvidence(id) {
    return state.evidence.find((item) => item.id === id) || null;
  }

  function mutationPolicyFor(requirementId) {
    return mutationPolicies[requirementId] || null;
  }

  function evidenceFor(requirement) {
    return requirement.evidenceIds.map(getEvidence).filter(Boolean);
  }

  function readyRequirements() {
    return state.requirements.filter((item) => item.status === "ready");
  }

  function openRequirements() {
    return state.requirements.filter((item) => item.status !== "ready");
  }

  function selectedRequirement() {
    return getRequirement(state.selectedRequirementId) || state.requirements[0];
  }

  function selectedEvidence(requirement) {
    const list = evidenceFor(requirement);
    return list.find((item) => item.id === state.selectedEvidenceId) || list[0] || null;
  }

  function displayStatus(status) {
    return data.statusLabels[status] || status.replaceAll("_", " ");
  }

  function statusSymbol(status) {
    return {
      ready: "✓",
      unmatched_evidence: "↗",
      stale: "!",
      scope_review: "?",
      missing: "—",
      owner_review: "○",
    }[status] || "·";
  }

  function renderSummary() {
    const ready = readyRequirements().length;
    const exceptions = state.requirements.length - ready;
    refs["ready-count"].textContent = ready;
    refs["exception-count"].textContent = exceptions;
    refs["filter-ready-count"].textContent = ready;
    refs["filter-exception-count"].textContent = exceptions;
    refs["mobile-exception-count"].textContent = exceptions;
    refs["readiness-meter-fill"].style.width = `${(ready / state.requirements.length) * 100}%`;
    const meter = refs["readiness-meter-fill"].parentElement;
    meter.setAttribute("aria-label", `${ready} of ${state.requirements.length} requirements ready`);
    meter.setAttribute("aria-valuenow", String(ready));
    refs["handoff-state"].textContent = exceptions ? "Blocked" : "Ready to issue";
    refs["handoff-state"].classList.toggle("is-ready", exceptions === 0);
  }

  function rowMicrocopy(requirement) {
    if (requirement.status === "ready") return `${requirement.currentRevision} · accepted`;
    if (requirement.status === "missing") return `No evidence · ${requirement.due}`;
    return `${requirement.currentRevision} · ${displayStatus(requirement.status).toLowerCase()}`;
  }

  function renderRequirements() {
    const filter = state.filter;
    const visible = state.requirements.filter((item) => {
      if (filter === "ready") return item.status === "ready";
      if (filter === "exceptions") return item.status !== "ready";
      return true;
    });

    const exceptionItems = visible.filter((item) => item.status !== "ready");
    const readyItems = visible.filter((item) => item.status === "ready");
    refs["requirement-list"].replaceChildren();

    function appendGroup(label, items, shownSubset = false) {
      if (!items.length) return;
      const groupLabel = createElement("div", "requirement-group-label");
      groupLabel.dataset.overflowGroup = label.startsWith("More ") ? "true" : "false";
      groupLabel.append(createElement("span", "", label), createElement("span", "", shownSubset ? `${items.length} shown` : items.length));
      refs["requirement-list"].append(groupLabel);
      items.forEach((requirement) => {
        const row = createElement("button", "requirement-row");
        row.type = "button";
        row.dataset.requirementId = requirement.id;
        row.classList.toggle("is-selected", requirement.id === state.selectedRequirementId);
        row.setAttribute("aria-current", requirement.id === state.selectedRequirementId ? "true" : "false");
        row.setAttribute("aria-label", `${requirement.label}, ${displayStatus(requirement.status)}, owner ${requirement.owner}`);
        const mark = createElement("span", `status-mark ${requirement.status}`, statusSymbol(requirement.status));
        mark.setAttribute("aria-hidden", "true");
        const copy = createElement("span", "requirement-copy");
        copy.append(createElement("strong", "", requirement.label), createElement("small", "", rowMicrocopy(requirement)));
        row.append(mark, copy, createElement("span", "requirement-owner", requirement.ownerInitials));
        row.addEventListener("click", () => selectRequirement(requirement.id));
        refs["requirement-list"].append(row);
      });
    }

    if (filter === "all") {
      appendGroup("Needs action", exceptionItems.slice(0, 3), true);
      appendGroup("Ready", readyItems.slice(0, 2), true);
      if (exceptionItems.length > 3 || readyItems.length > 2) refs["requirement-list"].append(createElement("div", "requirement-overflow-spacer"));
      appendGroup("More open items", exceptionItems.slice(3));
      appendGroup("More ready items", readyItems.slice(2));
    } else {
      appendGroup(filter === "exceptions" ? "Needs action" : "Ready", visible);
    }
    refs["filter-empty"].hidden = visible.length !== 0;
  }

  function renderEvidenceTabs(requirement) {
    const list = evidenceFor(requirement);
    refs["evidence-tabs"].replaceChildren();
    refs["evidence-count"].textContent = `${list.length + 1} linked checks`;
    if (!list.length) {
      const empty = createElement("div", "evidence-tab is-empty");
      empty.append(createElement("span", "evidence-tab-icon", "—"), createElement("span", "", "No evidence attached"));
      refs["evidence-tabs"].append(empty);
      return;
    }
    list.forEach((evidence, index) => {
      const button = createElement("button", "evidence-tab");
      button.type = "button";
      button.id = `evidence-tab-${evidence.id}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", "evidence-viewport");
      button.setAttribute("aria-selected", evidence.id === state.selectedEvidenceId ? "true" : "false");
      button.tabIndex = evidence.id === state.selectedEvidenceId ? 0 : -1;
      button.classList.toggle("is-active", evidence.id === state.selectedEvidenceId);
      button.dataset.evidenceKind = evidence.type;
      const step = createElement("span", "evidence-step", index + 1);
      step.setAttribute("aria-hidden", "true");
      const icon = createElement("span", "evidence-tab-icon", evidence.type === "photo" ? "IMG" : evidence.type === "plan" ? "PLN" : "PDF");
      if (evidence.type === "photo" && evidence.path) {
        icon.replaceChildren();
        const thumbnail = document.createElement("img");
        thumbnail.src = evidence.path;
        thumbnail.alt = "";
        icon.append(thumbnail);
      } else if (evidence.type === "plan") {
        icon.replaceChildren();
        const plan = refs["plan-template"].content.cloneNode(true);
        plan.querySelector(".plan-sheet").dataset.requirement = requirement.id;
        icon.append(plan);
      } else if (evidence.type === "document") {
        icon.replaceChildren(createDocumentPreview(requirement, evidence));
      }
      const copy = createElement("span", "");
      copy.append(
        createElement("strong", "", evidence.label),
        createElement("small", "", `${evidence.revision} · ${evidence.verdict}`),
        createElement("em", "", evidence.source)
      );
      button.append(step, icon, copy);
      button.addEventListener("click", () => {
        state.selectedEvidenceId = evidence.id;
        renderSelected();
      });
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === "Home"
          ? 0
          : event.key === "End"
            ? list.length - 1
            : (list.indexOf(evidence) + (event.key === "ArrowRight" ? 1 : -1) + list.length) % list.length;
        state.selectedEvidenceId = list[nextIndex].id;
        renderSelected();
        document.getElementById(`evidence-tab-${list[nextIndex].id}`).focus();
      });
      refs["evidence-tabs"].append(button);
    });
  }

  function createDocumentPreview(requirement, evidence) {
    const sheet = createElement("div", "document-sheet");
    const stamp = createElement("span", `document-stamp${String(evidence.verdict).toLowerCase().includes("expired") ? " is-expired" : ""}`, evidence.verdict);
    sheet.append(stamp, createElement("span", "document-kicker", `SYNTHETIC DEMO RECORD · ${evidence.id.toUpperCase()}`));
    sheet.append(createElement("h3", "", evidence.label));
    sheet.append(createElement("p", "", `Evidence presented for ${requirement.label}. This preview is synthetic and carries no contractual acceptance.`));
    sheet.append(createElement("div", "document-rule"));
    const fields = createElement("div", "document-fields");
    [
      ["Evidence ID", evidence.id],
      ["Revision", evidence.revision],
      ["Source", evidence.source],
      ["Recorded", evidence.captured],
      ["File", evidence.file],
      ["Record fingerprint", evidence.hash],
    ].forEach(([label, value]) => {
      const field = createElement("div", "");
      field.append(createElement("small", "", label), createElement("strong", label === "Record fingerprint" ? "mono" : "", value));
      fields.append(field);
    });
    sheet.append(fields, createElement("div", "document-note", requirement.criterion));
    return sheet;
  }

  function renderEvidence(requirement) {
    const evidence = selectedEvidence(requirement);
    refs["evidence-viewport"].replaceChildren();
    refs["evidence-viewport"].dataset.kind = evidence ? evidence.type : "empty";
    refs["evidence-fallback"].hidden = true;

    if (!evidence) {
      refs["evidence-viewport"].removeAttribute("aria-labelledby");
      refs["evidence-viewport"].setAttribute("aria-label", "No evidence attached");
      const empty = createElement("div", "evidence-fallback");
      empty.append(createElement("span", "", "No evidence attached"), createElement("small", "", "Capture or request the required record before handoff."));
      refs["evidence-viewport"].append(empty);
      refs["evidence-kind"].textContent = "NO RECORD";
      refs["evidence-label"].textContent = "Evidence required";
      refs["evidence-verdict"].textContent = "Missing";
      refs["evidence-source"].textContent = "—";
      refs["evidence-captured"].textContent = "—";
      refs["evidence-revision"].textContent = "—";
      refs["evidence-hash"].textContent = "—";
      return;
    }

    refs["evidence-kind"].textContent = evidence.type === "photo" ? "SYNTHETIC FIELD PHOTO" : evidence.type === "plan" ? "SYNTHETIC PLAN LOCATOR" : "SYNTHETIC DOCUMENT";
    refs["evidence-label"].textContent = evidence.label;
    refs["evidence-viewport"].removeAttribute("aria-label");
    refs["evidence-verdict"].textContent = evidence.verdict;
    refs["evidence-source"].textContent = evidence.source;
    refs["evidence-captured"].textContent = evidence.captured;
    refs["evidence-revision"].textContent = evidence.revision;
    refs["evidence-hash"].textContent = evidence.hash;
    refs["evidence-viewport"].setAttribute("aria-labelledby", `evidence-tab-${evidence.id}`);

    if (evidence.type === "photo") {
      const image = document.createElement("img");
      image.className = "evidence-photo";
      image.src = evidence.path;
      image.alt = `${evidence.label}, synthetic construction evidence for the demo`;
      image.addEventListener("error", () => {
        refs["evidence-viewport"].replaceChildren();
        const fallback = createElement("div", "evidence-fallback");
        fallback.append(createElement("span", "", "Evidence preview unavailable"), createElement("small", "", "The metadata and source record remain available below."));
        refs["evidence-viewport"].append(fallback);
      });
      refs["evidence-viewport"].append(image, createElement("span", "synthetic-label", "Synthetic demo evidence"));
    } else if (evidence.type === "plan") {
      const plan = refs["plan-template"].content.cloneNode(true);
      const planSheet = plan.querySelector(".plan-sheet");
      planSheet.dataset.requirement = requirement.id;
      refs["evidence-viewport"].append(plan);
    } else {
      refs["evidence-viewport"].append(createDocumentPreview(requirement, evidence));
    }
  }

  function checkStateFor(requirement) {
    if (requirement.status === "missing") return [false, false, false];
    if (requirement.status === "stale") return [true, false, false];
    if (requirement.status === "scope_review") return [true, false, false];
    if (requirement.status === "owner_review") return [true, true, Boolean(requirement.acceptance)];
    return [true, true, true];
  }

  function renderRuleChecks(requirement) {
    const labels = requirement.id === "fire-test"
      ? ["Location identifies FD-204", "Current required revision", "Functional verdict passes"]
      : ["Evidence belongs to this item", "Required revision is current", "Acceptance decision is recorded"];
    const checks = checkStateFor(requirement);
    refs["rule-checks"].replaceChildren();
    labels.forEach((label, index) => {
      const item = createElement("li", checks[index] ? "" : "is-unknown");
      item.append(createElement("span", "", checks[index] ? "✓" : "·"), document.createTextNode(label));
      refs["rule-checks"].append(item);
    });
  }

  function renderMatchFacts(requirement) {
    const evidence = selectedEvidence(requirement);
    const checks = checkStateFor(requirement);
    const locationParts = requirement.location.split(" · ");
    refs["match-location"].textContent = locationParts[0] || requirement.location;
    refs["match-identity-label"].textContent = requirement.id === "fire-test" ? "FD-204" : requirement.currentRevision;
    refs["match-identity-copy"].textContent = requirement.label;
    refs["match-revision"].textContent = requirement.currentRevision;
    refs["match-verdict"].textContent = evidence ? evidence.verdict : displayStatus(requirement.status);
    refs["match-verdict-copy"].textContent = checks.every(Boolean)
      ? "All criteria satisfied"
      : requirement.status === "ready"
        ? "Accepted proof on record"
        : "Human review still required";
  }

  function renderWorkflow() {
    const requirement = selectedRequirement();
    const pending = state.pending && state.pending.requirementId === requirement.id ? state.pending : null;
    const steps = Object.fromEntries(Array.from(document.querySelectorAll("[data-workflow-step]"), (step) => [step.dataset.workflowStep, step]));
    Object.values(steps).forEach((step) => step.classList.remove("is-current", "is-complete"));
    steps.evidence.classList.add("is-complete");

    refs["workflow-stage-label"].textContent = pending ? "Agent staged" : requirement.status === "ready" ? "Agent applied" : "Ready to stage";
    refs["workflow-stage-copy"].textContent = pending ? "Exact payload bound" : requirement.status === "ready" ? "Exact match consumed" : mutationPolicyFor(requirement.id) ? "Exact match ready" : "Review recovery path";
    refs["workflow-human-label"].textContent = pending && pending.status === "approved" ? "Human approved" : pending && pending.status === "consumed" ? "Human approved" : "Human approves";
    refs["workflow-human-copy"].textContent = pending && pending.status === "awaiting_human" ? "Decision pending" : pending && pending.status === "approved" ? "Agent apply required" : pending && pending.status === "consumed" ? "Decision recorded" : "Required";
    refs["workflow-applied-copy"].textContent = pending && pending.status === "consumed" ? "Audit recorded" : "Handoff record pending";

    if (pending && pending.status === "consumed") {
      steps.stage.classList.add("is-complete");
      steps.human.classList.add("is-complete");
      steps.applied.classList.add("is-complete", "is-current");
      return;
    }
    if (pending && pending.status === "approved") {
      steps.stage.classList.add("is-complete");
      steps.human.classList.add("is-complete");
      steps.applied.classList.add("is-current");
      return;
    }
    if (pending && pending.status === "awaiting_human") {
      steps.stage.classList.add("is-complete");
      steps.human.classList.add("is-current");
      return;
    }
    steps.stage.classList.add("is-current");
  }

  function renderDecision(requirement) {
    const lane = data.lanes[requirement.lane];
    refs["scope-lane"].textContent = lane.label;
    refs["scope-lane"].className = `lane-badge lane-${requirement.lane}`;
    refs["decision-heading"].textContent = requirement.label;
    refs["decision-summary"].textContent = requirement.summary;
    refs["recommendation-text"].textContent = requirement.recommendation || "This requirement is already supported by accepted evidence. Reopen only if the source record or acceptance basis changes.";
    refs["recommendation-match"].textContent = requirement.status === "ready" ? "Accepted proof" : requirement.status === "missing" ? "Recovery step" : requirement.status === "scope_review" ? "Scope boundary" : "Evidence review";
    refs["owner-initials"].textContent = requirement.ownerInitials;
    refs["owner-name"].textContent = requirement.owner;
    refs["due-date"].textContent = requirement.due;
    renderRuleChecks(requirement);

    const pending = state.pending && state.pending.requirementId === requirement.id ? state.pending : null;
    const mutationPolicy = mutationPolicyFor(requirement.id);
    const canStage = Boolean(mutationPolicy)
      && requirement.status === mutationPolicy.openStatus
      && (!state.pending || ["rejected", "deferred", "consumed"].includes(state.pending.status));
    const blockedStageCopy = {
      owner_review: "Owner inspection required",
      scope_review: "Scope decision required",
      missing: "New evidence required",
      stale: "Current revision required",
    }[requirement.status] || "No safe automated match";
    refs["stage-proposal"].hidden = requirement.status === "ready";
    refs["stage-proposal"].disabled = !canStage;
    refs["stage-proposal"].textContent = canStage ? mutationPolicy.stageLabel : pending ? "Proposal already staged" : blockedStageCopy;
    refs["accept-decision"].disabled = true;
    refs["accept-decision"].textContent = "Accept evidence";
    refs["reject-decision"].disabled = true;
    refs["defer-decision"].disabled = true;
    refs["reopen-decision"].hidden = true;

    if (requirement.status === "ready" && (!pending || pending.status === "consumed")) {
      refs["decision-state"].textContent = "Accepted and applied";
      refs["accept-decision"].textContent = "Accepted";
      refs["decision-helper"].textContent = "The accepted evidence is included in the handoff package. Reopen only if the source or criterion changes.";
      if (pending && pending.status === "consumed") refs["reopen-decision"].hidden = false;
      return;
    }

    if (!pending) {
      refs["decision-state"].textContent = "No proposal staged";
      refs["decision-helper"].textContent = canStage
        ? "Stage the exact evidence match before a person can accept, reject, or defer it."
        : requirement.status === "owner_review"
          ? "The evidence remains routed to the owner. A real inspection decision—not an automated match—is required before acceptance."
          : requirement.status === "scope_review"
            ? "The agent can explain the evidence, but scope ownership must be decided before this item can move toward acceptance."
            : "The agent can explain the blocker, but current evidence is still required before acceptance.";
      return;
    }

    const stateCopy = {
      awaiting_human: ["Awaiting human decision", "Staging changed no project state. Review the exact evidence and criterion before deciding."],
      approved: ["Approved · not yet applied", "The exact proposal is approved. Only the agent apply tool can consume this one-time approval."],
      rejected: ["Rejected · still unresolved", pending.note || "The evidence was rejected and readiness did not change."],
      deferred: ["Deferred · still unresolved", pending.note || "The decision was deferred and readiness did not change."],
      consumed: ["Accepted and applied", "The exact approval was consumed once and cannot be replayed."],
    }[pending.status] || [pending.status, "The proposal remains visible in the audit."];
    refs["decision-state"].textContent = stateCopy[0];
    refs["decision-helper"].textContent = stateCopy[1];
    if (pending.status === "awaiting_human") {
      refs["accept-decision"].disabled = false;
      refs["reject-decision"].disabled = false;
      refs["defer-decision"].disabled = false;
    }
    if (pending.status === "approved") refs["accept-decision"].textContent = "Approved";
    if (pending.status === "consumed") refs["accept-decision"].textContent = "Accepted";
    if (["rejected", "deferred", "consumed"].includes(pending.status)) refs["reopen-decision"].hidden = false;
  }

  function renderSelected() {
    const requirement = selectedRequirement();
    const position = state.requirements.findIndex((item) => item.id === requirement.id) + 1;
    const list = evidenceFor(requirement);
    if (!list.some((item) => item.id === state.selectedEvidenceId)) state.selectedEvidenceId = list[0] ? list[0].id : null;
    refs["item-position"].textContent = `Item ${position} of ${state.requirements.length}`;
    refs["item-location"].textContent = requirement.location;
    refs["evidence-heading"].textContent = requirement.label;
    refs["selected-status"].textContent = displayStatus(requirement.status);
    refs["selected-status"].className = `status-badge status-${requirement.status}`;
    refs["criterion-text"].textContent = requirement.criterion;
    refs["required-revision"].textContent = requirement.requiredRevision;
    refs["current-revision"].textContent = requirement.currentRevision;
    renderEvidenceTabs(requirement);
    renderEvidence(requirement);
    renderMatchFacts(requirement);
    renderDecision(requirement);
    renderWorkflow();
  }

  function handoffPackage() {
    const ready = readyRequirements();
    const exceptions = openRequirements();
    return {
      project: deepClone(data.project),
      status: exceptions.length ? "not_ready_to_issue" : "ready_to_issue",
      readyCount: ready.length,
      exceptionCount: exceptions.length,
      accepted: ready.map((item) => {
        const acceptedEvidenceIds = item.acceptance?.evidenceId
          ? [item.acceptance.evidenceId]
          : deepClone(item.evidenceIds);
        return {
          id: item.id,
          label: item.label,
          owner: item.owner,
          evidenceIds: acceptedEvidenceIds,
          evidenceChainIds: deepClone(item.evidenceIds),
          acceptance: item.acceptance || null,
        };
      }),
      exceptions: exceptions.map((item) => ({ id: item.id, label: item.label, owner: item.owner, due: item.due, status: item.status, lane: item.lane, reason: item.summary, nextAction: item.recommendation || "Resolve the stated acceptance criterion." })),
      audit: deepClone(state.audit),
      validationFixtureFingerprint: validationFixtureFingerprint(),
      projectStateFingerprint: projectStateFingerprint(),
    };
  }

  function renderPackage() {
    const pkg = handoffPackage();
    refs["package-ready-count"].textContent = pkg.readyCount;
    refs["package-exception-count"].textContent = pkg.exceptionCount;
    refs["package-state"].textContent = pkg.exceptionCount ? "Not ready to issue" : "Ready to issue";
    refs["drawer-exception-count"].textContent = pkg.exceptionCount;
    refs["drawer-ready-count"].textContent = pkg.readyCount;
    refs["exception-package"].replaceChildren();
    refs["accepted-package"].replaceChildren();

    pkg.exceptions.forEach((item) => {
      const row = createElement("div", "package-row");
      const mark = createElement("span", `status-${item.status}`, statusSymbol(item.status));
      const copy = createElement("div", "");
      copy.append(createElement("strong", "", item.label), createElement("small", "", `${data.lanes[item.lane].short} · ${item.reason}`));
      row.append(mark, copy, createElement("em", "", `${item.owner}\n${item.due}`));
      refs["exception-package"].append(row);
    });
    pkg.accepted.forEach((item) => {
      const row = createElement("div", "package-row");
      const copy = createElement("div", "");
      copy.append(createElement("strong", "", item.label), createElement("small", "", `${item.evidenceIds.length} accepted evidence ${item.evidenceIds.length === 1 ? "record" : "records"}`));
      row.append(createElement("span", "status-ready", "✓"), copy, createElement("em", "", item.owner));
      refs["accepted-package"].append(row);
    });
  }

  function auditLabel(event) {
    return {
      proposal_staged: "Proposal staged",
      human_approved: "Human approved exact proposal",
      human_rejected: "Human rejected proposal",
      human_deferred: "Human deferred decision",
      approved_change_applied: "Approved change applied",
      human_reopened: "Human reopened item",
    }[event.event] || event.event.replaceAll("_", " ");
  }

  function renderAudit() {
    refs["audit-count"].textContent = state.audit.length;
    refs["audit-empty"].hidden = state.audit.length !== 0;
    refs["audit-timeline"].replaceChildren();
    state.audit.slice().reverse().forEach((event) => {
      const item = createElement("li", "audit-event");
      const initials = String(event.actor).startsWith("Agent") ? "A" : event.actor === "System" ? "S" : "H";
      const actor = createElement("span", "audit-actor", initials);
      const body = createElement("div", "audit-body");
      body.append(createElement("strong", "", auditLabel(event)), createElement("p", "", event.note || `${event.requirementId || "Demo"} state recorded.`));
      const meta = createElement("div", "audit-meta");
      [
        event.actor,
        event.actorRole,
        event.requirementId,
        event.evidenceId,
        event.approvalToken,
        event.payloadDigest ? `${event.payloadDigest.slice(0, 23)}…` : null,
        event.approvalDigest ? `${event.approvalDigest.slice(0, 23)}…` : null,
        event.resultingStateDigest ? `${event.resultingStateDigest.slice(0, 23)}…` : null,
        event.timestamp ? new Date(event.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : null,
      ]
        .filter(Boolean)
        .forEach((value) => meta.append(createElement("span", "", value)));
      body.append(meta);
      item.append(actor, body);
      refs["audit-timeline"].append(item);
    });
  }

  function renderAll() {
    renderSummary();
    renderRequirements();
    renderSelected();
    renderPackage();
    renderAudit();
  }

  function selectRequirement(id) {
    const requirement = getRequirement(id);
    if (!requirement) return;
    state.selectedRequirementId = id;
    state.selectedEvidenceId = requirement.evidenceIds[0] || null;
    renderRequirements();
    renderSelected();
    if (window.matchMedia("(max-width: 1080px)").matches) setMobilePanel("evidence");
  }

  function appendAudit(event) {
    state.audit.push({ timestamp: new Date().toISOString(), ...event });
  }

  function fail(code, message) {
    return { ok: false, error: { code, message }, validationFixtureFingerprint: validationFixtureFingerprint(), projectStateFingerprint: projectStateFingerprint() };
  }

  function approvalTokenGeneration(token) {
    if (typeof token !== "string") return null;
    const match = /^approval-[a-f0-9]{24}-g(\d+)-s\d+$/.exec(token);
    if (!match) return null;
    const generation = Number(match[1]);
    return Number.isSafeInteger(generation) ? generation : null;
  }

  async function stageProposal(input, actor = "Agent") {
    if (!acquireWriteLock()) return fail("OPERATION_IN_PROGRESS", "Another state-changing operation is still running.");
    try {
      const requirement = getRequirement(input && input.requirementId);
      const evidence = getEvidence(input && input.evidenceId);
      if (!requirement) return fail("UNKNOWN_REQUIREMENT", "Unknown closeout requirement.");
      if (!evidence) return fail("UNKNOWN_EVIDENCE", "Unknown evidence record.");
      if (state.pending && !["rejected", "deferred", "consumed"].includes(state.pending.status)) return fail("PROPOSAL_ALREADY_PENDING", "Resolve the visible pending proposal before staging another.");
      const mutationPolicy = mutationPolicyFor(requirement.id);
      if (!mutationPolicy || evidence.id !== mutationPolicy.evidenceId || requirement.status !== mutationPolicy.openStatus) {
        return fail("EVIDENCE_NOT_ELIGIBLE", "Only the documented current FD-204 match and Paint Photo 12 owner-review record are eligible for bounded demo mutations.");
      }
      if (requirement.status === "ready") return fail("REQUIREMENT_ALREADY_READY", "This requirement already has accepted evidence.");
      if (typeof input.reason !== "string" || input.reason.trim().length < 12) return fail("REASON_REQUIRED", "Provide a specific reason of at least 12 characters.");
      if (input.reason.trim().length > 500) return fail("REASON_TOO_LONG", "Keep the reason to 500 characters or fewer.");
      const expectedStateFingerprint = projectStateFingerprint();
      const expectedStateDigest = await projectStateDigest();
      const payload = {
        type: mutationPolicy.payloadType,
        requirementId: requirement.id,
        evidenceId: evidence.id,
        reason: input.reason.trim(),
        expectedStateFingerprint,
        expectedStateDigest,
        criterion: requirement.criterion,
        requiredRevision: requirement.requiredRevision,
        evidenceRevision: evidence.revision,
        evidenceVerdict: evidence.verdict,
        evidenceFingerprint: evidence.hash,
        resultStatus: "ready",
        resultSummary: mutationPolicy.appliedSummary,
        resultEvidenceVerdict: mutationPolicy.appliedEvidenceVerdict,
      };
      const payloadDigest = await sha256(payload);
      state.sequence += 1;
      const token = `approval-${sessionNonce}-g${state.generation}-s${state.sequence}`;
      state.pending = {
        token,
        generation: state.generation,
        status: "awaiting_human",
        requirementId: requirement.id,
        evidenceId: evidence.id,
        payload,
        payloadDigest,
        approvalDigest: null,
        decisionDigest: null,
        note: null,
      };
      appendAudit({
        event: "proposal_staged",
        actor,
        actorRole: actor === "Agent" ? "Site Tool agent" : "Local agent demo control",
        approvalToken: token,
        generation: state.generation,
        requirementId: requirement.id,
        evidenceId: evidence.id,
        payloadDigest,
        payloadSnapshot: deepClone(payload),
        note: "Exact evidence-to-criterion match staged. Project readiness did not change.",
      });
      renderAll();
      return { ok: true, pending: deepClone(state.pending), validationFixtureFingerprint: validationFixtureFingerprint(), projectStateFingerprint: expectedStateFingerprint, projectStateDigest: expectedStateDigest };
    } finally {
      releaseWriteLock();
    }
  }

  async function recordHumanDecision(decision, note = "") {
    if (!acquireWriteLock()) return fail("OPERATION_IN_PROGRESS", "Another state-changing operation is still running.");
    try {
      if (!state.pending) return fail("NO_PENDING_APPROVAL", "There is no visible proposal awaiting a human decision.");
      if (state.pending.status !== "awaiting_human") return fail("DECISION_ALREADY_RECORDED", "This proposal already has a human decision.");
      if (!["approve", "reject", "defer"].includes(decision)) return fail("INVALID_DECISION", "Decision must be approve, reject, or defer.");
      if (["reject", "defer"].includes(decision) && note.trim().length < 12) return fail("DECISION_NOTE_REQUIRED", "Reject and defer decisions require a specific note of at least 12 characters.");
      const actorId = "local-demo-reviewer";
      const decisionDigest = await sha256({
        decision,
        actorId,
        token: state.pending.token,
        generation: state.pending.generation,
        payloadDigest: state.pending.payloadDigest,
        note: decision === "approve" ? "" : note.trim(),
      });
      const approvalDigest = decision === "approve"
        ? await sha256({ decision: "approve", actorId, token: state.pending.token, generation: state.pending.generation, payloadDigest: state.pending.payloadDigest })
        : null;
      state.pending.status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "deferred";
      state.pending.approvalDigest = approvalDigest;
      state.pending.decisionDigest = decisionDigest;
      state.pending.note = decision === "approve" ? "Exact evidence match accepted through the visible local human control." : note.trim();
      appendAudit({
        event: decision === "approve" ? "human_approved" : decision === "reject" ? "human_rejected" : "human_deferred",
        actor: "Local human reviewer",
        actorId,
        actorRole: "Visible local control · identity not authenticated",
        approvalToken: state.pending.token,
        generation: state.pending.generation,
        requirementId: state.pending.requirementId,
        evidenceId: state.pending.evidenceId,
        payloadDigest: state.pending.payloadDigest,
        payloadSnapshot: deepClone(state.pending.payload),
        approvalDigest,
        decisionDigest,
        note: state.pending.note,
      });
      renderAll();
      return { ok: true, pending: deepClone(state.pending), validationFixtureFingerprint: validationFixtureFingerprint(), projectStateFingerprint: projectStateFingerprint(), projectStateDigest: await projectStateDigest() };
    } finally {
      releaseWriteLock();
    }
  }

  async function applyApproved(input, actor = "Agent") {
    if (!acquireWriteLock()) return fail("OPERATION_IN_PROGRESS", "Another state-changing operation is still running.");
    try {
      const token = input && input.token;
      const suppliedGeneration = approvalTokenGeneration(token);
      if (suppliedGeneration !== null && suppliedGeneration !== state.generation) return fail("TOKEN_GENERATION_STALE", "This approval belongs to an earlier reset generation.");
      if (!state.pending) return fail("NO_PENDING_APPROVAL", "No staged proposal exists.");
      if (token !== state.pending.token) return fail("TOKEN_MISMATCH", "The approval token is stale or incorrect.");
      if (state.pending.generation !== state.generation) return fail("TOKEN_GENERATION_STALE", "This approval belongs to an earlier reset generation.");
      if (state.pending.status === "rejected") return fail("PROPOSAL_REJECTED", "A rejected proposal cannot be applied.");
      if (state.pending.status === "deferred") return fail("PROPOSAL_DEFERRED", "A deferred proposal cannot be applied.");
      if (state.pending.status === "consumed") return fail("APPROVAL_CONSUMED", "This approval was already applied.");
      if (state.pending.status !== "approved") return fail("HUMAN_APPROVAL_REQUIRED", "A human must approve the visible proposal before it can be applied.");
      const recalculatedPayloadDigest = await sha256(state.pending.payload);
      const expectedApprovalDigest = await sha256({
        decision: "approve",
        actorId: "local-demo-reviewer",
        token: state.pending.token,
        generation: state.pending.generation,
        payloadDigest: state.pending.payloadDigest,
      });
      if (recalculatedPayloadDigest !== state.pending.payloadDigest || expectedApprovalDigest !== state.pending.approvalDigest) return fail("APPROVED_PAYLOAD_CHANGED", "The proposal or approval binding changed and must be staged again.");
      const requirement = getRequirement(state.pending.requirementId);
      const evidence = getEvidence(state.pending.evidenceId);
      const mutationPolicy = requirement ? mutationPolicyFor(requirement.id) : null;
      if (!requirement || !evidence || requirement.status === "ready") return fail("STATE_CHANGED", "The closeout state changed before apply.");
      if (projectStateFingerprint() !== state.pending.payload.expectedStateFingerprint || await projectStateDigest() !== state.pending.payload.expectedStateDigest) return fail("STATE_CHANGED", "The closeout state changed after staging; review a fresh proposal.");
      if (
        requirement.criterion !== state.pending.payload.criterion
        || requirement.requiredRevision !== state.pending.payload.requiredRevision
        || evidence.revision !== state.pending.payload.evidenceRevision
        || evidence.verdict !== state.pending.payload.evidenceVerdict
        || evidence.hash !== state.pending.payload.evidenceFingerprint
        || !mutationPolicy
        || evidence.id !== mutationPolicy.evidenceId
        || requirement.status !== mutationPolicy.openStatus
        || state.pending.payload.type !== mutationPolicy.payloadType
        || state.pending.payload.resultStatus !== "ready"
        || state.pending.payload.resultSummary !== mutationPolicy.appliedSummary
        || state.pending.payload.resultEvidenceVerdict !== mutationPolicy.appliedEvidenceVerdict
      ) return fail("APPROVED_PAYLOAD_CHANGED", "The acceptance basis changed after approval and must be reviewed again.");
      requirement.status = "ready";
      requirement.summary = mutationPolicy.appliedSummary;
      requirement.acceptance = { actor: "Local human reviewer", actorId: "local-demo-reviewer", identityAssurance: "visible-local-control", evidenceId: evidence.id, reason: state.pending.payload.reason };
      evidence.linked = true;
      evidence.verdict = mutationPolicy.appliedEvidenceVerdict;
      state.pending.status = "consumed";
      const resultingStateFingerprint = projectStateFingerprint();
      const resultingStateDigest = await projectStateDigest();
      appendAudit({
        event: "approved_change_applied",
        actor,
        actorRole: "Site Tool agent",
        approvalToken: state.pending.token,
        generation: state.pending.generation,
        requirementId: requirement.id,
        evidenceId: evidence.id,
        payloadDigest: state.pending.payloadDigest,
        payloadSnapshot: deepClone(state.pending.payload),
        approvalDigest: state.pending.approvalDigest,
        resultingStateFingerprint,
        resultingStateDigest,
        note: "Only the exact approved evidence match was applied once.",
      });
      renderAll();
      return {
        ok: true,
        requirement: deepClone(requirement),
        pending: deepClone(state.pending),
        ready: readyRequirements().length,
        total: state.requirements.length,
        exceptionCount: openRequirements().length,
        validationFixtureFingerprint: validationFixtureFingerprint(),
        projectStateFingerprint: resultingStateFingerprint,
        projectStateDigest: resultingStateDigest,
      };
    } finally {
      releaseWriteLock();
    }
  }

  async function reopenDecision() {
    if (!acquireWriteLock()) return fail("OPERATION_IN_PROGRESS", "Another state-changing operation is still running.");
    try {
      if (!state.pending || !["rejected", "deferred", "consumed"].includes(state.pending.status)) return fail("NOT_REOPENABLE", "No resolved decision is available to reopen.");
      const prior = deepClone(state.pending);
      const requirement = getRequirement(prior.requirementId);
      const evidence = getEvidence(prior.evidenceId);
      if (prior.status === "consumed" && requirement && evidence) {
        const originalRequirement = initialRequirements.find((item) => item.id === requirement.id);
        const originalEvidence = initialEvidence.find((item) => item.id === evidence.id);
        requirement.status = originalRequirement.status;
        requirement.summary = originalRequirement.summary;
        delete requirement.acceptance;
        if (Object.hasOwn(originalEvidence, "linked")) evidence.linked = originalEvidence.linked;
        else delete evidence.linked;
        evidence.verdict = originalEvidence.verdict;
      }
      const resultingStateFingerprint = projectStateFingerprint();
      const resultingStateDigest = await projectStateDigest();
      appendAudit({
        event: "human_reopened",
        actor: "Local human reviewer",
        actorId: "local-demo-reviewer",
        actorRole: "Visible local control · identity not authenticated",
        approvalToken: prior.token,
        generation: prior.generation,
        requirementId: prior.requirementId,
        evidenceId: prior.evidenceId,
        payloadDigest: prior.payloadDigest,
        payloadSnapshot: deepClone(prior.payload),
        approvalDigest: prior.approvalDigest,
        resultingStateFingerprint,
        resultingStateDigest,
        note: "The prior decision remains in the audit; the requirement is open for a new exact review.",
      });
      state.pending = null;
      renderAll();
      return { ok: true, validationFixtureFingerprint: validationFixtureFingerprint(), projectStateFingerprint: resultingStateFingerprint, projectStateDigest: resultingStateDigest };
    } finally {
      releaseWriteLock();
    }
  }

  async function resetDemo(actor = "System") {
    if (!acquireWriteLock()) return fail("OPERATION_IN_PROGRESS", "Another state-changing operation is still running.");
    try {
      const priorGeneration = state.generation;
      state.requirements = deepClone(initialRequirements);
      state.evidence = deepClone(initialEvidence);
      state.pending = null;
      state.sequence = 0;
      state.generation += 1;
      state.audit = [];
      state.selectedRequirementId = "fire-test";
      state.selectedEvidenceId = "ev-fire-photo";
      state.filter = "all";
      closeDrawer(false);
      closeDecisionDialog(false);
      lastFocus = null;
      setMobilePanel("evidence");
      refs["evidence-viewport"].classList.remove("is-expanded");
      refs["zoom-toggle"].setAttribute("aria-label", "Expand evidence");
      refs["decision-note"].value = "";
      refs["decision-note"].setAttribute("aria-invalid", "false");
      refs["decision-note-error"].hidden = true;
      document.querySelectorAll("[data-filter]").forEach((button) => {
        const selected = button.dataset.filter === "all";
        button.classList.toggle("is-active", selected);
        button.setAttribute("aria-selected", selected ? "true" : "false");
        button.tabIndex = selected ? 0 : -1;
      });
      refs["requirement-list"].setAttribute("aria-labelledby", "filter-all");
      renderAll();
      return {
        ok: true,
        actor,
        priorGeneration,
        generation: state.generation,
        validationFixtureFingerprint: VALIDATION_SEED_HASH,
        ready: readyRequirements().length,
        total: state.requirements.length,
        pending: null,
        audit: [],
        projectStateFingerprint: projectStateFingerprint(),
        projectStateDigest: await projectStateDigest(),
      };
    } finally {
      releaseWriteLock();
    }
  }

  function evidenceSummary(evidence) {
    return {
      id: evidence.id,
      requirementId: evidence.requirementId,
      type: evidence.type,
      label: evidence.label,
      source: evidence.source,
      captured: evidence.captured,
      revision: evidence.revision,
      verdict: evidence.verdict,
      file: evidence.file,
      fingerprint: evidence.hash,
      linked: Boolean(evidence.linked),
    };
  }

  function requirementSnapshot(item) {
    return {
      id: item.id,
      label: item.label,
      owner: item.owner,
      due: item.due,
      status: item.status,
      lane: item.lane,
      laneLabel: data.lanes[item.lane].label,
      location: item.location,
      reason: item.summary,
      criterion: item.criterion,
      requiredRevision: item.requiredRevision,
      currentRevision: item.currentRevision,
      evidenceIds: deepClone(item.evidenceIds),
      evidence: evidenceFor(item).map(evidenceSummary),
      acceptance: item.acceptance ? deepClone(item.acceptance) : null,
    };
  }

  function blockerRows() {
    return openRequirements().map(requirementSnapshot);
  }

  function recoveryPlan() {
    return [
      { order: 1, itemId: "fire-test", action: "Match the current passing FD-204 evidence, then request an exact visible human decision." },
      { order: 2, itemId: "warranty", action: "Request kitchen warranty Rev 2; exclude expired Rev 1 from handoff." },
      { order: 3, itemId: "ceiling-repair", action: "Keep grid C4 in the possible-change lane until scope ownership is decided." },
      { order: 4, itemId: "training", action: "Complete controls training and capture signed attendance." },
      { order: 5, itemId: "paint", action: "Route Photo 12 to the owner for accept, reject, defer, or reopen." },
    ];
  }

  function showToast(title, copy, isError = false) {
    const toast = createElement("div", `toast${isError ? " is-error" : ""}`);
    toast.append(createElement("strong", "", title), createElement("span", "", copy));
    refs["toast-region"].append(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    window.setTimeout(() => {
      toast.classList.remove("is-visible");
      window.setTimeout(() => toast.remove(), 220);
    }, 3600);
  }

  let lastFocus = null;
  function openDrawer(name) {
    closeDrawer(false);
    const drawer = name === "audit" ? refs["audit-drawer"] : refs["handoff-drawer"];
    lastFocus = document.activeElement;
    state.activeDrawer = name;
    refs["app-shell"].inert = true;
    refs["drawer-backdrop"].hidden = false;
    drawer.inert = false;
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    drawer.querySelector("[data-close-drawer]").focus();
  }

  function closeDrawer(returnFocus = true) {
    [refs["handoff-drawer"], refs["audit-drawer"]].forEach((drawer) => {
      drawer.classList.remove("is-open");
      drawer.setAttribute("aria-hidden", "true");
      drawer.inert = true;
    });
    refs["drawer-backdrop"].hidden = true;
    refs["app-shell"].inert = false;
    state.activeDrawer = null;
    if (returnFocus && lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  function setMobilePanel(panel) {
    state.mobilePanel = panel;
    refs["app-shell"].dataset.mobilePanel = panel;
    document.querySelectorAll("[data-mobile-panel]").forEach((button) => {
      const selected = button.dataset.mobilePanel === panel;
      button.classList.toggle("is-active", selected);
      if (button.closest(".mobile-workspace-nav")) button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  }

  function openDecisionDialog(mode) {
    state.dialogMode = mode;
    lastFocus = document.activeElement;
    refs["dialog-eyebrow"].textContent = mode === "reject" ? "Record exact rejection" : "Record deferral";
    refs["dialog-heading"].textContent = `${mode === "reject" ? "Reject" : "Defer"} ${selectedRequirement().label.toLowerCase()}`;
    refs["dialog-copy"].textContent = mode === "reject"
      ? "Explain why the evidence does not satisfy the criterion. The item will remain unresolved."
      : "Name the missing decision, owner, or event. Deferral does not change readiness.";
    refs["decision-note"].placeholder = mode === "reject" ? "State the evidence or criterion issue…" : "State what must happen before review resumes…";
    refs["dialog-confirm"].textContent = mode === "reject" ? "Record rejection" : "Record deferral";
    refs["dialog-confirm"].className = `button ${mode === "reject" ? "button-oxide" : "button-ink"}`;
    refs["decision-note"].value = "";
    refs["decision-note"].setAttribute("aria-invalid", "false");
    refs["decision-note-error"].hidden = true;
    refs["app-shell"].inert = true;
    refs["dialog-backdrop"].hidden = false;
    refs["decision-dialog"].inert = false;
    refs["decision-dialog"].classList.add("is-open");
    refs["decision-dialog"].setAttribute("aria-hidden", "false");
    refs["decision-note"].focus();
  }

  function closeDecisionDialog(returnFocus = true) {
    refs["decision-dialog"].classList.remove("is-open");
    refs["decision-dialog"].setAttribute("aria-hidden", "true");
    refs["decision-dialog"].inert = true;
    refs["dialog-backdrop"].hidden = true;
    refs["app-shell"].inert = false;
    state.dialogMode = null;
    if (returnFocus && lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  const filterButtons = ["filter-all", "filter-exceptions", "filter-ready"].map((id) => document.getElementById(id));
  function activateFilter(button, moveFocus = false) {
    state.filter = button.dataset.filter;
    filterButtons.forEach((item) => {
      const selected = item === button;
      item.classList.toggle("is-active", selected);
      if (item.getAttribute("role") === "tab") {
        item.setAttribute("aria-selected", selected ? "true" : "false");
        item.tabIndex = selected ? 0 : -1;
      } else {
        item.setAttribute("aria-pressed", selected ? "true" : "false");
      }
    });
    refs["requirement-list"].setAttribute("aria-labelledby", button.id);
    renderRequirements();
    if (moveFocus) button.focus();
  }

  filterButtons.forEach((button, index) => {
    button.addEventListener("click", () => activateFilter(button));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? filterButtons.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + filterButtons.length) % filterButtons.length;
      activateFilter(filterButtons[nextIndex], true);
    });
  });

  document.querySelectorAll("[data-mobile-panel]").forEach((button) => button.addEventListener("click", () => setMobilePanel(button.dataset.mobilePanel)));
  document.querySelectorAll("[data-open-drawer]").forEach((button) => button.addEventListener("click", () => openDrawer(button.dataset.openDrawer)));
  document.querySelectorAll("[data-close-drawer]").forEach((button) => button.addEventListener("click", () => closeDrawer()));
  refs["drawer-backdrop"].addEventListener("click", () => closeDrawer());
  refs["dialog-backdrop"].addEventListener("click", closeDecisionDialog);
  refs["dialog-cancel"].addEventListener("click", closeDecisionDialog);

  refs["stage-proposal"].addEventListener("click", async () => {
    const requirement = selectedRequirement();
    const mutationPolicy = mutationPolicyFor(requirement.id);
    const result = mutationPolicy
      ? await stageProposal({ requirementId: requirement.id, evidenceId: mutationPolicy.evidenceId, reason: mutationPolicy.defaultReason }, "Agent demo control")
      : fail("EVIDENCE_NOT_ELIGIBLE", "This item does not have a bounded demo mutation.");
    showToast(result.ok ? "Proposal staged" : result.error.code, result.ok ? "Readiness remains unchanged until a person approves and the agent applies." : result.error.message, !result.ok);
  });
  refs["accept-decision"].addEventListener("click", async () => {
    const result = await recordHumanDecision("approve");
    showToast(result.ok ? "Exact proposal approved" : result.error.code, result.ok ? "Approval is recorded; the agent must still apply this exact token." : result.error.message, !result.ok);
  });
  refs["reject-decision"].addEventListener("click", () => openDecisionDialog("reject"));
  refs["defer-decision"].addEventListener("click", () => openDecisionDialog("defer"));
  refs["reopen-decision"].addEventListener("click", async () => {
    const result = await reopenDecision();
    showToast(result.ok ? "Decision reopened" : result.error.code, result.ok ? "Prior events remain in the audit; readiness now reflects the open item." : result.error.message, !result.ok);
  });
  refs["dialog-confirm"].addEventListener("click", async () => {
    const note = refs["decision-note"].value.trim();
    if (note.length < 12) {
      refs["decision-note-error"].hidden = false;
      refs["decision-note"].setAttribute("aria-invalid", "true");
      refs["decision-note"].focus();
      return;
    }
    refs["decision-note"].setAttribute("aria-invalid", "false");
    const result = await recordHumanDecision(state.dialogMode, note);
    if (result.ok) {
      const mode = state.dialogMode;
      closeDecisionDialog();
      showToast(mode === "reject" ? "Proposal rejected" : "Decision deferred", "Readiness did not change; the exact reason is in the audit.");
    }
  });
  refs["decision-note"].addEventListener("input", () => {
    if (refs["decision-note"].value.trim().length < 12) return;
    refs["decision-note-error"].hidden = true;
    refs["decision-note"].setAttribute("aria-invalid", "false");
  });

  refs["zoom-toggle"].addEventListener("click", () => {
    const expanded = refs["evidence-viewport"].classList.toggle("is-expanded");
    refs["zoom-toggle"].setAttribute("aria-label", expanded ? "Close expanded evidence" : "Expand evidence");
  });

  document.addEventListener("keydown", (event) => {
    const activeSurface = refs["decision-dialog"].classList.contains("is-open")
      ? refs["decision-dialog"]
      : state.activeDrawer === "audit"
        ? refs["audit-drawer"]
        : state.activeDrawer === "handoff"
          ? refs["handoff-drawer"]
          : null;
    if (event.key === "Tab" && activeSurface) {
      const focusable = Array.from(activeSurface.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter((node) => !node.hidden && node.getAttribute("aria-hidden") !== "true");
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      return;
    }
    if (event.key !== "Escape") return;
    if (refs["decision-dialog"].classList.contains("is-open")) closeDecisionDialog();
    else if (state.activeDrawer) closeDrawer();
    else if (refs["evidence-viewport"].classList.contains("is-expanded")) {
      refs["evidence-viewport"].classList.remove("is-expanded");
      refs["zoom-toggle"].setAttribute("aria-label", "Expand evidence");
      refs["zoom-toggle"].focus();
    }
  });

  function toolDefinitions() {
    const emptySchema = { type: "object", properties: {}, additionalProperties: false };
    const requirementSchema = { type: "object", required: ["requirementId"], properties: { requirementId: { type: "string", minLength: 1, maxLength: 80, description: "Exact closeout requirement ID." } }, additionalProperties: false };
    const readAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
    const writeAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false };
    return [
      {
        name: "closeout_read_state",
        description: "Read all 14 Unit 204 requirements with exact status, owner, criterion, revision, evidence metadata, link state, deterministic fixture fingerprint, and SHA-256 project-state digest.",
        inputSchema: emptySchema,
        annotations: { ...readAnnotations },
        execute: async () => ({
          ok: true,
          project: deepClone(data.project),
          ready: readyRequirements().length,
          total: state.requirements.length,
          requirements: state.requirements.map(requirementSnapshot),
          exceptions: blockerRows(),
          pending: state.pending ? deepClone(state.pending) : null,
          generation: state.generation,
          validationFixtureFingerprint: validationFixtureFingerprint(),
          projectStateFingerprint: projectStateFingerprint(),
          projectStateDigest: await projectStateDigest(),
        }),
      },
      {
        name: "closeout_read_requirement_detail",
        description: "Read one requirement's acceptance criterion, revision, scope lane, owner, evidence metadata, and current decision state.",
        inputSchema: requirementSchema,
        annotations: { ...readAnnotations },
        execute: async ({ requirementId }) => {
          const requirement = getRequirement(requirementId);
          return requirement ? { ok: true, requirement: requirementSnapshot(requirement), lane: deepClone(data.lanes[requirement.lane]), pending: state.pending && state.pending.requirementId === requirementId ? deepClone(state.pending) : null, projectStateDigest: await projectStateDigest() } : fail("UNKNOWN_REQUIREMENT", "Unknown closeout requirement.");
        },
      },
      {
        name: "closeout_identify_blockers",
        description: "Identify every unresolved Unit 204 closeout item with its exact evidence, revision, owner, due date, and scope reason.",
        inputSchema: emptySchema,
        annotations: { ...readAnnotations },
        execute: async () => ({ ok: true, count: openRequirements().length, blockers: blockerRows(), projectStateDigest: await projectStateDigest() }),
      },
      {
        name: "closeout_propose_plan",
        description: "Prepare a bounded recovery sequence without accepting work, deciding scope ownership, sending requests, or changing readiness.",
        inputSchema: emptySchema,
        annotations: { ...readAnnotations },
        execute: async () => ({ ok: true, steps: recoveryPlan() }),
      },
      {
        name: "closeout_pending_approval",
        description: "Read the exact staged payload, SHA-256 payload and approval digests, reset generation, decision state, and never-reused token visible to the human.",
        inputSchema: emptySchema,
        annotations: { ...readAnnotations },
        execute: async () => ({ ok: true, pending: state.pending ? deepClone(state.pending) : null }),
      },
      {
        name: "closeout_read_audit_log",
        description: "Read the append-only events for the current synthetic generation, including actors, identity assurance, tokens, payload snapshots, SHA-256 digests, decisions, applications, and reopens.",
        inputSchema: emptySchema,
        annotations: { ...readAnnotations },
        execute: async () => ({ ok: true, count: state.audit.length, audit: deepClone(state.audit) }),
      },
      {
        name: "closeout_stage_change",
        description: "Stage an exact eligible fire-test match or paint owner-review record for visible human review. This cannot approve or apply it.",
        inputSchema: { type: "object", required: ["requirementId", "evidenceId", "reason"], properties: { requirementId: { type: "string", minLength: 1, maxLength: 80 }, evidenceId: { type: "string", minLength: 1, maxLength: 80 }, reason: { type: "string", minLength: 12, maxLength: 500 } }, additionalProperties: false },
        annotations: { ...writeAnnotations },
        execute: async (input) => await stageProposal(input, "Agent"),
      },
      {
        name: "closeout_apply_approved_change",
        description: "Apply only the exact staged payload after a human approved that same payload and one-time token.",
        inputSchema: { type: "object", required: ["token"], properties: { token: { type: "string", minLength: 1, maxLength: 64 } }, additionalProperties: false },
        annotations: { ...writeAnnotations },
        execute: async (input) => await applyApproved(input, "Agent"),
      },
      {
        name: "closeout_preview_handoff_package",
        description: "Preview accepted evidence and every unresolved exception, owner, date, reason, and audit event without claiming false completion.",
        inputSchema: emptySchema,
        annotations: { ...readAnnotations },
        execute: async () => ({ ok: true, package: { ...handoffPackage(), projectStateDigest: await projectStateDigest() } }),
      },
      {
        name: "closeout_reset_demo",
        description: "Reset only this synthetic demo to its documented 9-of-14 seed state. Never use on real project data.",
        inputSchema: emptySchema,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false },
        execute: async () => await resetDemo("Agent"),
      },
    ];
  }

  async function registerTools() {
    const registration = refs["tool-registration"];
    const copy = refs["tool-registration-copy"];
    const tools = toolDefinitions();
    if (!document.modelContext || typeof document.modelContext.registerTool !== "function") {
      registration.dataset.state = "preview";
      copy.textContent = "Preview mode · open in ChatGPT to register 10 tools";
      window.__closeoutApp.registration = "unavailable";
      return;
    }
    const registered = [];
    try {
      for (const tool of tools) {
        await document.modelContext.registerTool(tool);
        registered.push(tool.name);
        window.__closeoutApp.registeredTools = [...registered];
      }
      registration.dataset.state = "resolved";
      copy.textContent = "10 registered · 7 read / 3 write";
      window.__closeoutApp.registration = "resolved";
      window.__closeoutApp.registeredTools = tools.map((tool) => tool.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const partial = registered.length > 0;
      registration.dataset.state = partial ? "partial" : "rejected";
      copy.textContent = `Registration stopped after ${registered.length}/10 · ${message}`;
      window.__closeoutApp.registration = partial ? "partial" : "rejected";
      window.__closeoutApp.registeredTools = [...registered];
      window.__closeoutApp.error = message;
    }
  }

  window.__closeoutApp = {
    registration: "pending",
    registeredTools: [],
    getState: () => deepClone({ requirements: state.requirements, evidence: state.evidence, pending: state.pending, audit: state.audit, generation: state.generation, validationFixtureFingerprint: validationFixtureFingerprint(), projectStateFingerprint: projectStateFingerprint() }),
  };

  renderAll();
  await registerTools();
})();
