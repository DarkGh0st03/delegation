# Orchestrator bootstrap utility

This application provides an **optional trusted Software Engineer → Orchestrator root-credential bootstrap command**. It is not the canonical three-agent Coordinator itself.

`src/bootstrap-engineer.ts` calls the Rust Delegation Adapter as the trusted Engineer identity, requests a root Delegation Credential with `ENGINEER_TO_ORCHESTRATOR_ROOT_AUTHORITY`, and prints a sanitized issuance summary.

```bash
npm --prefix poc run orchestrator:bootstrap
```

Required environment: `DELEGATION_ADAPTER_URL`, `ADAPTER_CALLER_ENGINEER`; optional root-credential ID/validity/status configuration appears in the source.

## Current execution path

The **actual** Account Suspension sequential workflow is implemented in `poc/packages/orchestrator-runtime/src/sequential-coordinator.ts`, started by `poc/packages/agent-runtime/scripts/a2a-production-coordinator-mcp-gemini-live.mjs`. It sends A2A tasks to Backend → Frontend → Test and uses the Gateway directly for branch and PR operations. It never performs automatic merge.

A green offline scripted test is not a paid live Gemini inference.

## Stage 9 — Trusted two-root Engineer authority (opt-in)

The reusable trusted backend contract lives in
`poc/packages/orchestrator-runtime/src/trusted-engineer-authority.ts`.
**It is not installed as a Gemini FunctionTool or exposed over A2A/MCP.**
This package's existing `bootstrap-engineer.ts` command still creates
the old IAM Console template root and is unchanged.

The new `TrustedEngineerAuthoritySession` has two explicit operations:

1. `startPlanning(root)` issues a new Rust Engineer→Orchestrator root
   credential valid for at most **900 seconds**. All privileges are
   derived by trusted code from a **pre-validated repository snapshot**
   (repository identity, pinned base SHA, directory list and file list).
   They consist only of `read_repository`, `list_directory` and
   `read_file` permissions with exact `main` resource URIs. There is
   **no write, test, branch-create or PR permission** in this root.
2. `approveAndIssueOperationalRoot(root)` first retrieves the
   **persisted authenticated** plan/approval from a `TrustedApprovalStore`
   supplied by a future Engineer backend. It verifies Engineer identity,
   repository/base revision, immutable plan version/digest, task/agent
   permission assignments, the authoritative Rust Operation catalog,
   supported Gateway tools, canonical URIs and denial of main writes.
   It then requires an acknowledged **irreversible revocation** of the
   provisional root via the Engineer-authenticated Adapter endpoint
   `/v1/credentials/status`. Only afterwards does it issue a **new
   independent** Engineer→Orchestrator root containing precisely the
   approved permissions (maximum 128). The second credential must
   have a new ID and a different revocation status entry.

On any revocation uncertainty the session fails closed. The old
provisional DC may still exist until its short TTL expires in a
failed network situation, so **no operational DC is issued** until a
trusted operator reconciles the incident. Roots are still verified
by the Rust Core and Gateway policy; a credential alone **does not**
authorize an action absent approved-plan compliance.

### Important limits of this stage

The `TrustedApprovalStore` is **an interface**; it does not yet
authenticate actual GUI logins, persist immutable approval records, or
prove real human consent. CI supplies an explicitly simulated
trusted-store fixture. Nobody may treat a user-controlled plan JSON,
a SHA digest or the current mock UI as authenticated approval.

The repository manifest is **trusted input** to the module; later
bootstrap logic must obtain it from a verified Gitea snapshot and
check the real HEAD against `base_revision`. Gateway discovery tools
currently resolve each read at a branch commit, but this stage does
not yet enforce a single *common* Git SHA across the whole Planning
session. That end-to-end revision binding must be completed before
live autonomous Planning.

The operational root permission union is derived from the approved
plan; runtime enforcement of the immutable plan and assigned Task at
**each Gateway provider effect** remains a separate mandatory
upcoming integration. No second plan engine or new trusted signing
keys have been introduced.

