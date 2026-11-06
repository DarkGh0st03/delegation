# R353.0 — Original Engineer owner reads a verified tested HEAD for the PR gate

The existing Runner completion observer now exposes an owner-only tested-head projection from the same authenticated PASS receipt. It verifies MAC, original Task/Child/root binding, project tests, researcher acceptance and independent current Gitea HEAD before returning the tested SHA. Existing completion reads still use the private verifier and cannot be redirected by replacing the public projection method.

The original Engineer host accepts an optional repository/branch-pinned Runner PASS observer alongside its original native effect dependencies. Its new private `inspectVerifiedPullRequestHead({taskId,runtimeTaskId})` requires the original independently completed latest Test, obtains the exact attempted Runner intent from the original preflight/journal and reopens the authenticated evidence. Neither a caller nor a model can supply a SHA, receipt, credentials or a PASS boolean. An old PASS cannot supersede a newer unfinished Test. Root/session changes during the read invalidate the result.

The positive original-session SDK regression exercises the normal Test PASS and the replacement D1 Test PASS, then inspects the exact feature HEAD. It rejects an A2A-only PASS, the original failed Test, injected SHA, moved HEAD and an older Test after a newer Test is staged. The Gateway observer tests cover missing/tampered evidence, foreign root, wrong repository/branch and projection overrides.

Scope: read-only evidence integration, not PR authorization or provider execution. The canonical Gateway still rejects create_pull_request. Next connect this evidence to a new original-root PR Task/Child, durable one-shot intent and native Rust/OPA/provider execution. No new native Docker run or paid inference is requested by this checkpoint; R352.9 remains the confirmed native recovery evidence.

## R353.1 successful Runner journal projection

The first integrated CI found that the existing `getAttemptedIntentForOwnerTask` is intentionally a FAIL-only API: it rejects a journal with successful completion. The PR read now uses a separate `getCompletedIntentForOwnerTask`, backed by exact original intent/POST/completion rereads and the durable verified receipt digest. The authenticated Runner receipt must match that digest. The FAIL path retains its existing PASS-conflict rejection. Targeted journal/PASS/FAIL regressions: 18 PASS locally; integrated Engineer CI must confirm the successful original-session path.
