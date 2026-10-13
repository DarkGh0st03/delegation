# Security and correctness review of Gemini-generated Account Suspension code

Review date: **13 October 2026**. Status: **completed static review; historical dynamic acceptance verified from CI evidence; not production-approved**.

## Immutable input and evidence

- Live Gemini run: [38379922436](https://github.com/DarkGh0st03/delegation/actions/runs/38379922436), framework SHA `9012c8c4e7a9244cb931bcdef411cc5f443f0c08`.
- Generated application base: `DarkGh0st03/iam-console-poc` `main` at `405748b1e77992b6bd8630a3ab6f990658d32f6b`, confirmed as the current and experiment baseline.
- Reviewed artifact: `gemini-shared-mcp-evidence-38379922436`, ID `11802414698`; downloaded ZIP SHA-256 `60245281abc619bce3eeaf195d85a6cb1184fb15ed0aa2ffcf6a9fd0f759269f`, matching GitHub metadata.
- ZIP tested without corruption, contains the exact 11 generated source files and `manifest.json`; source files were read individually and compared against baseline where applicable.
- Ephemeral Gitea final feature SHA: `3306f08aa57ebfe9635842e61b3a3c2a768e1ee7`; actual merge status: **not merged**, approval absent.
- Assessment method: static code inspection of the archived generated files and baseline security/app files; review of exact live workflow telemetry and acceptance status. **This review did not launch another Gemini model call or another independent full CI run.**

## Scope coverage (all 11 files)

| Role | Path | Assessment |
| --- | --- | --- |
| Backend | `packages/shared/src/account-status.ts` | Two-state union and constants correct; outdated baseline comment |
| Backend | `apps/backend/src/users/user.service.ts` | Both transitions implemented, preserves fields; guard should affirm allowed source state |
| Backend | `apps/backend/src/users/user.controller.ts` | Consistent handlers and HTTP 404/409 error mapping |
| Backend | `apps/backend/src/users/user.routes.ts` | `POST /:id/suspend` and `POST /:id/reactivate` correctly registered under parent admin middleware |
| Frontend | `apps/frontend/src/api/users-api.ts` | Encoded IDs, matching methods/routes; retains baseline demo role header |
| Frontend | `apps/frontend/src/pages/UserDetailPage.tsx` | State-based action buttons, pending lock, success/error feedback; review stale async request handling |
| Frontend | `apps/frontend/src/styles.css` | New status action styles; narrow viewport wrapping needs review |
| Test | `tests/backend/user.service.test.ts` | Covers success, duplicate transitions, nonexistent ID and field preservation |
| Test | `tests/backend/user.routes.test.ts` | Covers demo 401/403, success and 409; lacks explicit HTTP 404 transition cases |
| Test | `tests/frontend/UserDetailPage.test.tsx` | Covers both actions, pending and error states; mocks are too permissive about HTTP method/headers |
| Test | `tests/e2e/account-suspension.spec.ts` | One real positive UI suspend/reactivate sequence; no negative/security E2E cases |

## Findings and classification

### F1 — P0 for a production deployment: caller-forgeable administrator role (**inherited baseline limitation**)

`apps/frontend/src/api/users-api.ts:8–10` sends `x-demo-role: admin`. The unchanged `security/src/auth-middleware.ts` accepts that HTTP header, and `security/src/security-config.ts` allows the literal `admin` role. The server uses `requireAdminRole` in `apps/backend/src/app.ts`, so the new routes do receive the *demo* check; nevertheless, **any direct HTTP client can set the same header**. A `401` for a missing header and `403` for `x-demo-role: user` are not evidence of authenticated user identity.

- **Provenance:** existed before the Gemini run; Gemini reused it, did not introduce it.
- **Impact:** treat reference-app authorization as a deliberate mock only. Replacing it with verified sessions/tokens and server-side RBAC is required *if* the generated application is ever deployed beyond the controlled thesis fixture.
- **Thesis interpretation:** it does not defeat Rust Delegation Credential/Gateway/OPA enforcement of *agent-to-provider tool calls*, because that is a different security boundary.

### F2 — P1 for production durability: user state is only in memory (**inherited baseline limitation**)

`apps/backend/src/users/user.repository.ts` holds the three seed users in a process-local `Map`, and the new service writes through `repository.save()`. State changes last while that app instance lives, but can vanish on process restart and are not shared between independent instances.

- **Provenance:** inherited baseline; not a model-introduced regression.
- **Mitigation outside current PoC:** transactional persistent storage, migration/testing strategy, and restart/multi-instance behavior tests.

### F3 — P2 robustness issue: transition guard checks destination rather than source (**new code**)

`user.service.ts:64–65` rejects `SUSPENDED` on suspension, but does not require `ACTIVE`; `user.service.ts:80–81` rejects `ACTIVE` on reactivation, but does not require `SUSPENDED`. The shared TypeScript union currently constrains callers to only these two strings, and the baseline repository seeds only `ACTIVE`, so the valid-state behavior passes. A malformed runtime record could nonetheless be normalized silently by either operation.

- **Recommended change on a separate reviewed candidate:** require `user.status === ACCOUNT_STATUS.ACTIVE` before suspension and `user.status === ACCOUNT_STATUS.SUSPENDED` before reactivation, otherwise fail with the existing 409 transition error. Add invalid-state tests, including input fabricated at runtime.
- **Risk in tested fixture:** low; no evidence of user-controlled modification of the stored `status` field.

### F4 — P2 assurance gap: missing negative HTTP/real-browser coverage (**new tests**)

The new route tests cover missing/wrong demo headers and valid/duplicate state transitions. They do **not** directly assert `404` on suspend/reactivate, despite the controller correctly mapping `UserNotFoundError` to HTTP 404. The frontend `fetch` mocks primarily match URL suffixes; they do not prove use of `POST`, required request headers or a successful recovery after real 401/403 transport errors. The Playwright test checks only the positive end-to-end suspend/reactivate path.

- **Recommended change:** add both HTTP 404 transition tests, negative UI/HTTP interaction tests with exact method assertions, and explicit unauthorized/forbidden cases in an integration harness.
- **Do not conflate:** independent Phase 11 agent/Gateway/delegation negative tests are valuable, but they test a different trust boundary.

### F5 — P3 frontend robustness: stale asynchronous page-load results (**inherited baseline pattern**)

`UserDetailPage.tsx:16–30` initiates `getUser(id)` in `useEffect` without cancellation/ignore-on-cleanup. Rapid route-ID changes can allow an older response to set the new page's data. This behavior was also present before the experiment. On a separate cleanup branch, use `AbortController` or a request-generation/ignore guard and test rapid ID switching.

### F6 — P3 presentation and traceability cleanup (**minor new changes**)

- The comment in `account-status.ts:2–4` still says future suspension implementation, though `SUSPENDED` is now defined.
- `UserDetailPage.tsx:96–119` and `styles.css:41–74` add inline action buttons without explicit mobile wrapping. Review responsive behavior under small widths and long strings.
- The UI currently reports expected API error text but does not reconcile server state after a concurrent external status mutation; optional for the bounded experiment, worthwhile in a durable application.

## Observed positive assurances

1. REST contract agreement: both backend handlers and frontend API use `POST /api/users/:id/suspend` and `POST /api/users/:id/reactivate`.
2. Domain happy path: ACTIVE → SUSPENDED → ACTIVE; duplicate state transitions generate typed errors and HTTP `409`.
3. User-not-found service errors map to HTTP `404`; source review verifies mapping, while direct transition-route 404 tests are still missing.
4. User profile fields are preserved on status transitions; no added user-controlled status input in the profile update schema.
5. Buttons expose the expected accessible labels and disable during their own pending mutation.
6. Actual **recorded** full-run gates passed: API preflight, six real Docker phases, researcher acceptance and a separate exact-SHA Security CI status. Disposable Gitea merge gate denied `human_approval_missing`.

## Reviewer conclusion

**Accept the run as credible research evidence of one successful bounded live-model delegation workflow.** Keep the 11-file output **immutable as an experimental artifact**, rather than silently hardening it and retrospectively presenting modified code as Gemini output. The generated app may be kept as a separately identified *review candidate* on an isolated branch/draft PR, but **do not merge it into the immutable `iam-console-poc` baseline**: that baseline is a critical fixture for repeating the thesis tests.

For academic reporting, distinguish: (a) agent/tool authorization verified through delegated credentials, Gateway and OPA; (b) generated application's demo-only HTTP access check; and (c) the human-approved merge gate, which correctly prevented completion without a real reviewer. A passing CI result cannot establish production-readiness or statistical model reliability.

## Next reproducibility and evaluation steps

1. Back up the exact ZIP before GitHub artifact expiry on **27 October 2026**. Retain checksum, artifact ID, run ID, source SHA and feature SHA.
2. Keep source archival separate from any later human edits or security fixes. If an editable app candidate is desirable, compare it as an independent branch/PR and run free app CI; never replace the frozen baseline in `main`.
3. For the thesis results, use explicit sections for **historical measured baseline** (`cbadb5440db408d4047d4eb870a9fb231362414a`), **scripted current-framework integration**, and **one successful real-Gemini run** (`9012c8c4...`). The multiple paid attempts used changing code/configuration and cannot support a statistically valid single-version model success rate.
4. Quantify additional performance/security properties with a separately labeled **free, deterministic** campaign on the current ADK/MCP code if necessary. Do not reuse previous Phase 12 latency measurements as though they came from the live framework.
5. Any additional *paid* Gemini call requires fresh explicit authorization by the owner. No genuine human approval or production merge has been performed.

Related: [exact live run evidence](LIVE_GEMINI_SHARED_MCP_EVIDENCE_2026-10-13.md), [checkpoint](CURRENT_CHECKPOINT.md), [measured-history limits](REPRODUCIBILITY.md).
