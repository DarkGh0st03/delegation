# Registro delle esecuzioni

Esecuzioni significative del sistema locale (console dell'Engineer, Docker
Compose). La più recente è in alto. I dati vengono dalla cronologia della
sessione nella console (fasi, chiamate a Gemini, decisioni del Gateway) e dalla
Draft PR su Gitea.

---

## 2026-11-13 — Ricerca e filtro utenti con Gemini: PASS, Draft PR mancata per un blocco Markdown

Sessione `s-690b35c5d886`. Planning con lettura di `user.repository.ts` (dati
di esempio), 11 Task, 38 autorizzazioni del Gateway, nessuna negata. Primo
Runner: FAIL su `backend_tests` (un test si aspettava "Alice Adams"); il Test
agent ha riletto i dati reali in `user.repository.ts` e corretto il test;
secondo Runner: **PASS** su tutte le 6 fasi. La proposta della Draft PR è
arrivata dentro un blocco Markdown (` ```json ... ``` `) e la validazione
l'ha rifiutata. Corretto dopo la sessione: un unico blocco ` ```json ` attorno
al valore viene tolto prima della stessa validazione di sempre.

---

## 2026-11-13 — Ricerca e filtro utenti con Gemini: tre cicli di riparazione

Sessione `s-1b2385a2d0fb`. 16 Task, 44 autorizzazioni del Gateway, nessuna
negata; un Backend ha concluso "nessuna modifica necessaria" e la sessione è
proseguita. Tre esecuzioni dei test, tutte FAIL, con i messaggi d'errore
visibili nella Cronologia:
1. `backend_tests`: i test nuovi usavano utenti inventati ("Alice Admin",
   "Alice Reed") invece dei dati reali ("Alice Romano"); il filtro per reparto
   restituiva una lista vuota.
2. `backend_tests`: dopo la correzione dei test restavano filtri vuoti e un
   test esistente (modifica del profilo, 404) era stato rotto dal Test agent.
3. `typecheck`: il Backend aveva usato campi inesistenti (`workEmail`); senza
   messaggi del compilatore e con il limite di 2 riparazioni già esaurito, la
   sessione si è fermata con un messaggio fuorviante.

Correzioni: messaggi del compilatore (file, riga, codice, messaggio) fino
all'Orchestratore e nella Cronologia; limite di riparazioni portato a 4 e
messaggio esplicito quando si esaurisce; istruzioni a Planner, Orchestratore e
agenti di leggere e usare i dati reali (seed, contratti) e di non toccare i
test esistenti che il requisito non cambia.

---

## 2026-11-13 — Ricerca e filtro utenti con Gemini: test nuovo scritto "alla cieca"

Sessione `s-6268042fdca1`. 10 Task completati (Backend 5, uno dei quali
"nessuna modifica necessaria" su `user.routes.ts`, Frontend 2, Test 2), 34
autorizzazioni del Gateway, nessuna negata. Il Task successivo chiedeva al
Test agent di **creare** `tests/frontend/UserListPage.test.tsx`: un Task di
creazione non poteva contenere letture, quindi l'agente non ha visto il
componente e Gemini ha consumato tutto il budget di output cercando di
indovinarne l'interfaccia (`MAX_TOKENS`, 96 s). Il limite di sicurezza ha
scartato la risposta e la sessione si è fermata.

Correzioni, verificate nella sandbox con la soluzione di riferimento e un
Runner simulato (Draft PR creata, 53 decisioni del Gateway, tutte consentite):
- un Task può ora contenere le letture firmate dei file esistenti e la
  **creazione** di un file nuovo (il Test agent ha letto 7 file modificati e
  poi creato il test e2e nello stesso Task);
- il "nessuna modifica necessaria" del Test agent era ancora rifiutato in tre
  punti (registro della IPC lato proprietario, recinto del Gateway, loop
  adattivo): ora è accettato, verificato end-to-end con una patch temporanea
  del modello simulato;
- il limite di output del Test agent passa a 20480 token come gli altri.

---

## 2026-11-13 — Ricerca e filtro utenti con Gemini: prima riparazione guidata dai messaggi d'errore

Sessione `s-107efa00274b`, requisito in linguaggio naturale "Consenti a un
amministratore di cercare gli utenti per nome o email e di filtrarli per
reparto", `gemini-3.8-flash`.

- Planning: 23 permessi proposti, 23 firmati (8 chiamate a Gemini).
- 9 Task (Backend 4, Frontend 2, Test 1 + 2 esecuzioni dei test), 33
  autorizzazioni del Gateway, nessuna negata.
