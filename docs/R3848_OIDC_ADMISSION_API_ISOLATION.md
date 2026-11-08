# R384.8 — Isolamento OIDC dall'handoff GitHub DAG storico

Data: 8 novembre 2026. Branch:
`refactor/post-prof-plan-contracts-20261021`. PR #38 Draft.

## Problema effettivamente riprodotto nell'inventario R384.7

`poc/packages/orchestrator-runtime/src/index.ts` esportava
`export * from "./trusted-admitted-github-handoff.ts"`.
Quel modulo importava l'esecutore `trusted-reviewed-approved-dag.ts`
e l'owner del repair DAG. Pertanto un consumer dell'API pubblica
`@thesis/orchestrator-runtime` poteva raggiungere il vecchio controller
anche se il launcher authority-only non lo importava direttamente.

Al contempo `consumePinnedGithubAdmission` rimaneva un contratto utile:
consuma **una sola volta** una receipt HMAC da uno store persistente,
verifica repository/ref/run/session/SHA indipendenti e restituisce
**solo** identificatori e limiti di Planning. Non firma una Root,
non crea Child DC/VP, non avvia Gemini e non autorizza A2A o provider.

## Refactor applicato

1. Aggiunto `src/trusted-github-admission-consumer.ts`: contiene
   il consumo della receipt OIDC e i relativi tipi. Il codice di
   validazione e di conferma one-shot e' stato **spostato, non allentato**.
   Il suo unico import di runtime e' lo store HMAC
   `trusted-github-admission-store.ts`; le dipendenze a DAG/repair
   e ai modelli sono assenti.
2. `src/index.ts` non esporta piu' tutto
   `trusted-admitted-github-handoff.ts`. Esporta solo il consumer
   e i suoi tipi tramite il nuovo modulo privo di side effect DAG.
3. `src/trusted-admitted-github-handoff.ts` (storico) conserva
   per compatibilita' la stessa funzione re-exported **solo** per i
   caller diretti e continua a consumare la receipt tramite il
   nuovo modulo. L'esecuzione legacy DAG **non** viene cancellata
   senza verificare importatori e test.
4. L'unit test OIDC esistente ora verifica il consumer diretto,
   l'identita' della re-export compatibile, la singola consumazione
   su restart e il rifiuto di un repository/ref non coerente.
   Una regressione offline aggiuntiva vieta la re-esportazione del
   vecchio handoff dall'index e un import del DAG da parte del
   consumer. Entrambi i test sono inclusi in Fast CI.

## Confini ancora aperti

Questo intervento **non prova** che il DAG storico non sia raggiungibile
tramite altri import diretti, package export o entrypoint di test.
`trusted-admitted-github-handoff.ts`,
`trusted-admitted-scripted-handoff.ts`,
`trusted-fresh-repair-reviewed-dag.ts` e
`trusted-owner-operational-repair-handoff.ts` sono ancora presenti
e devono essere migrati, isolati o conservati per regressioni di
sicurezza. `authority-client.ts` continua a importare
`authority-adapter-transport.ts`: e' un altro confine da migrare
esplicitamente, senza rimuovere i moduli Rust di Engineer/Gateway.

Nessuna inferenza Gemini a pagamento, nuova approvazione,
emissione Root/Child o merge sono stati avviati.
La Fast CI della nuova SHA resta da verificare prima di dichiarare
questo checkpoint **PASS**. E2E Rust/EVM/OPA/Gitea/Docker finale
richiesto dopo il cleanup e prima del pilot.
