# Native Gemini ADK — Phase 8

## Validated real-provider checkpoint (9 October 2026)

The Google ADK `Gemini` model called `gemini-3.8-flash` on the Gemini
Developer API using the existing GitHub repository secret
`Delegation_Thesis_Gemini`. The run completed successfully:
- Real provider turns: 2
- Successful `read_file` calls: 1
- Tool returned only an in-memory synthetic TypeScript fixture
- Repository, Gateway, Rust Adapter, DC/VP, Gitea and cloud account had **no** access from the smoke model.

Reference: https://github.com/DarkGh0st03/delegation/actions/runs/37965235920

This proves real Gemini function calling through Google ADK, not that a real
model can independently implement Account Suspension end to end.

## Wiring

The model factory `createGeminiAdkModel` requires a Gemini API key, forces
the direct Gemini Developer API (not Vertex AI), and validates the model name.

- `poc/apps/a2a-agent/src/main.ts` supports `AGENT_RUNTIME_ENGINE=adk`
  with opt-in `ADK_MODEL_PROVIDER=gemini`, `GEMINI_API_KEY` and optional
  `GEMINI_MODEL` (default `gemini-3.8-flash`).
- The Phase 5 protected E2E workflow now has an optional **manual-only**
  `adk-gemini` mode; all four ADK agents receive the Gemini model. It
  reads the existing GitHub secret `Delegation_Thesis_Gemini`. This full
  live-code E2E has **not** yet been run with Gemini; the default on push
  remains deterministic `adk-scripted`.
- The read-only smoke workflow has **manual dispatch only** after the
  one-time successful run; the temporary trigger marker is removed.
- Gateway, per-role DC, Verifier, OPA, Anvil trust, exact-SHA Test Runner,
  pull-request gate and no-auto-merge behavior are untouched.

## Cost and data policy

`Default Gemini Project` must remain on Gemini API **Free Tier** to
avoid Paid Tier token billing. Linking the Cloud trial billing account
would change that project's billing tier. The Gemini Free Tier may use
prompt and response content for Google's product improvement; never send
private code, signing keys, credentials, personal information or other
sensitive content to that project. The synthetic smoke fixture has no
real project data.

Test results are not provider pricing guarantees; confirm the Free Tier
in Google AI Studio before repeating or manually invoking the full E2E.
