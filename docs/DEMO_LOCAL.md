# Local professor demo

This helper is intentionally kept on the `demo-local` branch. The frozen thesis
`main` branch is not modified.

## What the demo proves

The positive demo exercises the real protected path used by the thesis PoC:

```text
Software Engineer
    -> root Delegation Credential
Orchestrator
    -> deterministic child authority template
Backend Agent -> Frontend Agent -> Test Agent
    -> A2A task + delegated evidence
    -> Cloud Access Gateway
    -> Rust Delegation Adapter / DelegationVerifier
    -> EVM trust + DID/status verification
    -> OPA contextual policy
    -> Gitea or Controlled Test Runner
    -> Pull Request only; no automatic merge
```

The measured Phase 10B run uses deterministic scripted model clients through the
same agent-runtime/model interface. This is deliberate: it removes LLM output
variance from the reproducible experiment. Do not describe the Phase 10B demo as
three live GPT calls.

## Why Anvil is native in this local helper

The frozen CI topology runs Anvil from the pinned Foundry container. On this
specific Windows + Docker Desktop workstation, the pinned Foundry image returns
an `exec format error` even when the linux/amd64 manifest is selected. The native
WSL installation is the same pinned Foundry/Anvil version (`1.8.4`) and passed the
same Solidity and EVM checks, so the local presentation helper runs Anvil natively
while leaving the frozen CI implementation unchanged.

## Commands

From WSL, inside the repository:

```bash
cd ~/projects/delegation
```

For a complete rehearsal in one command:

```bash
bash poc/scripts/demo-local.sh all
```

For the actual professor presentation, use the staged version:

```bash
bash poc/scripts/demo-local.sh reset
bash poc/scripts/demo-local.sh up
```

At this point open `http://127.0.0.1:3000`, enter `thesis/iam-console-poc`, and
show that `main` is still at the protected baseline:

```text
405748b1e77992b6bd8630a3ab6f990658d32f6b
```

Then run:

```bash
bash poc/scripts/demo-local.sh run
```

The expected final result contains:

```text
phase10b-positive-e2e-pass
workflow_state = pr_created
completed_roles = backend, frontend, test
project_tests = pass
researcher_acceptance = pass
main_unchanged = true
automatic_merge = false
```

Show the concise machine state with:

```bash
bash poc/scripts/demo-local.sh status
```

Then refresh Gitea and show:

- `main` still points to the frozen baseline;
- `feature/account-suspension` exists;
- the feature branch contains separate Backend, Frontend and Test progress;
- Pull Request `#1` targets `main`;
- no automatic merge occurred.

When finished:

```bash
bash poc/scripts/demo-local.sh down
```

`down` preserves the Gitea volume so the final PR remains visible. `reset` is the
command that deliberately deletes only the local Gitea demo state and prepares a
clean rerun.

## Suggested explanation while it runs

When `up` starts the services, explain the responsibility split rather than the
shell commands themselves: Gitea is the protected Git provider; OPA evaluates
workflow/context rules; Anvil provides the local EVM trust layer; the Rust
Delegation Adapter exposes issuance/presentation/verification to the Node.js
runtime; the Gateway is the single protected execution boundary; the Controlled
Runner executes tests at an exact commit SHA and also runs researcher-owned
acceptance tests.

When `run` starts, explain the authority split: the model/runtime may select a
specialized role, but the model never invents its own permission list. A role is
mapped to the frozen `DC_Backend`, `DC_Frontend`, or `DC_Test` authority template.
That is the distinction between task decomposition and authority decomposition.
