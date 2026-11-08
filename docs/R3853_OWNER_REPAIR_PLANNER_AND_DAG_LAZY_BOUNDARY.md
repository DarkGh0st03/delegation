# R385.3 — Recovery storico: planner e controller DAG caricati solo dopo Test FAIL verificato

Data: 8 novembre 2026. Branch `refactor/post-prof-plan-contracts-20261021`,
PR #38 Draft. Nessuna chiamata Gemini a pagamento.

## Audit del confine owner

`poc/packages/orchestrator-runtime/src/trusted-owner-operational-repair-handoff.ts`
importava **staticamente** sia
`TrustedOperationalRepairPlanner` da
`trusted-operational-repair-planner.ts` sia
`executeTrustedAdmittedRepairDag` da
`trusted-repair-dag-controller.ts`. Il modulo owner e' usato
anche quando non si presenta un vero Test FAIL, oppure quando
l'owner sceglie la continuazione personalizzata e **non** richiede
un repair DAG. L'import del solo owner attivava inutilmente
le dipendenze storiche di planning e dispatch.

Il contratto autoritativo resta: Root del Software Engineer su
Core Rust, originale piano Ed25519 approvato, Test FAIL
indipendentemente attestato dal Gateway, nuova epoch sotto
**la stessa Root**, e nessuna attestazione Docker PASS o PR dal
solo messaggio A2A.

## Modifica applicata

1. L'import runtime del planner e' sostituito da
   `import type {TrustedRepairModelInput}`. La classe viene
   caricata con `await import()` all'interno della continuazione
   `structured`, **dopo** `prepareTrustedRemoteRepairFeedback`
   (Test FAIL gia' finalizzato e verificato), il controllo
   dell'epoch storico e le eventuali discovery original-root-bound.
   Dopo l'await vengono ricontrollati `verifyLiveRun` (se
   disponibile), `coordinator.phase`, ID della Root originale e
   digest immutabile del piano firmato.
2. Il controller `executeTrustedAdmittedRepairDag` conserva
   i suoi tipi via `import type`; il modulo runtime viene caricato
   soltanto se l'owner ha esplicitamente configurato
   `executeAdmittedRepairDag`, se `admitReservedEpoch===true`
   e **dopo** la risposta `gateway_epoch_admitted` con
   digest ed epoch verificati. Anche dopo questo import viene
   ripetuta la liveness GitHub e riconfermata la stessa Root Rust
   prima di invocare il vecchio DAG.
3. Non cambia `isTrustedOwnerRepairPlannerConfig`, il vincolo
   `TrustedAdkOperationalRepairProposer instanceof` o i tipi
   delle porte owner esistenti. Un callback custom non carica
   il planner, e la sola riserva D1 non carica il controller
   d'esecuzione.
4. Il risultato `repair_dag_gateway_confirmed_not_final_runner_verified`
   continua a esigere `docker_pass_verified === false` e
   `pull_request_created === false`: nessun progresso
   viene trasformato arbitrariamente in PASS o PR.

## Regressioni gratuite

Il nuovo `poc/scripts/test/r3853-owner-recovery-lazy-controller.test.mjs`
controlla gli import TypeScript cancellabili a runtime,
l'ordine Test FAIL -> storia firmata -> caricamento planner
e l'ordine epoch ammessa -> caricamento controller.
Verifica l'esistenza dei nuovi checkpoint di liveness e Root,
nonché il fatto che l'esecuzione D1 non possa attestare PASS/PR.

In Fast CI viene eseguito anche un sottoinsieme mirato di
`poc/apps/gateway/test/operational-epoch-gateway.test.ts`:
R123 originale owner, R124 repair confermato, rifiuti SHA,
scope malizioso, Root revocata e R138 owner-gate.
Il file intero non viene ripetuto; i test generativi a pagamento
non sono invocati.

## Stato e limiti

**R385.3 richiede Fast CI SUCCESS sulla SHA finale.**
L'isolamento lazy non rimuove il codice Signed DAG ancora
importato da E2E e test storici, e non prova da solo un
workflow generativo end-to-end. Rimangono audit dei
restanti caller legacy, possibili cleanup sicuri e
E2E native Rust/EVM/OPA/Gitea/Docker/MCP finale
**dopo cleanup e sulla stessa SHA**. Il pilot Gemini richiede
consenso esplicito ai costi e i gate gratuiti verdi.
Nessun merge di `main`.
