# R335 — Authenticated native Runner FAIL classification (offline gate)

## Observed gap

R334.1 is green. In the native authority-only route,
`TrustedAuthorityOnlyRunnerExecutor` independently authenticates and
seals a successful seven-phase Runner PASS. On FAIL it formerly passed
the negative response to the PASS publisher and obtained a generic
failure, without classifying the authentic Runner result.

## Implemented

The new pure `validateTrustedRunnerFailure` requires the **original**
RunnerClient-branded result from the exact owner-authenticated POST,
the immutable reserved Test Task/Child/branch/SHA intent, an ordered
seven-phase transcript and the first terminal failure. Copies,
mutations, changed SHA, forged Task, missing phase or contradictory
status fail closed. Dependency install failure is not considered an
actionable code-repair candidate.

The real native Runner executor now routes only `status=fail` through
that validator and then **always rejects Task success**. It does
not grant repair authority, create another Child, retry Docker or
mark Gateway completion. No other effect path is changed.

Targeted offline regression is wired into Fast CI.

## Next required D1 milestone

Create an independently verifiable, durable FAIL receipt bound to the
original Rust-signed root, Gateway's registered Task/Child,
authenticated Runner result and exact Gitea tested SHA. Expose it
only to the privileged owner-side recovery preflight. Only after
a failed result is authenticated **again** may D1 register new
epoch-specific Tasks constrained by the original Engineer permission
ceiling, and then test repaired output via actual Gateway/Rust/OPA,
Gitea CAS and Docker.

This R335 classification alone is **not** a completed D1 recovery
or a paid Gemini demonstration. No model calls, automatic merge or
`main` mutation.
