# OPA Policy Engine — current Account Suspension PoC

The Gateway runs the trust-boundary sequence:

```text
Gateway prepare → signed VP → Rust DelegationVerifier → OPA Rego decision
    → Gateway-controlled Gitea/Runner execution
```

OPA decides *contextual* authorization independently of the cryptographic DC permission. The Gateway constructs the policy input from its prepared request and the structured `VerifiedDelegation`; model-controlled tool arguments cannot supply an arbitrary trusted role or verified permission.

The policy in `policy.rego` is default-deny and scoped to `thesis/iam-console-poc`, the protected `main` and `feature/account-suspension`, fixed role/tool constraints and `run_tests(profile=poc-default)`. An allowed tool name alone is not sufficient to modify a file. The Agent must also have the exact ResourceUri/Operation authority verified by Rust.

OPA returns an allow/deny decision to the Gateway; **OPA does not forward tool calls or execute repository operations**.

```bash
bash poc/scripts/phase4a-policy-test.sh
```

The `phase4a` filename is historical but this offline Rego regression is **still used** by the current active baseline validation workflow.
