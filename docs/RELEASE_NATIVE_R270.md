# R270 — Native Engineer release verification checkpoint

Branch: `refactor/post-prof-plan-contracts-20261021`.
Parent: `ea523820967396f9bbc5fd672877a578ae373ec1`. This release checkpoint is intentionally **free of
Gemini/OpenAI inference**. GitHub Actions verifies the actual R270 commit SHA,
not the parent or historical proof SHAs.

## Architecture being proved

- Trusted Software Engineer directly invokes one in-process Rust Node-API
  `CryptoRuntime` for root issuance and revocation.
- Orchestrator/Agents use strictly scoped, task-local MCP for cryptographic
  operations and Gateway FunctionTools for repository/Runner effects.
- Gateway has a separate public-only Rust verifier with live EVM trust/status,
  policy enforcement via OPA, and no private root issuing capability.
- No Shared MCP HTTP routing, private worker HTTP, or legacy Adapter HTTP is
  started in the canonical native DAG or D1 workflows.
- Manual Gemini D0/F1 workflow infrastructure was migrated in R267–R269
  to the same direct-Rust topology, with explicit consent and exact-SHA gate.
  A successful free CI is **not** evidence of any successful billed Gemini
  autonomous coding or repair run.

## Required exact-SHA status

- `fast-ci.yml`: Fast CI includes current R267–R269 manual-Gemini
  consent, native owner selection and workflow source-boundary assertions.
- `engineer-direct-native-evm-e2e.yml`: standalone EVM/root/VP proof.
- `engineer-embedded-signed-dag-e2e.yml`: Gitea/OPA/Docker signed DAG.
- `engineer-embedded-signed-d1-e2e.yml`: signed independent D1 recovery,
  repaired SHA, unmerged review PR.

These four workflows must all report `completed/success` on exactly the
same R270 SHA before the manual paid gate can be considered eligible.
The old Adapter-based `functional-signed-dag-e2e.yml` and
`ts2724-signed-d1-targeted.yml` remain historical compatibility proof,
**not** the current Gemini release gate.

## Remaining noncanonical compatibility

The old Rust Adapter HTTP executable and historic workflow fixtures remain
in source. They are not invoked by the canonical native workflows and must
not be deleted indiscriminately: the common Rust crypto crate is required
by the direct Node-API addon. A separate import/CI caller migration is
needed for physical retirement without sacrificing negative security tests.

No main merge, automatic PR merge, or billed model dispatch is authorized
by this checkpoint.
