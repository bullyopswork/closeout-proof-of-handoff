# Closeout: Proof of Handoff

**An evidence-first WebMCP construction closeout demo where an agent can
reconcile records and stage one of two exact eligible resolutions, while a
person accepts, rejects, defers, or reopens that staged decision in the visible
UI.**

This repository is a candidate entry for the OpenAI WebMCP Challenge. It uses
one synthetic Unit 204 closeout package to demonstrate a narrow human-agent
workflow on the same live page:

1. Read the exact 14-item closeout state and five unresolved exceptions.
2. Reconcile visual evidence to an explicit criterion and revision.
3. Stage one bounded proposal without changing readiness.
4. Require a separate visible human decision.
5. Apply only the exact approved payload once.
6. Keep every unresolved exception visible in the handoff preview.

The demo contains no real project, customer, contractor, or owner data.

## Why WebMCP matters here

Ordinary browser automation can click controls, but it does not give the agent
a trustworthy domain contract for requirements, revisions, evidence links,
scope lanes, approval state, or audit output. Site Tools expose those exact
operations while the person continues to inspect the normal construction UI.

The page registers ten top-level imperative Site Tools sequentially and awaits
each registration, following the current [official OpenAI Site Tools
documentation](https://learn.chatgpt.com/docs/webmcp).

| Site Tool | Type | Purpose |
|---|---|---|
| `closeout_read_state` | Read | Return all requirements, evidence, exceptions, generation, and state proofs. |
| `closeout_read_requirement_detail` | Read | Inspect one criterion, revision, scope lane, owner, and evidence chain. |
| `closeout_identify_blockers` | Read | List every unresolved handoff item and its exact reason. |
| `closeout_propose_plan` | Read | Produce a bounded recovery sequence without changing state. |
| `closeout_pending_approval` | Read | Read the exact staged payload, decision state, digests, and token. |
| `closeout_read_audit_log` | Read | Read actor, payload, decision, application, and reopen events. |
| `closeout_stage_change` | Write | Stage the eligible FD-204 match or Paint Photo 12 owner review; cannot approve or apply either. |
| `closeout_apply_approved_change` | Write | Consume one exact human-approved payload and token once. |
| `closeout_preview_handoff_package` | Read | Preview accepted proof plus every unresolved exception. |
| `closeout_reset_demo` | Destructive write | Reset only this synthetic page generation to the documented seed. |

## Safety model

- **Human decisions stay in the visible page.** No Site Tool can approve,
  reject, defer, or reopen on a person's behalf.
- **Two distinct lanes are real.** The same guarded stage/decision/apply
  contract supports the technical FD-204 evidence match and the separate Paint
  Photo 12 owner-acceptance review; the demo applies only one proposal at a
  time.
- **Stage is non-mutating.** It records a proposal and audit event but does not
  change the 9-of-14 readiness state.
- **Apply is exact and one-time.** Generation, random page nonce, token,
  criterion, revisions, evidence fingerprint, payload digest, approval digest,
  and expected project state must all match.
- **Reset invalidates old generations.** An earlier token receives
  `TOKEN_GENERATION_STALE`; concurrent writes fail closed behind a page-local
  write lock.
- **No open-world side effects.** The app has no network calls, login, database,
  messaging, payment, export, or real construction-system integration.
- **No false completion.** The handoff package remains `not_ready_to_issue`
  while any exception is open.

## Run locally

Requirements: Python 3 and a current desktop browser.

```text
npm run serve
```

Open `http://127.0.0.1:4173/app/`. An ordinary browser shows preview mode.
Supported Site Tools appear only in a compatible agent browser; the current
OpenAI documentation specifies the latest ChatGPT desktop app with GPT-5.6 Sol
or GPT-5.6 Terra.

## Run the production regression suite

```text
npm ci
npx playwright install chromium
npm test
```

If a compatible Chrome binary is already installed, set `CHROME_PATH` to its
executable and the Playwright browser download is unnecessary. On macOS the
suite automatically uses `/Applications/Google Chrome.app` when present, with
a fresh isolated profile—not the user's browser profile.

The suite mocks only the browser's `registerTool` transport. It executes the
real registered production handlers and visible human controls. Coverage
includes registration/output contracts, ten consecutive complete secure
flows, concurrent reset/apply locking, cross-generation replay rejection,
reject/defer/reopen states, keyboard behavior, and untrusted input.

## Verified HTTPS deployment

The app is deployed at
[`https://closeout-proof-of-handoff.vercel.app/`](https://closeout-proof-of-handoff.vercel.app/).
`vercel.json` defines the redirect from `/` to `/app/`, restrictive response
headers, cross-origin frame denial, and origin isolation. `.vercelignore` keeps
internal proof captures, frozen controls, submission drafts, tests, and
project-management files out of the deployed site.

This tree adds the frame-denial headers. Canonical header and iframe-refusal
proof must be repeated after every deployment; the latest verified release
status is recorded separately from the source package.

## Repository layout

- `app/` — production HTML, CSS, data, and Site Tool implementation
- `assets/evidence/` — original synthetic construction evidence images and
  their provenance/hash note
- `tests/` — isolated browser regression suite
- `submission/` — local submission copy and timed demo script
- `vercel.json` — verified static HTTPS deployment configuration

Internal validation controls, screenshots, and mutable project checkpoints are
intentionally excluded from the public-repo candidate by `.gitignore`.

## Current verification boundary

Production discovery and the bounded read → stage → human approve → apply once
→ replay reject → audit → handoff flow were proven on the canonical HTTPS
origin in ChatGPT desktop build 7303 with Sources evidence. A fresh live reset
restored the exact 9/14 seed, advanced the generation, and rejected the stale
token. An isolated Chrome WebMCP lane independently discovered all ten tools
and invoked both read tools. The locked local dependency graph passes ten
consecutive complete flows.

The public source repository is
[`bullyopswork/closeout-proof-of-handoff`](https://github.com/bullyopswork/closeout-proof-of-handoff).
The final 2:34 demo is public and independently verified at
[`https://youtu.be/juAD0BmmExc`](https://youtu.be/juAD0BmmExc). The final
Devpost challenge submission remains a separate approval gate.

## License

[MIT](LICENSE)
