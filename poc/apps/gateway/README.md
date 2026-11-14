# Gateway

The Policy Enforcement Point between the agents and the repository. It runs
inside the `app` container, one instance per session, and is the only path
through which an agent can read or change Gitea or start the Runner.

For every tool call:

1. **prepare** (`src/prepare.ts`, `src/canonical.ts`): derives the exact
   `ResourceUri + Operation` from the tool arguments and binds a one-time
   challenge to the request, the Task and the agent role;
2. the agent's **wallet** signs a Verifiable Presentation of its Child
   Delegation Credential over that challenge;
3. **execute** (`src/execute.ts`): the native Rust verifier
   (`src/direct-core-loader.ts`, `src/direct-core-verifier.ts`) checks the VP,
   the delegation chain up to the Engineer-signed Root, revocation and
   on-chain trust; then OPA (`src/policy-client.ts`) decides with the
   repository policy published by the console;
4. only then the effect is executed: Gitea reads, updates and creates with a
   HEAD compare-and-swap (`src/gitea-*.ts`), test runs through the Runner with
   MAC-verified evidence (`src/runner-client.ts`,
   `src/trusted-authority-only-runner-*.ts`).

`src/trusted-authority-only-admissions.ts` admits each Task (exact signed
grants, one write per Task, test-source fences) and `src/trusted-plan-ipc.ts`
is the private channel with the Review Host. Every decision is recorded in the
audit sink shown live in the console.

Tests: `npm --prefix poc run gateway:test`.
