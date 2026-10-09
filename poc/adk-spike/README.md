# ADK TypeScript spike — Phase 1

This is an **isolated compatibility experiment**, not the production PoC agent runtime.
The existing `poc/package-lock.json`, Gateway, A2A implementation, Rust Adapter and
permission templates are intentionally untouched.

## Reproducibility

- Runtime: Node.js **22.15.0**, npm **10.9.2**, identical to the existing PoC.
- Exact package versions: `@google/adk@2.2.1`, `@google/adk-devtools@2.2.0`.
- A committed `package-lock.json` is generated during the Phase 1 bootstrap
  GitHub Actions run; subsequent installations use `npm ci`.
- This spike is outside the existing `poc` npm workspaces: it cannot change
  the existing A2A 1.0 SDK dependency or the measured baseline.

## Keyless CI smoke

From the repository root:

```sh
npm ci --prefix poc/adk-spike
npm --prefix poc/adk-spike run smoke
```

These checks construct an actual `LlmAgent` and an in-memory ADK `Runner`
and session. They do **not** make model calls, require keys, read repositories
or invoke privileged tools. They do not claim to validate a live LLM turn.

## Optional manual interactive smoke

From inside `poc/adk-spike`, configure `GOOGLE_GENAI_API_KEY` only in your
local environment (never commit it), then run:

```sh
npm run run
# or
npm run web
```

The example uses `gemini-flash-latest` for SDK compatibility **only**.
No change of the thesis PoC's existing OpenAI model has been approved.
Before Phase 2, verify the Google ADK model-adapter strategy and preserve
the effective model and audit semantics.

## Security invariants for Phase 2

The eventual ADK runtime must keep Delegation Evidence and service keys
outside model-visible history; agents must invoke only role-specific controlled
tools, and **all** protected actions still pass through Gateway, Verifier, and OPA.
Never provide unrestricted shell, direct Git provider tokens or raw authority
claims to the LLM.

Official upstream: https://github.com/google/adk-js
