# R151.82 — Preserve project-test failure diagnostics

## Observed paid failure

Run 41243217022, attempt 1, framework SHA
97b89f39027729be254c787e24b827b29be23f4a passed dependency installation
and typecheck, then failed backend_tests. All subsequent phases were skipped.
The official sanitized artifact recorded 27 provider calls and enabled D1
consent. It did not retain the individual assertion or failed test file.
Application causality remains unestablished; neither a recovered PASS nor a
confirmed root revocation is established by that report.

The current repair eligibility guard accepts classified TypeScript failures
or researcher acceptance failures. It excludes backend_tests/frontend_tests.
The acceptance candidate collector also requires passing project tests. Thus
enabling the paid repair flag alone does not enable project-test recovery.

## Concrete diagnostic loss and correction

The isolated Runner already extracts at most eight sanitized Vitest FAIL file
paths on non-timeout Backend/Frontend failures. RunnerClient decodes these
paths, but GiteaExecutor previously omitted failing_test_files when building
its provider result. Preserve a copy in that private result, on the exact SHA
already checked by RunnerClient. This supplies data to existing downstream
Task read-grant filtering; it does not add permission to read or edit files.

RunnerClient now retains this field only if the FIRST failed phase is
backend_tests or frontend_tests, using that phase's path namespace. A forged
field accompanying a typecheck failure is discarded.

The native DAG projects the sanitized list into project_test_failure with
only phase and failed_test_file_count (1..8). Both native diagnostic filtering
and paid-artifact filtering preserve this strictly bounded public summary.
The public validator requires all earlier phases PASS, the named phase FAIL,
all later phases SKIPPED, project FAIL and acceptance SKIPPED. It rejects
extra summary keys and invalid counts. No paths, test titles, assertion text,
source, logs or credentials are added to the public artifact. Absence of the
summary is not a PASS or proof that no assertion failed.

This is additive, so old artifacts remain readable. It cannot reconstruct
the assertion or ephemeral application from run 41243217022. File count is
not an assertion count, causal attribution or repair authorization.

## Validation and remaining work

38 focused tests passed with pinned Node 22.15.0: real RunnerClient transport
through GiteaExecutor, Backend/Frontend phase separation and path filtering,
public native and pilot double filtering, and existing compiler/acceptance
regressions. The import check passed (584 files, 1765 relative imports).
Functional CI explicitly runs the provider transport and public projection
regressions; cumulative CI also discovers the modified test suites.

No model was called by this change. Backend/Frontend D1 eligibility remains
closed and explicitly covered by the eligibility regression. Next: pass
verified private diagnostics through the original-root repair feedback,
bound source candidates to original signed writer grants, and demonstrate a
real free Backend FAIL -> new signed D1 -> source repair -> exact-SHA Docker
PASS -> root revocation -> draft-only PR. Do not schedule a paid retry based
on this diagnostic checkpoint alone.