Offline tests:
```sh
node --test poc/packages/plan-contracts/test/*.test.mjs
npm --prefix poc run orchestrator-runtime:test
```

These tests use **no Gemini calls, no paid APIs and no real GUI approval**.



## Stage 12 — Signed Engineer approval and trusted handoff (opt-in)

A new domain-separated, expiring Ed25519 Engineer receipt lives in
`poc/packages/plan-contracts/src/signed-approval.mjs`. It signs the pinned
plan SHA-256 digest, **all approved permission IDs**, the full approval
decision, Engineer DID, signing-key ID and receipt timestamps. Its
verifier rejects altered/expired records and unknown pinned keys.

`SignedEngineerApprovalFileStore` loads the receipt from a protected
directory and checks it with a trusted Engineer DID/public-key
allowlist. It has no public write endpoint or model-visible method.
Both the Engineer credential issuer and the Gateway-approved-plan
registry consume this SAME authenticated record interface.

Manual operator procedure (not an LLM/tool action):

```sh
ENGINEER_DID=did:your:engineer node --experimental-strip-types \
  poc/apps/orchestrator/src/sign-engineer-approval.mjs \
  /secure/input/plan.json /secure/input/approval.json \
  /secure/approvals /secure/keys/engineer-ed25519.pem engineer-pinned-key-v1
```

The signer requires an interactive terminal, a mode-0600 private key,
shows Engineer identity, exact repository/base SHA/plan digest,
version and approved permission IDs, and requires the operator to
type `APPROVE <plan_digest>`. The signed receipt is created once, with
mode 0600, in the requested protected directory; neither the private
key nor the signed VP is exposed to ADK, Gemini or MCP.

**Cryptographic signing proves possession of the pinned key, NOT a
production identity-provider login or real authenticated GUI click.**
This is an explicit local signing ceremony, with genuine Ed25519
signature verification, not a claim of completed GUI consent.
A production Engineer identity/session and safe key management must
still be integrated.

`TrustedExecutionCoordinator` connects the existing read-only
Engineer-root session to the opt-in Gateway approved-plan guard:

1. Start the Gitea-SHA-pinned provisional read-only root.
2. Retrieve the authenticated signed Engineer approval; confirm
   revocation of the provisional root before independent operational
   root issuance.
3. Activate the SAME digest/SHA in the trusted Gateway plan registry,
   or revoke the newly issued operational credential on failure.
4. Bind actual A2A task IDs to plan tasks/agents; leave actual
   provider authorization to Rust VC/VP + OPA + per-effect plan checks.
   Completion requires trusted provider evidence and a separate
   task-completion attestor.
5. Close the operational session and revoke the operational root.

The tests use **disposable locally generated keys**, a real signed
on-disk receipt, simulated Rust/OPA/provider outcomes and a simulated
task-completion attestor. No Gemini call or paid API is used.

**Not yet deployed:** authenticated human GUI consent, a real
cross-process authenticated Gateway/coordinator integration, durable
multi-replica session/task state, real A2A completion evidence and
full argument-bound branch/PR approvals. The historical Gemini
workflow remains on its legacy, tested configuration.

Offline test:
`node --experimental-strip-types --test poc/packages/orchestrator-runtime/test/signed-approval-coordinator.test.ts`


## Authenticated Engineer local console (opt-in, offline)

