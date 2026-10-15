# Controlled Docker Runner and trusted Security CI

The Runner receives only a structured, authenticated operation from the Gateway: exact `repository`, `feature/account-suspension` branch, `commit_sha`, `request_id`, `profile=poc-default`. It does **not** accept agent-defined shell commands.

## Exact-SHA validation

`src/isolated-executor.ts` checks Gitea's branch HEAD against the requested SHA, downloads that immutable archive and executes fixed steps in an isolated Docker container:

1. Dependency installation and Playwright Chromium setup.
2. TypeScript type checking.
3. Backend unit tests.
4. Frontend unit tests.
5. Application build.
6. Playwright end-to-end tests.

It separately runs researcher-owned acceptance from `poc/runner/acceptance/`, outside the agent-editable repository. **Both** the application test pipeline and independent acceptance must pass.

## Independent trusted CI

`src/trusted-security-ci.ts` posts `pending`, then `success/failure/error` for the exact Gitea feature SHA under a separate CI identity. A passing Test Agent `run_tests` result is not a human review and not a merge.

The coordinator creates a PR only after the Test Agent's checks. The merge gate requires a genuine human review on the exact SHA and independent trusted CI, as documented in `docs/human-approved-gitea-merge.md`.

## Safe offline tests

```bash
npm --prefix poc run test -w @thesis/test-runner-controller
```

The automated *scripted* real-Docker E2E is `.github/workflows/shared-mcp-real-positive-e2e.yml`; the one verified *real-Gemini* end-to-end run is [38379922436](https://github.com/DarkGh0st03/delegation/actions/runs/38379922436). Neither test proves production-grade security or performs a genuine human merge.

The privileged `security-ci:run` CLI must not run against persistent Gitea without reviewed service identities and configuration.
