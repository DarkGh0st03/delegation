# R151.83 — Project E2E shared-state isolation and bounded diagnostics

## Verified starting point

HEAD R151.82 (006ef4f9102961b3267e209d6bf9f2d59292ebfe) has successful
Cumulative run 41275264373 and Shared MCP run 41275264371, but Functional
run 41275264372 failed. Its first acceptance recovery reached Docker PASS;
the next multi-TypeScript recovery passed typecheck and all other preceding
project phases, then failed playwright_e2e. The historical assertion was
not retained. This report does not establish that assertion or its cause.

## Shared mutable service found in the immutable fixture

The baseline repository iam-console-poc at
405748b1e77992b6bd8630a3ab6f990658d32f6b has these concrete properties:

* tests/e2e/user-profile.spec.ts visits Alice and requires ACTIVE (line 8).
* The approved Account Suspension spec suspends Alice, requires SUSPENDED,
  then reactivates her and requires ACTIVE.
* Both use the one Backend process started by the controlled Runner.
* The baseline Playwright config does not set workers or isolate server
  state per worker. Its webServer entries reuse that existing Backend.
* InMemoryUserRepository stores one mutable user map per Backend process.

Thus overlapping specs can read state modified by another spec. Independent
browser contexts do not isolate the Backend. This is a concrete scheduling
hazard, not proof of the assertion that failed in the historical CI run.

The controlled project E2E command now supplies --workers=1. All project
specs still execute, with their original assertions and zero new retries.
Neither candidate source/test bytes, timeouts, compiler repair logic nor
capability grants are changed by this scheduling correction. Researcher
acceptance already uses one worker separately.

## Evidence if project E2E fails again

The Runner parses its existing bounded command output into optional
project_e2e_failure. Only two fixed fixture check IDs, numeric source
locations, six fixed error categories, actual command timeout and an
unclassified flag can leave the parser. Locations can include the test
header and stack: they are observations, not guaranteed assertion frames.
Unknown tests/errors remain explicitly unclassified. No raw source, paths,
titles, expected/received values, errors or credentials leave the filter.

RunnerClient accepts it only for the first failed phase playwright_e2e on
its already verified exact SHA. GiteaExecutor preserves it. Native and pilot
public filters independently validate the schema and require all preceding
phases PASS and acceptance SKIPPED. It grants no repair eligibility.

This change cannot reconstruct missing historical evidence. If CI passes,
it validates the new serial schedule; that is not retrospective proof of
the old failure's cause. If it fails, use the new check/line observations
before deciding on a further correction.

## Validation

56 focused tests passed on Node 22.15.0, including controlled Runner failure
and cleanup, real RunnerClient/GiteaExecutor phase binding, public double
filter rejection of malformed metadata, and compiler/acceptance regressions.
Static imports: 586 files, 1771 relative imports. Type-only contract audit:
311 files / 473 named type imports. Historical runtime audit: 14 entrypoints /
150 symbols. Functional CI now explicitly runs these Runner/diagnostic tests.

Remote free CI must still validate the actual Docker scenarios on this
commit. No paid model run is authorized or launched. Backend/Frontend test
D1 repair remains the next functional gap; R151.83 does not enable it.