- Primo Runner: FAIL su `backend_tests`. La Cronologia mostra per la prima
  volta il motivo: `expected 'Alice Romano' to be 'Alice Chen'` in due test di
  `tests/backend/user.routes.test.ts` (il test nuovo si aspettava un utente che
  non esiste nei dati di esempio).
- L'Orchestratore ha letto il messaggio, ha delegato al Test agent la
  correzione del test (non del codice: il backend era corretto) e il secondo
  Runner ha dato **PASS** su tutte le 6 fasi.
- La sessione si è fermata alla proposta della Draft PR: l'Orchestratore ha
  scritto `"depends_on": "task-11"` (stringa) invece di `["task-11"]` e la
  validazione l'ha rifiutata. Corretto dopo la sessione (una stringa singola
  vale come lista di un elemento, validata come prima).

Sessioni precedenti dello stesso requisito (`s-2c477b28eb09`,
`s-7f5fb36e688c`) avevano rivelato tre difetti, corretti prima di questa: la
Child DC poteva durare più della Root operativa; il Test agent non poteva
concludere "nessuna modifica necessaria"; i messaggi d'errore dei test non
arrivavano né all'Orchestratore né all'Engineer.

---

## 2026-11-12 — Sistema generico: seconda repository con Runner reale (sandbox)

Verifica del profilo di progetto per repository su una repository diversa da
`iam-console-poc`, creata solo per la prova: `thesis/greeter-lib`, branch base
**`master`**, codice in `src/`, test in `test/`, nessuna dipendenza.

| Voce | Valore |
| --- | --- |
| Ambiente | sandbox di sviluppo (Docker), stack completo, **Runner reale** |
| Modalità | simulata (gratuita, nessuna IA) |
| Profilo di test | modello npm: `npm ci`, poi `npm test`; test in `test/` |
| Planning | letture su `master` autorizzate da Gateway (Rust + OPA) |
| Esecuzione | Backend modifica `src/greeter.js`; il Test agent legge `src/greeter.js` e `test/greeter.test.js` e aggiorna il test (2 letture + 1 scrittura) |
| Gateway | 9 decisioni, 0 negate |
| Runner | container Docker usa e getta: `npm ci` PASS, `npm test` PASS (`ok 1 - greet says hello`) |
| Risultato | Draft PR verso `master` |

Prima di correggere lo script di test della repository di prova (`node --test
test/` non è valido con Node 22) il Runner ha riportato un FAIL reale nella
fase `tests`: nessuna PR, Root revocata. Nella stessa sandbox la regressione
su `iam-console-poc` (modalità riferimento) ha dato lo stesso esito di prima con
le 6 fasi del suo profilo.

---

## 2026-11-12 — Prima esecuzione completa con Gemini (riuscita)

È la prima volta che l'intero flusso arriva in fondo con un modello reale:
Planning con Gemini → revisione e firma dell'Engineer → esecuzione adattiva
degli agenti con credenziali Child → test del progetto nel Runner Docker reale →
Draft PR. Nessuna operazione negata, merge lasciato all'Engineer.

| Voce | Valore |
| --- | --- |
| Sessione | `s-7cb225a9a8c0` |
| Codice del sistema | branch `refactor/post-prof-plan-contracts-20261021`, commit `29cdad26` (Task con più letture e una scrittura) |
| Ambiente | PC dello studente, Windows + WSL, `docker compose` |
| Repository / commit di partenza | `thesis/iam-console-poc` @ `405748b1e779` |
| Requisito | "Consenti a un amministratore di sospendere e riattivare un account utente dall'interfaccia di amministrazione." |
| Modalità | Gemini (`gemini-3.8-flash`), consenso esplicito alla spesa |
| Branch di lavoro | `feature/s-7cb225a9a8c0` |
| Durata | 14:44:50 → 14:53:47 (circa 9 minuti; esecuzione circa 7 minuti) |
| Permessi | 25 proposti, **23 firmati** dall'Engineer (Ed25519) |
| Gateway (Rust VP + OPA) | **38 consentite, 0 negate** |
| Runner | commit `e97bc85b2c12`, **PASS** (installazione, typecheck, test backend e frontend, build, e2e) |
| Gemini | 65 chiamate, 206.388 token riportati (Planning: 10 chiamate, 73.068 token) |
| Risultato | Draft PR #2 su Gitea, 9 commit, +317 −32; `main` protetto richiede 1 approvazione umana |
| Root | revocata a fine esecuzione |

### Task eseguiti (ognuno con una propria Child DC)

