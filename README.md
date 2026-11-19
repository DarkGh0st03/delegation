# A Novel Framework for Delegated Authorization and AI Agent Interoperability in Cloud Software Engineering Workflows

Proof of concept for a Master's thesis in Computer Engineering (University of
Salerno).

The thesis studies **delegated authorization**: how a human can hand a bounded
part of their authority to software agents, how that authority can be passed
on further (transitive delegation) while only ever shrinking, and how every
use of it can be verified before a protected resource is touched. The
delegation mechanism is built on **Delegation Credentials whose permissions are
encoded in a cryptographic accumulator**. A team of AI agents changing a Git
repository is the realistic scenario used to show the mechanism at work.

> **Status:** research prototype. It runs entirely on your machine with Docker
> and is meant to be studied, run and verified, not deployed in production.

---

## Contents

- [The delegation mechanism](#the-delegation-mechanism)
- [The scenario: a team of AI agents on a repository](#the-scenario-a-team-of-ai-agents-on-a-repository)
- [How a session works](#how-a-session-works)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Using the console](#using-the-console)
- [Running the tests](#running-the-tests)
- [Repository layout](#repository-layout)
- [Limitations](#limitations)

---

## The delegation mechanism

The core of the project is a Rust library (`src/`) that implements decentralized,
transitive delegation on top of W3C Verifiable Credentials. It derives from an
existing open-source research prototype of the Delegation Credential protocol,
adapted and extended for this work.

| Concept | What it does |
| --- | --- |
| **Delegation Credential (DC)** | A Verifiable Credential in which a delegator grants permissions to a delegatee. A permission is an *operation* on a *resource URI* (e.g. `update_file` on one file of a branch). |
| **Cryptographic accumulator** | All the permissions of a DC are folded into one constant-size accumulator value (positive VB accumulator on BN254). For each permission the delegatee holds a **witness** that proves membership. |
| **Selective disclosure** | To use one permission, the delegatee presents only that permission and its witness. The verifier learns neither the other permissions nor how many there are. |
| **Hierarchy and attenuation** | Each DC records its place in the chain. A delegatee can re-delegate only permissions it actually holds, so authority can only narrow from Root to leaf. Directory scopes let a parent grant a folder and a child receive one file in it. |
| **Verifiable Presentation (VP)** | Signed by the holder and bound to a single request (a challenge issued by the verifier), so it cannot be replayed. A VP can prove several permissions at once, all checked together. |
| **Revocation** | Credential status follows the W3C **Bitstring Status List**. The list is published off-chain and anchored on-chain, so revoking a Root immediately invalidates everything derived from it. |
| **Trust layer** | Identities are `did:ethr` DIDs (ERC-1056). An enterprise trust registry and an issuer registry on an EVM chain hold trust anchors, accumulator-material commitments and status-list anchors. Credentials, permissions and witnesses stay off-chain. |

In this proof of concept the chain looks like this:

```text
Software Engineer ──Root DC──▶ Orchestrator ──Child DC──▶ Specialist agent
   (signs the scope)            (one per Task, narrower)        │
                                                                ▼ VP bound to the request
                                    Gateway: Rust verification of the chain + OPA policy
                                                                │ allow
                                                                ▼
                                                  Git repository / test runner
```

---

## The scenario: a team of AI agents on a repository

AI agents are entering enterprise software engineering: they read code, change
it, run tests and open pull requests. When several agents collaborate on the
same project, each one should hold **only the authority its current task
needs**, and that authority should be verifiable independently of the agents
themselves.

The scenario reproduces this setting:

- a **Software Engineer** uses a web console to choose a repository and
  describe a requirement in natural language;
- an **Orchestrator** agent analyses the repository, proposes the permissions
  the work needs and, once the Engineer has approved and signed them, splits
  the work into Tasks;
- **specialist agents** carry out the Tasks, each with its own identity,
  wallet and Child credential;
- every operation goes through a **Cloud Access Gateway**, which verifies the
  credential chain in Rust and asks **Open Policy Agent** for a policy
  decision before touching the repository;
- the result is a **Draft Pull Request**. Merging stays a human decision.

| Agent | Works on |
| --- | --- |
| Orchestrator | Plans the work, creates the branch and Tasks, issues Child credentials, opens the Draft PR |
| Backend | Server-side code, APIs, shared contracts |
| Frontend | User interface code and styles |
| Documentation | README and documentation |
| Data | Seed data, schemas, migrations |
| DevOps | Dockerfile and build configuration |
| Test | The project's test sources; the only role that may run the tests |

The agents use Google ADK with Gemini models and talk to each other over the
A2A protocol. A2A carries the work; the credentials carry the authority, and
the two are verified separately.

---

## How a session works

1. **Planning (read-only).** The Engineer's key issues a *preliminary Root*
   that only allows reading the repository. The Orchestrator reads the code
   through the Gateway and proposes a list of permissions.
2. **Approval.** The Engineer reviews the proposal and can only **remove**
   permissions, never add them. Signing (Ed25519, unlocked by the Engineer's
   password) also binds the repository's **test profile**: the commands that
   define what "the tests pass" means.
3. **Execution.** The preliminary Root is revoked and an *operational Root*
   with exactly the signed permissions is issued. The Orchestrator delegates
   one Task at a time with a Child DC holding only that Task's permissions
   (up to 15 reads and one write). Every operation is a VP checked by the
   Gateway: Rust verification, status check, OPA decision, then execution.
4. **Tests.** The Test agent writes tests for the new behaviour and asks for a
   test run. An isolated runner executes the signed test profile on the exact
   commit. When a test fails, the Orchestrator uses the reported errors to
   assign a repair, within the same signed permissions.
5. **Draft PR.** Only after every phase of the test profile passes on the
   final commit does the Orchestrator open a Draft PR. The Root is then
   revoked. The Engineer can preview the PR branch as a running application,
   then merge it in Git; after the merge, the new `main` is deployed to a local
   staging environment.

---

## Architecture

Everything runs locally with Docker Compose:

| Service | Role | Address |
| --- | --- | --- |
| `app` | Engineer console (**Sigillo**); for each session it starts the Gateway, the Orchestrator, the specialist agents and their wallets | http://127.0.0.1:8700 |
| `gitea` | Git server holding the repositories the agents work on | http://127.0.0.1:3000 |
| `opa` | Open Policy Agent, per-repository policy | http://127.0.0.1:8181 |
| `anvil` | Local EVM chain for the trust layer (DIDs, registries) | http://127.0.0.1:8545 |
| `runner` | Runs a repository's tests in throw-away containers | internal only |
| `staging` | Builds and serves merged `main` and Draft PR previews in isolated containers | apps on 127.0.0.1:8801+, previews on 127.0.0.1:8901+ |
| `setup`, `gitea-users`, `gitea-bootstrap`, `trust-bootstrap` | One-off preparation: private configuration, accounts and tokens, on-chain contracts | exit when done |

All ports are bound to `127.0.0.1` and are not reachable from other machines.

Main design choices:

- **Models propose, the delegation system decides.** Model output is
  validated and treated as a proposal; authority comes only from the
  Engineer's signature and flows down the credential chain.
- **One wallet per role.** The Orchestrator and each specialist have their own
  wallet process that holds only that role's signing key (its public key is
  published on-chain). A wallet refuses a credential that was not delegated
  to its identity.
- **Two independent checks.** An operation needs a permission in the verified
  chain *and* an OPA allow decision. Repository policy (protected branches,
  paths agents may not modify, Draft PR allowed) is data edited by the
  Engineer, not code.
- **Repository content is data, not authority.** Files, logs and test output
  can guide the agents but never grant permissions.

Design decisions are recorded in
[`docs/ARCHITECTURE_DECISIONS.md`](docs/ARCHITECTURE_DECISIONS.md).

---

## Getting started

### Requirements

| Requirement | Notes |
| --- | --- |
| **Docker** with Compose v2 (`docker compose`) | Linux: Docker Engine. Windows: Docker Desktop with the WSL 2 backend. macOS: Docker Desktop. Nothing else needs to be installed on the host: Rust, Node.js, Foundry and OPA are built or pulled inside the images. |
| **Git** | To clone this repository. |
| **A GitHub account** | The console imports repositories **only** from the account set in `.env`. Public repositories need no token. |
| **A Gemini API key** | Sessions use Gemini (default `gemini-3.8-flash`). Calls are **paid**; each session is capped by call and token limits, but set a spending limit in your Google project as well. |
| **Free local ports** | 3000, 8181, 8545, 8700, and 8801+ / 8901+ for the staged apps. |
| **Disk space and time** | The first build downloads the base images and compiles the Rust modules: allow several minutes and a few GB of disk space. |

### 1. Clone and configure

```bash
git clone https://github.com/DarkGh0st03/delegation.git
cd delegation
cp .env.example .env
```

Edit `.env` (it is ignored by Git):

| Variable | Required | Meaning |
| --- | --- | --- |
| `ENGINEER_PASSWORD` | yes | Password of the console user (at least 8 characters). It also unlocks the Engineer's signing key. |
| `ENGINEER_USERNAME` | no | Console user name, `engineer` by default. |
| `GITHUB_OWNER` | yes | Your GitHub user name: the only account repositories can be imported from. |
| `GITHUB_TOKEN` | no | Read-only fine-grained token ("Contents: read"), only for private repositories. |
| `GEMINI_API_KEY` | yes, to run sessions | Your Gemini API key. It reaches only the `app` service, never the agents. |
| `GEMINI_MODEL` | no | `gemini-3.8-flash` by default. |
| `INITIAL_REPOSITORY_URL`, `INITIAL_REPOSITORY_SHA` | no | A public repository to import automatically on first start, optionally pinned to a commit. |

### 2. Start

```bash
docker compose up -d --build
```

Check that the preparation services finished (`Exited (0)`) and the others are
running:

```bash
docker compose ps -a
```

### 3. Open the console

Go to **http://127.0.0.1:8700** and sign in with `engineer` and your password.
The gear icon shows the state of every component; start a session when it is
green.

### Stop, restart, reset

| Command | Effect |
| --- | --- |
| `docker compose down` then `docker compose up -d` | Correct restart. The local chain starts empty at every start and identities are registered again, so always restart the whole stack. |
| `docker compose down` | Stops everything, keeps the data. |
| `docker compose down -v` | Deletes everything, including repositories, keys and configuration. |
| `docker compose logs -f app` | Console and session logs (`staging`, `runner` for the other services). |

A step-by-step guide in Italian, with troubleshooting, is in
[`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md).

---

## Using the console

1. **Import a repository** from your GitHub account. To try the demo
   projects, fork one of them into your account first:
   - [iam-console-poc](https://github.com/DarkGh0st03/iam-console-poc), a small
     identity-management web app (backend, frontend, end-to-end tests);
   - [campus-library](https://github.com/DarkGh0st03/campus-library), a web app
     with data, documentation and a Dockerfile, which involves all six
     specialists;
   - [unit-convert](https://github.com/DarkGh0st03/unit-convert), a library
     without a user interface.
2. **Configure the policy and the test profile** ("Configura policy"):
   protected branches, paths the agents may not modify, Draft PR allowed, and
   the test profile (Docker image, ordered test phases, test folders). A
   repository can declare its own profile in `.github/test-profile.json`;
   otherwise an npm template (`npm ci`, `npm test`) is proposed.
3. **Publish the app** (optional). The console detects whether the repository
   has a web interface and proposes how to build and start it. After every
   merge the staging service deploys the new `main`, opened with "Apri l'app".
4. **Write the requirement** and send it. Follow the session live: Planning,
   approval dialog, Tasks and Gateway decisions, test runs, Draft PR.
5. **Review** the Draft PR in Gitea and its running preview, then decide
   whether to merge.

The session page shows two diagnostic tables side by side: **Gemini calls**
(what the models proposed, with tokens and timings) and **Gateway decisions**
(what was actually allowed or denied, and why).

---

## Running the tests

The unit tests make no paid model calls. With Node.js 22 and Rust installed
locally:

```bash
npm --prefix poc ci --ignore-scripts --no-audit --no-fund
npm --prefix poc run console:test
npm --prefix poc run gateway:test
npm --prefix poc run agent-runtime:test
npm --prefix poc run orchestrator-runtime:test
npm --prefix poc run orchestrator:test
npm --prefix poc run plan-contracts:test
npm --prefix poc run runner:test
npm --prefix poc run opa:test
cargo test --locked
```

The same tests run in CI on every push (`.github/workflows/tests.yml`).

---

## Repository layout

| Path | Content |
| --- | --- |
| `src/` | Rust delegation core: Delegation Credentials, accumulators, presentations, verification, status lists, trust resolution |
| `services/` | Native Rust modules for the Engineer (issuance, revocation), the Gateway (verification) and the role wallets |
| `blockchain/` | Trust-layer contracts (DID registry, enterprise trust registry, issuer registry) |
| `poc/engineer-console/` | Sigillo console: web UI, sessions, policy and test profile, staging |
| `poc/apps/orchestrator/` | Planning, signed review and the assembly of an execution |
| `poc/packages/orchestrator-runtime/` | Orchestrator Task decisions |
| `poc/packages/agent-runtime/` | Specialist agents (Google ADK, A2A) |
| `poc/packages/plan-contracts/` | Shared contracts: agent roles, test profile, permissions |
| `poc/apps/gateway/` | Cloud Access Gateway |
| `poc/opa/` | OPA policy (Rego) |
| `poc/apps/test-runner-controller/`, `deploy/runner/` | Test runner |
| `deploy/staging/` | Staging and Draft PR previews |
| `compose.yaml`, `deploy/Dockerfile` | Local deployment |
| `docs/` | Local setup guide, architecture decisions, measurements |

---

## Limitations

This is a proof of concept. Known simplifications:

- the Engineer's signing key is kept by the `app` container and unlocked by
  the password, not by a personal hardware key;
- the Gateway, the Orchestrator, the agents and their wallets run as separate
  processes inside the same container; separate containers on isolated
  networks are the next step;
- the `runner` and `staging` services mount the host Docker socket, which is
  equivalent to root on the host;
- the local chain restarts empty at every start, so sessions from before a
  restart are no longer active;
- Gemini limits apply to calls and tokens, not to money.