A separate **local-only** approval GUI is served by
\`src/engineer-approval-server.mjs\`. It replaces neither the existing
\`poc/workflow-ui/index.html\` mock nor the legacy Gemini workflow.

It accepts the Software Engineer's password against a pre-provisioned
**scrypt verifier** (not a raw password), uses a short-lived HttpOnly,
SameSite=Strict cookie, an independent CSRF token, explicit local Origin/Host
checks and a six-attempt/minute login bound. The HTTP listener binds **only
127.0.0.1**. This is suitable for a trusted local demonstration, **not**
internet exposure or an enterprise OIDC/SSO provider. Do not reverse-proxy
it publicly or treat a machine with another untrusted local account as safe.

Before startup, the operator provisions the following trusted resources
**outside the repository**: an owner-only plan file \`0600\` inside an owner-only
directory \`0700\`, an Engineer Ed25519 PKCS8 private PEM with the same
protections, a pinned public PEM, and an empty owner-only \`0700\` receipt
directory. The plan must be independently validated and tied to the
session, repository, Agent Card registry and **actual Gitea SHA** by the
trusted importer. Nothing submitted by the browser is used as the plan.

Provide these environment variables:

\`\`\`text
ENGINEER_DID                     expected authenticated Engineer DID
ENGINEER_SIGNING_KEY_ID          pinned Ed25519 key identifier
ENGINEER_TRUSTED_PLAN_FILE       independently sourced trusted plan JSON
ENGINEER_SESSION_ID              trusted session identifier
ENGINEER_BASE_SHA                pinned 40-character commit SHA
ENGINEER_REPOSITORY_JSON         exact trusted repository object JSON
ENGINEER_SIGNING_KEY_FILE        protected PKCS8 private PEM path
ENGINEER_PUBLIC_KEY_FILE         independently pinned SPKI public PEM path
ENGINEER_APPROVAL_DIRECTORY      owner-only output directory
ENGINEER_PASSWORD_SALT_HEX       >=16 random bytes, hex
ENGINEER_PASSWORD_SCRYPT_HEX     scrypt(password, salt, 64 bytes), hex
ENGINEER_APPROVAL_PORT           optional, defaults to 8787
\`\`\`

Generate the scrypt verifier outside version control, from a password chosen
by the Engineer, using the standard Node \`crypto.scryptSync(password,
Buffer.from(saltHex,"hex"),64).toString("hex")\`. Never commit password,
verifier, private key, signed receipt, token or a live approval to GitHub.

Run:

\`\`\`sh
node --experimental-strip-types poc/apps/orchestrator/src/engineer-approval-server.mjs
\`\`\`

Visit \`http://127.0.0.1:8787/\` locally. Once authenticated, review the
**server-trusted** tasks, repository SHA and proposed permissions, select a
nonempty subset and type \`APPROVE <64-character-plan-digest>\` exactly.
Only then the backend constructs \`makeApproval\`, signs an Ed25519
receipt, checks its pinned key and atomically creates the protected
\`<session_id>.json\` with \`wx\` and \`0600\`. No operational root DC
is emitted by this console. A later authenticated trusted coordinator
can load the result via \`SignedEngineerApprovalFileStore\` and perform
confirmed preliminary revocation, independent root issuance and Gateway
activation.

**Still needed:** durable multi-process authenticated handoff, actual
repository Engineer ACL/authority resolution, secrets management such as
KMS/HSM, stronger web identity federation, A2A artifact/completion attestor
and deployment hardening. The single-process session store does not
survive restarts. This GUI is separate from any model-exposed tool.

Offline CI: \`.github/workflows/engineer-approval-ui-offline.yml\`.


## Trusted A2A completion bridge

The general planning/execution refactor now includes
`TrustedExecutionCoordinator.confirmObservedA2AResult(result)` and
`confirmObservedOrchestratorTask(runtimeTaskId)`. They send normalized
metadata from the trusted `DelegatedA2ARoleRunner` result to the
Gateway's private IPC command. They do not accept an ADK FunctionTool,
LLM decision or public API request as an authenticated completion.

The Gateway requires the exact approved runtime Task binding, correct
DAG dependencies, and separately recorded provider writes/test results.
For code agents, the artifact's paths and SHA must correspond to
Gateway-observed Gitea writes. For tests, the Runner must independently
report a matching passing SHA and mandatory pass statuses. The
`trusted-a2a-observer.test.ts` tests this adaptation.

The existing deterministic Account Suspension orchestrator is not
silently switched to this opt-in approved-plan path. Wiring of a fully
dynamic DAG dispatcher and trusted A2A re-polling remains future work.