| # | Agente | Letture firmate | Scrittura |
| ---: | --- | --- | --- |
| 1 | Orchestrator | — | `create_branch` |
| 2 | Backend | `account-status.ts` | — (Task di sola indagine, vedi sotto) |
| 3 | Backend | `account-status.ts` | `account-status.ts` |
| 4 | Backend | `account-status.ts`, `user.service.ts` | `user.service.ts` |
| 5 | Backend | `user.service.ts`, `user.controller.ts` | `user.controller.ts` |
| 6 | Backend | `user.controller.ts`, `user.routes.ts` | `user.routes.ts` |
| 7 | Frontend | `account-status.ts`, `users-api.ts` | `users-api.ts` |
| 8 | Frontend | `account-status.ts`, `users-api.ts`, `UserDetailPage.tsx` | `UserDetailPage.tsx` |
| 9 | Test | `account-status.ts`, `user.service.ts`, `user.service.test.ts` | `user.service.test.ts` |
| 10 | Test | `user.routes.ts`, `user.controller.ts`, `user.routes.test.ts` | `user.routes.test.ts` |
| 11 | Test | `UserDetailPage.tsx`, `users-api.ts`, `UserDetailPage.test.tsx` | `UserDetailPage.test.tsx` |
| 12 | Test | — | `run_tests` → PASS |
| 13 | Orchestrator | — | `create_pull_request` (Draft) |

Le 38 decisioni del Gateway: 4 letture del Planning su `main`, 1 creazione del
branch, 22 letture e 9 scritture degli agenti, 1 esecuzione del Runner, 1 Draft
PR. È il primo uso reale dei Task con **più letture e una sola scrittura**: ogni
specialista ha letto il file da modificare e le sue dipendenze, e il Test agent
ha letto il codice applicativo prima di scrivere ciascun test.

### Valutazione del codice prodotto dagli agenti

Confronto con la soluzione di riferimento del ricercatore
(`poc/apps/test-runner-controller/fixtures/account-suspension-reference.mjs`).

**Punti di forza**
- Funziona: typecheck, test unitari, test di integrazione, build ed e2e passano
  sul commit finale.
- Segue le convenzioni del codice esistente: `UserNotFoundError` riusato,
  errori passati a `next()`, `String(request.params.id)`, `encodeURIComponent`,
  `ADMIN_HEADERS`, import di tipi con `type`.
- Rotte identiche al riferimento (`POST /:id/suspend`, `POST /:id/reactivate`).
- Il frontend gestisce lo stato di attesa (pulsanti disabilitati), il messaggio
  di successo e l'errore, e mostra il pulsante giusto in base allo stato.
- Test scritti per la funzionalità reale: 4 sul service (compresi gli utenti
  inesistenti), 4 sulle rotte (compresi i 404), 2 sulla pagina (con verifica
  della chiamata HTTP). I test di baseline "la funzione non esiste" sono stati
  sostituiti correttamente.

**Differenze e limiti rispetto al riferimento**
1. **Nessuna regola di transizione di stato** (la differenza principale): il
   riferimento rifiuta con 409 la sospensione di un account già sospeso e la
   riattivazione di uno attivo (`AccountStatusConflictError`); gli agenti
   accettano entrambe le operazioni (risposta 200). Il requisito non lo dice in
   modo esplicito, ma per un sistema IAM è la scelta più corretta.
2. Codice duplicato tra `suspendUser` e `reactivateUser` (il riferimento usa un
   metodo privato `transitionStatus`).
3. Le classi CSS nuove (`admin-actions`, `button-suspend`, `button-reactivate`)
   non hanno stile: `styles.css` non è stato modificato (l'Engineer ha firmato 23
   permessi su 25).
4. Nessun test end-to-end Playwright della nuova funzione (il riferimento crea
   `tests/e2e/account-suspension.spec.ts`).
5. Commento ormai superato in `account-status.ts` ("will extend this type with
   SUSPENDED").

**Giudizio**: codice corretto, leggibile e coerente con il progetto; in una
code review normale passerebbe con poche richieste di modifica, la più
importante è la regola di transizione (409).

### Inefficienza del flusso osservata

Il Task 2 era una lettura di sola indagine dello stesso file letto e modificato
dal Task 3: con i Task "più letture + una scrittura" è superfluo (costa una
Child DC e 2 chiamate). Da correggere nelle istruzioni dell'Orchestrator.

### Limiti di questa evidenza

Un'unica esecuzione, non una campagna di misure ripetute; la qualità del codice
dipende dal modello e dal requisito. I tempi sono quelli della cronologia della
console, non misure di latenza del Gateway (per quelle vedi
[MEASUREMENT_RESULTS.md](MEASUREMENT_RESULTS.md), riferite a una versione
precedente del codice).
