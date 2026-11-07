# R368.2.0 — Native original-owner evidence pin hardening

The R367.2.1 native three-role adaptive proof runs real Rust/EVM,
OPA, Gitea read/CAS and Docker PASS. The original Review Host R368.1
has real SDK A2A/ADK and independently verified Test readiness,
using offline provider fixtures.

One missing integration boundary: the original Review Host could accept
an authenticated mutation observer whose declared repository matched
the operational root while its private GiteaClient pointed at another
repository. Now the observer's private brand, repository, branch and
the **actual pinned GiteaClient** all have to match. This is the same
identity fence used by the independently attested Runner PASS observer.
The Review Host enforces it before granting access to native staging.

Negative regressions cover foreign private Gitea clients, foreign
repository/branch and prototype forgery.

This is a native integration **precondition**, not yet the combined
original Review Host + real native Rust/EVM/OPA/Gitea/Docker E2E.
No broader grant, paid inference, legacy adapter, merge or main change.
