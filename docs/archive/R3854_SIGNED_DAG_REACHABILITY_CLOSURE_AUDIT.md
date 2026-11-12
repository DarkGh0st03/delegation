# R385.4 — Gate di provenienza dei moduli Signed DAG storici

Data: 8 novembre 2026. Branch `refactor/post-prof-plan-contracts-20261021`;
PR #38 Draft. Nessun merge, nessuna richiesta a un modello Gemini.

## Scopo

Dopo gli isolamenti R385.0–R385.3, non basta sapere che un modulo
storico ha pochi importatori per dichiararlo eliminabile.
La distinzione deve essere **verificabile, continuativa e fail-closed**:
un nuovo chiamante runtime, un import dinamico fuori dal trusted owner
o un workflow che riattivi i vecchi DAG deve fallire la CI gratuita.

L'audit R6 sull'ultima SHA R385.3 (`08bcf45`, Fast CI
#42437036503 **SUCCESS**) ha individuato:

| Modulo storico | Import statici ESM di runtime | Caricamenti dinamici letterali | Comandi/workflow configurati |
| --- | ---: | ---: | ---: |
| `trusted-reviewed-approved-dag.ts` | 3, tutti test | 3, handoff GitHub/scripted/fresh repair | 0 |
| `trusted-operational-repair-planner.ts` | 2, tutti test | 1, owner operational repair | 0 |
| `trusted-repair-dag-controller.ts` | 2, tutti test/E2E | 1, owner operational repair | 0 |

Il DAG principale conserva tre importatori statici:
`trusted-planning-review-gate.test.ts`,
`trusted-reviewed-approved-dag.test.ts`,
`r3852-reviewed-dag-runtime-isolation.test.mjs`.
I tre caricamenti dinamici avvengono in
`trusted-admitted-github-handoff.ts`,
`trusted-admitted-scripted-handoff.ts` e
`trusted-fresh-repair-reviewed-dag.ts`.

Il planner conserva due importatori statici:
`operational-epoch-gateway.test.ts` e
`trusted-verified-discovery-repair-input.test.ts`.
Il controller conserva
`native-planning-read-core-evm-e2e.mjs` e
`operational-epoch-gateway.test.ts` come importatori statici.
Entrambi sono caricati dinamicamente soltanto da
`trusted-owner-operational-repair-handoff.ts`.

## Implementazione R385.4

Il nuovo script read-only
`poc/scripts/r3854-legacy-dag-closure-audit.mjs` ricostruisce
questa **lista precisa dei caller** usando l'inventario R6 basato
sul parsing ESM, con `stripTypeScriptTypes` per non considerare
`import type` un import di runtime. Non esegue gli entrypoint
controllati, non carica il model e non accede alle credenziali.

Il gate fallisce se per uno dei tre moduli si verifica almeno uno
dei seguenti eventi:

- un nuovo import statico anche da codice apparentemente fidato;
- un nuovo `import()` letterale, un loader `require()` o un cambio
  di sorgente rispetto ai precisi handoff owner ammessi;
- una dipendenza configurata da package script o GitHub Actions;
- la scomparsa di un importer di regressione atteso oppure la
  rimozione inattesa di un modulo ancora usato, da riconciliare
  prima di cambiare la whitelist;
- la duplicazione ambigua di un edge.

La Fast CI su push esegue sia lo script reale, sia cinque test
offline di mutazioni sintetiche, che verificano l'effettivo
rifiuto di nuovi import, loader, workflow e modifiche inattese.

## Limiti: nessuna falsa cancellabilità

R6 ha contato **115 indirections non risolte nella repository**
sulla SHA R385.3. Il numero è un'indicazione di rischio,
non una dimostrazione che 115 loader raggiungano questi moduli.
La nuova CI lo segnala e **non lo azzera artificialmente**.

Il gate attesta esclusivamente gli edge ESM statici e
i loader `import()` con specifier letterale che R6 sa risolvere.
Non prova l'assenza di import calcolati, alias esterni,
`eval`, runtime costruiti da Docker, comandi indiretti
non riconosciuti, dipendenze da altri package o accessi esterni.
Non attraversa automaticamente un completo call graph.
Per questo `deletionAuthorized: false` è **sempre** presente
nel report, anche quando il controllo passa.

**R385.4 non è certificato fino al SUCCESS della Fast CI
sulla sua SHA finale**. Manteniamo i vecchi moduli e le
regressioni finché non è dimostrata la dismissione reale.
L'architettura finale resta Engineer/Gateway diretti al
Core Rust, Orchestrator/Agenti su MCP crittografico
Child/VP task-local, piano permission-only approvato
separatamente con Ed25519, Runner e Gitea CAS con PR Draft.

## Prossimo gate

Conservare la whitelist stretta fino alla
validazione nativa finale Rust/EVM/OPA/Gitea/Docker/MCP **dopo**
il cleanup. Se la prova end-to-end non è sulla stessa SHA
dei controlli gratuiti, non dichiarare completato il gate.
Il pilot Gemini deve essere autorizzato espressamente
prima di qualunque spesa, senza merge automatico.
