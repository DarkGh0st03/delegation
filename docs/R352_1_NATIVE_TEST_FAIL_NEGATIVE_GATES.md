# R352.1 — Fail-closed negative integration gates

Two additional free regression variants extend the exact R352.1 three-role ADK/A2A session.

A valid RunnerClient returns FAIL and the original Gateway has its one-shot Test intent and durable flight, but the authenticated FAIL MAC receipt is absent. The original owner must retire the root, keep the Test uncompleted and reject all D1 model proposals.

In the second case the original Runner FAIL receipt is MAC-authenticated and independently observed. The ADK model selects Frontend rather than the independently preflighted Backend role. The owner denies the proposal without granting a new Task or Child and consumes the one-shot D1 model budget.

Both variants are offline fixtures: no paid models, no external Gitea writes or actual Docker FAIL. They prove a provider/A2A FAIL alone cannot authorize a recovery.
