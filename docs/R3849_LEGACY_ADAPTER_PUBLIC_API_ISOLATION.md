# R384.9 — Isolamento dell'HTTP Adapter storico dall'API pubblica

8 novembre 2026 — `refactor/post-prof-plan-contracts-20261021` (PR #38 Draft).

## Problema

Il runtime pubblico `@thesis/orchestrator-runtime` riesportava
`SoftwareEngineerAuthorityBootstrap` da `authority-client.ts`.
Quest'ultimo utilizzava `authority-adapter-transport.ts` per inviare
richieste HTTP `POST /v1/credentials/root` e
`POST /v1/credentials/status`. Tale percorso e' **storico**: non
e' l'attuale integrazione diretta Engineer/Gateway con il Core Rust,
che resta parte della architettura authority-only.

Un import del pacchetto runtime poteva quindi esporre un client
legacy operativo oltre ai contratti dati che sono ancora utili.

## Modifiche di codice

1. Creato `src/trusted-credential-contracts.ts` con **soli tipi**:
   `CredentialStatusInput`, `RootIssuanceInput`,
   `ChildIssuanceInput` e `IssuedDelegationCredential`.
   Nessun fetch, socket, side effect o import dell'Adapter.
2. `src/index.ts` ora riesporta tali tipi dal contratto neutrale
   con `export type`; ha **rimosso il runtime export** di
   `SoftwareEngineerAuthorityBootstrap`.
3. `authority-client.ts` mantiene la classe **solo per import
   diretti** di compatibilita' e ri-esporta gli stessi tipi, senza
   duplicarne le definizioni.
4. `authority-adapter-transport.ts` importa i tipi soltanto
   da `trusted-credential-contracts.ts`: il precedente riferimento
   ciclico al client non e' piu' presente.
5. I test di `authority-client.test.ts` importano esplicitamente il
   vecchio client, conservano le verifiche negative di ampliamento
   dei permessi e revoca e ora richiedono che l'API pubblica non
   offra alcun client HTTP di emissione. Fast CI esegue il test.
   Un'ulteriore regressione in
   `trusted-authority-only-legacy-retirement.test.mjs`
   controlla i confini statici dei tre moduli.
6. L'inventario R6 traccia anche gli importatori reali
   di `authority-client.ts` e dell'Adapter (test, source e
   import indiretti): **l'assenza di caller osservati non
   autorizza cancellazioni**.

## Invarianti e limiti

- Restano invariati Core Rust, issuer/verifier, Gateway, OPA, MCP
  crittografico per Child/VP, Engineer Ed25519, Runner, CAS e Draft PR.
- La precedente API HTTP non viene eliminata per non cancellare le
  regressioni e i consumatori che possono importarla direttamente.
- Questa separazione non attesta ancora che tutti gli importatori
  indiretti degli altri moduli DAG/repair siano stati migrati.
- Nessun pilot Gemini o operazione pagata; nessun merge di `main`.
- Il checkpoint richiede Fast CI verde **sulla SHA finale di R384.9**.
  L'E2E nativo end-to-end rimane obbligatorio **a fine cleanup**,
  non e' sostituito dai test veloci.

## Prossima migrazione

Analizzare gli importatori storici dell'handoff GitHub/scripted/fresh
repair e scegliere il confine di conservazione dei test in modo da
non indebolire la revoca di Root, l'approvazione indipendente e
l'osservazione di fallimenti del Runner.
