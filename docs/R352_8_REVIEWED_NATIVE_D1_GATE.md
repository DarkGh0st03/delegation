# R352.8 — Reviewed Engineer native D1 gate

Adds opt-in `R3528_NATIVE_D1_RETEST=1` to the existing R331 reviewed-native proof and a dedicated free workflow. The default R351.5 positive path remains unchanged.

The disposable owner injects the known TypeScript failure before Engineer approval. The original authenticated Engineer host performs all subsequent Task decisions, Child enrollment, private A2A dispatch and independent Gateway completions: original Docker FAIL, ADK repair proposal, durable one-shot D1 admission, Backend CAS repair, fresh ADK Test and real Docker/acceptance PASS. The original failed Test remains incomplete. The test requires five distinct native Children, four completed Tasks out of five, three CAS writes and two Runner calls under the unchanged root. Forged instructions, premature retest and replay are denied.

This remains a scripted known-error repair in an owner-preseeded application, not autonomous Gemini diagnosis or functional generation. No paid inference is configured.

Validation: syntax and diff checks pass locally. The review-host suite has 31 passes, 10 environment-blocked Unix-socket tests (listen EPERM), and one CI-only skipped test locally. Native PASS and complete offline CI PASS must be verified in Actions before claiming this gate complete.
