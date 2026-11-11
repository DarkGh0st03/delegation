# OPA Policy Engine — current Account Suspension PoC

The Gateway runs the trust-boundary sequence:

```text
Gateway prepare → signed VP → Rust DelegationVerifier → OPA Rego decision
    → Gateway-controlled Gitea/Runner execution
```

OPA decides *contextual* authorization independently of the cryptographic DC permission. The Gateway constructs the policy input from its prepared request and the structured `VerifiedDelegation`; model-controlled tool arguments cannot supply an arbitrary trusted role or verified permission.

The policy in `policy.rego` is default-deny and **parametric per repository**. Its parameters are the data document `data.thesis.console_repositories`, keyed by the canonical repository URI (`gitea://gitea.local/<owner>/<repo>`) and published by the Engineer console:

- `base_branch` and `protected_branches`: never modified by agents; Planning may only read the base branch;
- `work_branch_prefix`: the Engineer-signed session work branch must carry it and must not be protected;
- `forbidden_path_prefixes`: paths agents may read but never update or create;
- `runner_profile`: the only Runner profile accepted;
- `allow_pull_request`: whether a Draft PR may be opened (agents can never merge).

For authority-only sessions the Gateway injects `session_work_branch` from the **signed operational authority**, never from tool arguments, and OPA allows file, branch, Runner and PR operations only on exactly that branch. A built-in entry keeps the original `thesis/iam-console-poc` fixture (`feature/account-suspension`) for CI and the scripted native E2E when the console has published no parameters for it. An allowed tool name alone is not sufficient to modify a file: the Agent must also hold the exact ResourceUri/Operation authority verified by Rust.

OPA returns an allow/deny decision to the Gateway; **OPA does not forward tool calls or execute repository operations**.

```bash
bash poc/scripts/phase4a-policy-test.sh
```

The `phase4a` filename is historical but this offline Rego regression is **still used** by the current active baseline validation workflow.
