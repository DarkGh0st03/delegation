# R385.2 — Endpoint A2A puri e isolamento lazy del Signed DAG storico

Data: 8 novembre 2026. Branch `refactor/post-prof-plan-contracts-20261021`,
PR #38 Draft. Nessuna inferenza Gemini o operazione a pagamento.

## Problema osservato (inventario R384.7–R385.1)

`trusted-reviewed-approved-dag.ts` veniva importato direttamente
da tre handoff storici dell'owner:
`trusted-admitted-github-handoff.ts`,
`trusted-admitted-scripted-handoff.ts` e
`trusted-fresh-repair-reviewed-dag.ts`. Importare quei moduli
caricava quindi **anticipatamente** il controller DAG,
indipendentemente dal fatto che il trusted owner stesse per
attivare un'esecuzione approvata.

Nel percorso fresh repair, la validazione degli endpoint A2A
`pinTrustedReviewedAgentEndpoints` si trovava nello stesso
modulo del DAG, benché fosse necessaria **prima**
dell'emissione della nuova Root operativa.

## Modifiche implementate

1. Aggiunto `src/trusted-reviewed-agent-endpoint-pins.ts`:
   conserva la stessa logica di accettazione degli esatti tre
   endpoint `backend/frontend/test`, solo
   `http://127.0.0.1:<porta>` con porte sintatticamente
   limitate a cinque cifre, senza percorsi arbitrari, tutti
   distinti; restituisce una copia `Object.freeze`. Non importa
   il DAG, l'ADK, un modello o il dispatcher A2A.
2. `trusted-reviewed-approved-dag.ts` utilizza ora tale
   validatore e lo **riesporta** per i caller diretti storici.
   L'API, il messaggio di rifiuto e i permessi non cambiano.
3. `trusted-admitted-scripted-handoff.ts` carica il controller
   con `await import()` dopo aver autenticato il run e la
   sessione; dopo l'import riverifica `checkNow()`. Qualsiasi
   errore entra nel `catch` già esistente, che chiude la Root.
4. `trusted-admitted-github-handoff.ts` carica il controller
   con `await import()` **all'interno** del blocco owner
   protetto da `try/catch` e ripete `checkNow()` subito dopo.
   Un errore conserva `stop()` per il retirement del Core Rust.
5. `trusted-fresh-repair-reviewed-dag.ts` usa il modulo
   di preflight A2A **prima** del primo effetto esterno;
   l'import del vecchio controller diventa un `import()`
   dentro il blocco protetto, **prima** di
   `beginTrustedFreshRepairApprovedExecution()` e della
   nuova Root. Dopo l'import viene nuovamente verificata la
   liveness GitHub. Un `import type` mantiene soltanto la
   firma TypeScript del valore restituito.

## Regressioni gratuite

`poc/scripts/test/r3852-reviewed-dag-runtime-isolation.test.mjs`
verifica che il validatore sia una copia pura della precedente API
e ne testa endpoint errati, duplicati, non-localhost, porte
invalide, immutabilità e pinning prima della Root.
Il test controlla anche che tutti gli import runtime del DAG
avvengano dentro l'attivazione dell'owner, con recheck
GitHub successivo e con un percorso di revoca fail-closed.

`poc/packages/orchestrator-runtime/test/trusted-reviewed-approved-dag.test.ts`
è stato aggiunto esplicitamente a Fast CI per preservare le
regressioni dell'originale controller su firma, Gateway,
revoca e liveness. Entrambi i test sono gratuiti; **il loro
esito richiede un SUCCESS sulla SHA finale R385.2**.

## Limiti e prossimi gate

Questa è un'**isolazione del caricamento** e del validatore,
non la rimozione del vecchio DAG o una prova che il codice
non sia più raggiungibile da script/workflow storici.
I moduli restano importabili direttamente e i test negativi
vanno mantenuti. Dopo aver consolidato i caller legacy rimanenti
si dovranno eseguire Fast CI, inventario reachability finale e
un vero E2E nativo
Rust/EVM/OPA/Gitea/Docker/MCP **post-cleanup sulla stessa SHA**,
prima di proporre il pilot Gemini.

Il checkpoint non attribuisce al sistema capacità generative
non ancora verificate, non modifica `main`, non effettua merge
e non autorizza costi Gemini.
