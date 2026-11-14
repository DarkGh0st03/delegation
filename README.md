# Delegation — delegated authorization for AI agents in software engineering

Thesis proof of concept: a Software Engineer delegates **bounded, verifiable
authority** to a team of AI agents (Orchestrator, Backend, Frontend, Test) that
work on a Git repository. Every agent operation is authorized by a chain of
Delegation Credentials verified in Rust and by OPA policy; nothing reaches the
repository without the Engineer's signed approval, and merging stays human.

## Quick start (local, Docker only)

Requirements: Docker (on Windows: Docker Desktop with WSL integration). From the
repository root:

```bash
cp .env.example .env        # then set ENGINEER_PASSWORD (and optionally GEMINI_API_KEY)
docker compose up -d --build
```

Open **http://127.0.0.1:8700** and sign in to **Sigillo** (the console; name
and "Ardesia Labs" brand are fictional). The first build compiles the native
Rust modules and takes several minutes. Compose starts Gitea, OPA and Anvil,
prepares accounts, the example repository and the on-chain registries, the
Engineer console and the test Runner. Full guide (Italian):
[docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md).

## How a session works

1. **Planning.** The console publishes the repository policy to OPA, pins the
   repository's **project profile** (Runner image, ordered test phases, folders
   where tests may be written) to the session and issues a read-only
   *preliminary Root* credential. The Planner reads the pinned commit
   only through the Gateway (Rust VP verification + OPA + Gitea) and proposes
   permissions (operation + resource URI) for the requirement.
2. **Review.** The Engineer can only remove permissions, never add them, and
   signs the selected subset with an Ed25519 key unlocked by the password. The
   signed grant also binds the SHA-256 of the project profile: agents cannot
   change what "the tests pass" means.
3. **Execution.** The preliminary Root is revoked and an *operational Root*
   with exactly the signed permissions is issued. The Orchestrator delegates
   one Task at a time, each with its own attenuated *Child* credential. A
   Task may hold several signed **reads** (at most 15) and **one write**:
   the compare-and-swap update of a file read in the same Task (with the
   files it depends on), or the creation of a new file written from the
   files read (e.g. a new test for a component, with proof that the file
   did not exist). Every read is a separate verified, journaled effect, and
   the write is admitted only after all of them, at the same pinned commit. Backend/Frontend change application files; the Test agent
   reads the changed files and writes tests for the new behaviour; then the
   phases of the signed project profile run in a throw-away Docker container.
   When a test phase fails, the Runner reports which tests failed and their
   error message (cleaned and bounded, carried in the MAC-protected FAIL
   evidence): the Orchestrator uses them, as untrusted data, to decide whether
   to repair the test or the application code, and the Engineer sees them in
   the session timeline.
4. **Draft PR** only after a verified PASS of every project test phase on the
   final commit. The Root is revoked at the end (or at once with *Stop*).

Sessions run with **Gemini** (`gemini-3.8-flash`, paid): sending the prompt
starts the session, bounded by per-session call and token limits, with full
per-call diagnostics. Two free modes without AI (simulated edits and the known
reference solution of the example requirement) remain only for automated
tests and the offline sandbox (`DELEGATION_FREE_MODES=1`).

Repositories are imported **only from the Engineer's GitHub account**
(`GITHUB_OWNER` in `.env`; optional read-only `GITHUB_TOKEN` for private ones,
kept server-side) and can be deleted from the console. Old sessions are
archived, not deleted (accountability):
`docker compose exec app node poc/engineer-console/scripts/archive-sessions.mjs --keep 2`.

## Latest successful runs

- **2026-11-13, Gemini, new requirement** ("search users by name or email
  and filter them by department"): Planning (26 permissions, all signed),
  13 Tasks, 38 Gateway authorizations (0 denied), one Runner FAIL repaired
  from the reported error messages, Runner **PASS**, Draft PR, in about 10
  minutes with 62 Gemini calls (184,251 tokens). The code review found that
  the repair changed the example seed data to fit an invented test (see the
  run log); the prompts now forbid that.
- **2026-11-12, Gemini, Account Suspension**: first complete run with a real
  model, 13 Tasks, 38 authorizations, PASS and Draft PR in about 9 minutes.

Details and code reviews: [docs/RUN_LOG.md](docs/RUN_LOG.md).

## Where things are

| Component | Entry point |
| --- | --- |
| Engineer console (UI, sessions, Gemini limits) | `poc/engineer-console/src/` |
| Review Host (Planning → signed review → Roots) | `poc/apps/orchestrator/src/trusted-authority-only-review-host.mjs` |
| Operational assembly | `poc/apps/orchestrator/src/canonical-owner-deployment.mjs` |
| Orchestrator Task decisions | `poc/packages/orchestrator-runtime/src/trusted-authority-only-adk-decision-proposer.mjs` |
| Specialist agents (ADK/A2A) | `poc/packages/agent-runtime/src/` |
| Gateway (prepare/execute, Rust verifier, OPA) | `poc/apps/gateway/src/` |
| Rust core (credentials, accumulators, VP) | `src/`, `services/delegation-*-node/` |
| Per-role MCP wallets (one signing key each) | `poc/engineer-console/src/role-wallet.mjs`, `services/delegation-adapter/src/config.rs` |
| OPA policy | `poc/opa/policy.rego` |
| Test Runner | `poc/apps/test-runner-controller/`, `deploy/runner/start.mjs` |
| Trust registries (EVM) | `blockchain/` |

## Tests (no paid model calls)

```bash
npm --prefix poc ci --ignore-scripts --no-audit --no-fund
npm --prefix poc run console:test
npm --prefix poc run gateway:test
npm --prefix poc run agent-runtime:test
npm --prefix poc run orchestrator-runtime:test
npm --prefix poc run orchestrator:test
npm --prefix poc run plan-contracts:test
npm --prefix poc run runner:test
npm --prefix poc run opa:test
cargo test --locked
```

The same unit tests run in CI on every push (`.github/workflows/tests.yml`).

## Declared limits

- Each repository has a **project profile** (Docker image, ordered test
  phases, test folders and suffixes), bound to the Engineer's signature. It is
  not edited in the console: the example repository gets its known profile,
  any other repository a plain npm template (`npm ci`, `npm test`). The first
  phase prepares the environment: a failure there is not repaired by the agents.
- The base branch is the repository's default branch (e.g. `main` or
  `master`); agents always work on `feature/<session>`, a namespace that is
  fixed and protected by OPA.
- **One MCP-wallet per role.** The Orchestrator and each agent (Backend,
  Frontend, Test) have their own wallet process: the Rust delegation library
  plus ONLY that role's signing key, generated inside the wallet (only its
  public key is published on-chain). Agents and the Orchestrator send their
  parameters (their credential, the Gateway challenge) to their own wallet and
  receive the signed VP or Child DC; a wallet refuses a credential that is
  not delegated to its identity. The Engineer core keeps Roots, revocation and
  the platform governance key. In this local deployment the wallets are
  separate processes in the same container, started by the console with
  their EVM account key; in production each would run with the agent's own
  secret store.
- The Engineer's Ed25519 key is held by the local `app` container and unlocked
  by the password (not a personal hardware key).
- The `runner` service mounts the host Docker socket (root-equivalent on the
  host); it is isolated on the internal network with a read-only Gitea token.
- Gemini limits are on calls and reported tokens, not on money: set a spending
  limit in the Google project. Never run paid sessions without consent.

Historical reports of earlier iterations are kept in [docs/archive](docs/archive/).
