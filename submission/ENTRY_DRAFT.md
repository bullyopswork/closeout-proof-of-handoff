# Submission draft — Closeout: Proof of Handoff

Status: local draft only. Replace every bracketed field and remove the release
notes only after the corresponding proof gate passes.

## Project details

- **Name:** Closeout: Proof of Handoff
- **Tagline:** The agent reconciles construction evidence; the human decides
  what is accepted before readiness changes.
- **Live app:** `[PENDING DEPLOYED HTTPS URL]`
- **Public repository:** `https://github.com/bullyopswork/closeout-proof-of-handoff`
- **Public demo video:** `[PENDING PUBLIC YOUTUBE URL]`
- **License:** MIT

## Twenty-second explanation

Unit 204 cannot hand over yet: the latest fire-safety test is present but
unlinked, a warranty is stale, and one repair may be outside the original
scope. The agent reconciles exact evidence and criteria through WebMCP; the
human accepts, rejects, defers, or reopens an exact staged review before
readiness changes. The guarded contract supports both the technical FD-204
evidence match and a separate Paint Photo 12 owner-acceptance review. The other
exceptions remain explicitly routed for new evidence or a scope decision.

## Inspiration

Construction closeout often fails at the last mile. The work may look finished
while the proof needed for handoff is missing, stale, attached to the wrong
revision, waiting on an owner decision, or mixed with a possible change order.
A generic checklist hides those distinctions. Closeout turns them into one
visible evidence-to-criterion workflow.

## What it does

The demo opens one synthetic Unit 204 package at 9 of 14 requirements ready.
Five exceptions represent different closeout failure modes:

1. A current passing fire-damper test exists but is not linked.
2. A kitchen warranty is one revision behind and expired.
3. A ceiling repair may belong to a possible change order.
4. The owner controls-training record is missing.
5. Paint touch-up evidence still awaits owner acceptance.

ChatGPT can use seven read Site Tools to inspect the structured state,
criteria, revisions, evidence chain, blockers, recovery plan, pending decision,
audit, and handoff result. It can use two bounded write tools to stage the one
eligible FD-204 match or Paint Photo 12 owner-review record and apply it only
after the same payload is approved through the visible human-only page control.
A third destructive tool resets only the synthetic in-memory demo for judging.

The successful path moves readiness from 9/14 to 10/14, records the exact
actor/payload/decision/application chain, rejects replay of the consumed token,
and keeps the handoff package at `not_ready_to_issue` with four explicit
exceptions.

## Why WebMCP improves the experience

Without WebMCP, an agent would have to infer meaning from cards and click a UI
that was designed for people. The page instead provides narrow domain
contracts for requirements, evidence, revisions, scope lanes, approval state,
and audit results. The agent and person operate the same live page and can both
verify the visible outcome.

This is not a button-replacement demo. The useful collaboration depends on the
split between structured agent operations and human judgment:

- The agent may inspect, reconcile, explain, and stage.
- A person alone may accept, reject with a reason, defer, or reopen.
- The agent may apply only the exact approved payload once.
- Neither side can silently convert unresolved exceptions into completion.

## How it was built

- Dependency-light HTML, CSS, and JavaScript with an evidence-centered
  responsive construction UI.
- Ten top-level imperative Site Tools registered sequentially with awaited
  `document.modelContext.registerTool` calls.
- Narrow JSON input schemas and accurate read/write/destructive annotations.
- SHA-256 project-state, payload, approval, decision, and result digests.
- Generation-bound one-time approval tokens with a random per-page nonce.
- Exact criterion, revision, evidence fingerprint, payload, approval, and
  expected-state checks before mutation.
- A visible actor audit and exception-aware handoff preview.
- Restrictive CSP, no network sinks, safe DOM construction, and entirely
  synthetic local data and imagery.
- A Playwright regression harness that captures the real registered handlers
  and exercises visible human controls.

## Challenges

The first internal prototype discovered Site Tools but did not reliably invoke
them because registration was not awaited and the test procedure reused stale
session state. We isolated the problem with an official OpenAI control and a
one-tool awaited local control, then registered the production tools
sequentially and tested in a fresh supported ChatGPT session.

The harder design problem was preventing “approval” from becoming a decorative
button. The final workflow binds the exact criterion, revisions, evidence,
state, payload, person-visible decision, token, and generation. Reset and replay
paths fail closed, and the handoff package never claims that unresolved work is
complete.

## Accomplishments

- Genuine production Site Tool discovery and invocation in ChatGPT desktop
  build 7303 with Recently Used/Sources evidence.
- A complete read → stage without mutation → preapproval block → visible human
  approval → exact apply once → replay rejection → audit → handoff flow.
- A second owner-acceptance flow for Paint Photo 12 that applies only after the
  visible decision and reopens back to the exact unresolved seed state.
- Ten consecutive complete automated production flows with zero unauthorized
  mutations, plus concurrent reset/apply, cross-generation replay, decision,
  keyboard, and untrusted-input coverage.
- A polished desktop/mobile evidence workspace that is separate from the
  frozen internal validation prototype.

## What we learned

WebMCP is strongest when the page offers a domain contract instead of a second
copy of its buttons. The agent needs structured operations and enough result
data to verify the effect; the person needs the same state rendered clearly,
with consequential judgment kept in the ordinary interface.

## What is next

A production version would integrate authenticated project records and durable
storage while keeping the same evidence, scope, approval, audit, and exception
boundaries. This challenge entry intentionally avoids external systems and real
project data so the judge path remains deterministic and safe.

## Built with

WebMCP / OpenAI Site Tools, HTML, CSS, JavaScript, Web Crypto, Playwright, and
original synthetic evidence imagery.

## Release notes to remove before submission

- `[PENDING]` Deployed HTTPS ChatGPT and Chrome WebMCP compatibility proof.
- `[PENDING]` Public repository, public YouTube video, and final Devpost fields.
