# Registro delle esecuzioni

Esecuzioni significative del sistema locale (console dell'Engineer, Docker
Compose). La più recente è in alto. I dati vengono dalla cronologia della
sessione nella console (fasi, chiamate a Gemini, decisioni del Gateway) e dalla
Draft PR su Gitea.

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
