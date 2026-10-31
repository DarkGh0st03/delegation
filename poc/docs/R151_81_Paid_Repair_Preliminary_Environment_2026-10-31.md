# R151.81 — isolate preliminary rehearsal from paid repair settings

Run 41239290597 used R151.80 (7b96e400abd83244453fedef7cfe5fd3b27c3be1).
Consent, the same-SHA CI gate, native services and model metadata checks passed.
The pilot step then failed. Artifact 13057440133 contains no verified Docker
phase, no agent failure evidence, and zero observed model delegate calls with
incomplete usage metadata. Its sole verified phase signal is
native_preliminary_planning_real_disposable_gitea. It does not prove provider
invoice cost or root revocation; neither should be invented from that report.

The job logs confirm the actual submitted repair configuration:
DELEGATION_SIGNED_GEMINI_REPAIR_D1=1, with the exact additional-repair consent.
The user correctly enabled recovery in this attempt.

## Deterministic startup defect

Before the real pilot, isolated-trusted-security-ci-positive-smoke.mjs starts
an earlier native denial-only/read-only rehearsal. That child previously
copied the paid parent's environment and set GEMINI_PILOT=0, but retained
GEMINI_REPAIR_D1=1. The native entrypoint explicitly rejects repair=1 with
pilot=0, before planning or agent execution. The original artifact does not
retain the raw child's exception, but the submitted environment plus this
unconditional guard establish the startup conflict. A regression test launches
the actual old native entrypoint environment, without an API key, and reproduces:
"R151.12 paid repair epoch requires separate explicit billing consent".
The old free fixture did not cover this inherited paid-repair configuration.

## Fix

Build the preliminary child's environment with one dedicated pure helper:
disable both paid switches, clear both charge acknowledgements and the Gemini
key in that child, and explicitly keep its positive operational DAG disabled.
Native Rust/Gateway/OPA fixture configuration and the disposable read-only Gitea
pins remain intact. Parent settings are copied, never mutated. The later
operational subprocess still receives the original paid-pilot and additional
repair authorization from the parent. No consent gate is relaxed or bypassed;
no Gemini request is issued by this fix or its tests.

This change does not alter generated application code, researcher acceptance,
repair planning, original root permissions, child issuance, Rust or OPA.
A real generative FAIL/PASS and the quality of a model-chosen repair remain
unverified by this aborted attempt.

## Validation

Three focused tests reproduce the old actual entrypoint rejection, validate
preliminary isolation, and verify the parent retains the later authorized
pilot/repair settings. They pass on pinned Node 22.15.0. The Controller and
consent/CI-gate/failure-observation regression selection also passes locally.
The Functional Signed DAG workflow explicitly runs the new regression and
tracks the environment helper path. All three free CI gates must pass on the
NEW published SHA before any further paid pilot. R151.80 green runs are not
reused as proof for R151.81.

No new paid workflow was dispatched. Main is unchanged.
