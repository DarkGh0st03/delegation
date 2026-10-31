# R151.77 — acceptance failure diagnostics

The fifth paid pilot, run 41232456020 on d820176c5bdd25c603b4d1f30c10c3b60a912231,
passed the six candidate project phases and failed researcher acceptance. The
saved report contains no failed check identifier. It cannot establish which
assertion failed. Its logs also show additional paid D1 repair was disabled.
Do not rerun a paid workflow to recover this lost evidence.

This checkpoint adds a researcher-owned Playwright reporter alongside the line
reporter. It reports only eight fixed requirement identifiers: admin_suspend,
admin_reactivate, duplicate_transitions, ui_state_actions, ui_pending_actions,
shared_lifecycle_states, service_persistence and rest_auth_isolation. Test
assertions, test ordering and pass/fail criteria remain unchanged. A failed
check identifier labels the test, not a particular assertion or proven root
cause. Hooks/setup can also cause that test to fail.

The Runner extracts a bounded summary from the controlled command output. The
Gateway validates fixed identifiers and only forwards it for acceptance FAIL
following project PASS, retaining exact request/SHA binding. The native DAG and
pilot artifact both revalidate the summary. Assertion text, source, file paths,
credentials and raw logs are not included. Timeout and unclassified failure
flags remain explicit. Missing diagnostics never mean PASS.

These are observations, not authorization or cryptographic proof of a causal
repair target. Application output can impersonate diagnostic output; the labels
must never grant scope or select a trusted writer without independent checks.
The existing paid D1 proposer still requires verified TypeScript diagnostics.
This commit does not enable acceptance recovery and does not make the next paid
pilot ready.

Validation: 76 local Node tests passed (all test-runner-controller tests plus
Gateway runner-client tests). This includes exact-SHA acceptance FAIL with
project PASS, container cleanup, reporter classification, catalog coverage,
malformed data and pilot artifact filtering. Docker is unavailable in the local
workspace; Docker integration validation must come from the free CI workflows
on this commit. No Gemini generation was performed.

Next: demonstrate these diagnostics in the free Docker negative control, then
add an acceptance FAIL -> fresh signed repair epoch -> exact-SHA PASS fixture.
Only actionable, non-timeout, independently attributed failures may enter that
path. Keep the original Rust root subset, fresh child credentials, existing
Gateway/OPA checks and review-only PR behavior. A further paid pilot requires
separate explicit economic authorization, including D1 if recovery is intended.
