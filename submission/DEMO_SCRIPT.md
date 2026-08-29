# Production demo script — target 2:44

Status: local script only. The live reset/cross-generation proof exists in the
internal proof packet, but the public demo stays focused on the main workflow.
Record with narration and keep the exported video below 2:50, leaving ten
seconds under the official three-minute maximum.

| Time | Screen and action | Narration |
|---|---|---|
| 0:00–0:15 | Open the full desktop workspace at `9/14 ready`. | “A project can look finished and still be impossible to hand over. Unit 204 has five different proof failures hiding behind the last five requirements.” |
| 0:15–0:35 | Scan the evidence viewer, exact criterion, revision fields, and three scope lanes. | “Closeout separates original-scope deficiencies, owner acceptance, and possible change orders. The agent can explain these records, but it cannot decide scope or acceptance.” |
| 0:35–0:58 | Ask: “Read Unit 204 and identify every blocker. Do not change anything.” Show `closeout_read_state` and `closeout_identify_blockers` under Sources. | “WebMCP gives ChatGPT exact requirements, owners, revisions, evidence, and state proofs instead of making it scrape cards. The five blockers remain unchanged.” |
| 0:58–1:18 | Select the fire-damper photo, report, and plan locator beside the acceptance criterion. | “Here the current Rev 2 passing test identifies FD-204 and matches the installed location, but it is not linked to the requirement.” |
| 1:18–1:38 | Ask ChatGPT to stage only that exact match. Show token, payload digest, generation, and unchanged `9/14`. | “The agent stages one exact proposal. Staging records the evidence and reason, but it cannot approve the work and does not change readiness.” |
| 1:38–1:56 | Click **Accept evidence** in the visible human-only panel. Hold on `Approved · not yet applied`. | “A person reviews the same evidence and criterion in the page. Approval is separate and still does not mutate the project.” |
| 1:56–2:16 | Ask ChatGPT to apply the exact approved token once. Show `10/14`, linked evidence, and four remaining exceptions. | “Now the agent can consume that exact approval once. The fire test becomes accepted, and only that requirement changes.” |
| 2:16–2:32 | Ask it to reuse the same token. Show `APPROVAL_CONSUMED`, then open the three-event audit. | “Replay fails closed. The visible audit records the proposal, the human decision, and the exact applied change with state and approval proofs.” |
| 2:32–2:44 | Open the handoff preview at `not_ready_to_issue`; show the four named exceptions. | “Closeout never turns exceptions into fake completion. WebMCP reconciles the proof; the human owns the decision; the handoff stays honest.” |

## Capture checklist

- Fresh supported GPT-5.6 Sol or Terra chat after the deployed page registers.
- Browser address bar shows the exact deployed HTTPS origin.
- Site Tools menu shows all ten tools before narration begins.
- Sources visibly records the read, blocker, stage, apply, replay, audit, and
  handoff calls.
- No old prototype, localhost path, internal filename, token from another run,
  or unproven reset claim appears.
- Audio is intelligible, captions are corrected, and final runtime is ≤2:50.
