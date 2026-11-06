# R350.7 — independent Gateway completion within original Engineer owner session

R350.6 admitted the exact native Gateway and owner-created effect stager into the R349→R350 owner. This increment connects the **separate post-A2A completion gate** to that same owner. `dispatchEnrolledTask` now keeps only minimal pinned Task IDs from a valid `a2a_report_not_gateway_completed` report: this does **not** mark any Task completed.

`attestEnrolledTaskCompletion({taskId,runtimeTaskId})` refuses arbitrary success assertions, HEADs, credentials or receipts. It can be invoked only for a Task whose A2A report the owner actually observed, and then invokes the original in-process A2A owner's `attestIndependentGatewayCompletion`. The latter calls the existing original Gateway `attestTrustedTaskCompletion`, which demands the independent durable native Task flight, an owner-trusted authenticated provider/Runner evidence observer, and exact root/Child/Task/provenance correlation. A2A text/artifacts cannot satisfy this verification.

The attempt is one-shot, root is checked both sides of the asynchronous observer, ambiguous failure retires the operational root, and shutdown waits for outstanding attestation. A successful result is **only** the independently staged completion receipt, not a broad claim of application acceptance.

Offline negative regressions prove no completion can be requested without a matching A2A dispatch and forbid forged success fields. The existing R331 native full-chain E2E separately demonstrates real Rust VP/OPA/Gitea/Docker completion against its own authority-only session. A single R349-reviewed native run through this exact owner remains the next evidence gate.

No paid Gemini, `main` change or PR merge.
