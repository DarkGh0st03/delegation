# R280 — manual Gemini workflow readiness (no model execution)

**Branch:** `refactor/post-prof-plan-contracts-20261021`  
**R279 native baseline:** `75bb066df63fd2fe3c2106699427171418fd4867` — four independent native CI runs **SUCCESS**.  
**R278 no-AI F1:** `f7bb80281215ecd2763a316ef936fba38c935892` — Fast CI and real-Gitea Planning-only **SUCCESS**.

## Why R280 exists

The original manual Gemini workflow already selects the trusted Engineer
Node-API, authenticated task-local native crypto and public-only Rust Gateway.
However, its two manual jobs (full D0, Planning-only) did not explicitly
set `ADAPTER_DID_PUBLISHER_SCRIPT` and `ADAPTER_DID_RESOLVER_SCRIPT`.
The equivalent **zero-billing F1** failed at native issuer initialization
until R278 supplied absolute paths to these scripts.

R280 applies this same proven configuration to **both** manually-dispatched
Gemini modes, with fail-closed tests that the scripts exist and paths are
absolute. It does not alter root privileges, Ed25519 approval, signed Tasks,
agent prompts, recovery scope, Gateway/OPA policy or the Rust code.

A no-network Fast CI regression ensures the two manual modes match the
real-Gitea free F1 and canonical DAG. This prevents a repeat of the known
issuer-startup failure from becoming an unnecessary billed experiment.

## R280 exact-SHA free release gate

Three explicit checkpoint files plus automatic Fast CI must all pass on
**one R280 commit SHA**. The manual paid entrypoint's
`signed-gemini-pilot-ci-gate.mjs` checks four distinct native workflow
results by their actual GitHub workflow path, repository, branch and SHA.
Results from the earlier R279 SHA **cannot** satisfy the R280 gate.

The checks are all free of Gemini/OpenAI model calls. No billing is
authorized by writing a checkpoint, updating the workflow, or succeeding
in CI.

## Separately authorized future experiment

The full D0 mode remains a **potentially billed** test with a signed
Engineer TEST fixture, not a real human approval event. It needs explicit
manual GitHub dispatch, exact SHA, model, billing-cap acknowledgement,
and separately selected optional D1 consent.

**Important:** The workflow checks *acknowledgement* of a provider spending
cap but does not enforce a hard monetary spending limit. The cap must be
verified externally before any authorized model run. A successful free
scripted DAG does not establish genuine Gemini agent efficacy.

Do not dispatch Gemini, create a merge to main, or widen Task permissions
without fresh user consent.
