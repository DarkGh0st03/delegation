# Thesis PoC integration workspace

This directory contains the TypeScript/Node.js integration layer for the thesis PoC. The Rust delegated-authorization core remains in the repository root and will later be exposed through `services/delegation-adapter/`.

Planned structure:

```text
poc/
├── apps/
├── packages/
├── opa/
├── runner/
│   └── acceptance/
├── infra/
│   ├── gitea/
│   └── env/
└── scripts/
```

Phase 0B only scaffolds the workspace and continuity documents. No Agent, Gateway, OPA, Gitea, Runner, or Adapter business logic is implemented yet.

Implementation order: infrastructure -> Rust Adapter -> Gateway -> OPA -> Gitea -> Controlled Test Runner -> deterministic A2A -> LLM Agents -> Orchestrator -> positive E2E -> negative/security validation -> reproducibility and measurements.

Run the scaffold sanity check with:

```bash
npm --prefix poc run check:scaffold
```
