# R384.7 — Reachability e ritiro dei workflow Gemini storici

Data: 8 novembre 2026. Branch: `refactor/post-prof-plan-contracts-20261021`.
Questo audit e' un **inventario conservativo**, non una conferma che i
moduli senza caller osservati siano cancellabili. Non avvia Gemini, non
autorizza nuove credenziali e non modifica `main`.

## Interventi confermati

I due job di `.github/workflows/gemini-paid-shared-mcp-final.yml`
erano gia' stati disabilitati in R384.6. R384.7 aggiunge
`if: ${{ false }}` a:

- `.github/workflows/gemini-real-gitea-planning-only.yml`:
  `real-planner` (il solo job potentially billed; il job di registrazione
  `register-no-inference` resta gratuito su push).
- `.github/workflows/gemini-planner-manual-feasibility.yml`:
  `read-only-planner` (sono disattivate anche le modalita' sperimentali
  `dry-run` e `api-check` di quel workflow, senza rimuovere i test offline).

`.github/workflows/f1-paid-real-gitea-once.yml` era gia' one-shot,
disabilitato con `if: ${{ false }}`. Le regressioni verificano questi
quattro file e i job billable senza effettuare alcuna chiamata API.

Evidenza gratuita: Fast CI R384.7
[run #42428657867](https://github.com/DarkGh0st03/delegation/actions/runs/42428657867)
**SUCCESS** sulla SHA `311cda3387b7cffa652b33bfc46b2bdcc92b326e`.
Un commit successivo necessita della propria Fast CI.

## Dipendenze identificate da R6 (SHA 311cda33)

Sono elencati **solo gli importatori ESM diretti verificati**
dall'inventario. Non vengono confusi con import transitivi, comandi shell,
`import()` calcolati o altri 112 indizi di indirection non risolti.

### 1. `trusted-reviewed-approved-dag.ts`: 5 importatori

Source:
- `trusted-admitted-github-handoff.ts`
- `trusted-admitted-scripted-handoff.ts`
- `trusted-fresh-repair-reviewed-dag.ts`

Test:
- `trusted-planning-review-gate.test.ts`
- `trusted-reviewed-approved-dag.test.ts`

**Esito:** non eliminabile oggi. L'API canonica `index.ts` esporta
`trusted-admitted-github-handoff.ts`: quindi il vecchio DAG ha anche
una reachability **transitiva**, nonostante il launcher authority-only
non lo importi direttamente. Prima migrarne e testarne i consumatori.

### 2. `trusted-operational-repair-planner.ts`: 3 importatori

Source:
- `trusted-owner-operational-repair-handoff.ts`

Test:
- `apps/gateway/test/operational-epoch-gateway.test.ts`
- `trusted-verified-discovery-repair-input.test.ts`

### 3. `trusted-repair-dag-controller.ts`: 3 importatori

Source:
- `trusted-owner-operational-repair-handoff.ts`

Test/native fixture:
- `apps/gateway/native-test/native-planning-read-core-evm-e2e.mjs`
- `apps/gateway/test/operational-epoch-gateway.test.ts`

**Esito 2-3:** l'owner di recovery storico e' ancora accoppiato a
planner e controller DAG; la migrazione non deve indebolire la gestione
di fallimenti autenticati e revoca/retirement della Root.

### 4. `authority-adapter-transport.ts`: 1 importatore

Source:
- `authority-client.ts`

`authority-client.ts` e' ancora riesportato da `src/index.ts`
attraverso il trusted Engineer bootstrap. Non classificare il trasporto
come codice morto prima di una migrazione esplicita dei caller di
bootstrap. Conservare il core Rust diretto e le regressioni del
profilo legacy HTTP disabilitato.

### 5. `run-trusted-gemini-owner.mjs`: 3 importatori + 2 hint

Source:
- `apps/orchestrator/src/canonical-owner-deployment.mjs`

Test:
- `apps/orchestrator/test/run-trusted-gemini-owner.test.mjs`
- `apps/orchestrator/test/trusted-authority-only-legacy-retirement.test.mjs`

Due hint `new URL(...,import.meta.url)` provengono dal primo test.
**Non eliminare il file:** esporta ancora l'entrypoint canonico.
La sola API storico-Signed-DAG ora fallisce immediatamente.

## Gate prima della rimozione di codice

1. Mappare la reachability transitiva a partire da `src/index.ts`,
   `trusted-engineer-service.mjs`, entrypoint CLI/GitHub e
   `canonical-owner-deployment.mjs`. L'audit R6 osserva import
   statici/literal indirections, ma non certifica i computed import.
2. Migrare gli handoff GitHub/scripted/fresh repair storici a contratti
   authority-only o rimuovere **solo** gli entrypoint isolati dopo
   aver dimostrato che non sono necessari all'Engineer/Runner attivi.
3. Mantenere le regressioni negative utili e rimuovere i moduli storici
   soltanto quando nessun percorso operativo e nessun test rimasto ne
   dipende.
4. Eseguire Fast CI e un E2E nativo completo **dopo il cleanup**,
   sulla stessa SHA finale, prima di qualsiasi autorizzazione a Gemini.

Questa fase **non** costituisce autonomia generativa verificata,
non autorizza il pilot pagato e non abilita un merge.
