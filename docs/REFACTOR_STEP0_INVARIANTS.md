# Passo 0 — Invarianti di sicurezza e baseline prima della generalizzazione multi-hop

**Data:** 23/11/2026.
**Branch:** `refactor/post-prof-plan-contracts-20261021`, riallineato con fast-forward a `main` @ `f245734e` (0 commit di differenza). `main` non è stato modificato.
**Scopo:** fissare che cosa il sistema garantisce oggi e dove, prima di:
- rendere il Gateway indipendente dal Delegation Control Module dell'Orchestrator;
- abilitare la sottodelega da parte degli specialisti.

Nessuna modifica al codice in questo passo.

**Terminologia.** *Delegation Control Module* (DCM) è il nome usato nella tesi per la classe `TrustedAuthorityOnlyExecutionCoordinator`.

## 1. Baseline dei test

| Suite | Comando | Esito |
|---|---|---|
| Core Rust (`delegation`) | `cargo test --offline` | 82/82 |
| `services/delegation-adapter` | `cargo test --offline` | 33/33 |
| `services/delegation-core-node` | `cargo test --offline` | 1/1 |
| `services/delegation-engineer-node` | `cargo test --offline` | 2/2 |
| plan-contracts | `npm run plan-contracts:test` | 27/27 |
| engineer-console | `npm run console:test` | 61/61 |
| orchestrator (app) | `npm run orchestrator:test` | 74/74 |
| mcp-shared | `npm run mcp-shared:test` | 26/26 |
| gateway | `npm run gateway:test` | 222/222 |
| agent-runtime | `npm run agent-runtime:test` | 213/213 |
| orchestrator-runtime | `npm run orchestrator-runtime:test` | 327/327 |
| test-runner-controller | `npm run runner:test` | 50/50 |
| OPA | `npm run opa:test` | 45/45 |

**Totale:** 1.163 test, tutti superati.

## 2. Baseline E2E simulato (nessuna IA, nessun costo)

**Ambiente:**
- immagini `delegation-app:local` e `delegation-chain:local` ricostruite da `f245734e`;
- stack completo (Gitea, OPA, Anvil, Runner reale, staging);
- `DELEGATION_FREE_MODES=1` tramite un override di compose fuori dalla repository, con `GEMINI_API_KEY` vuota.

**Sessione `s-935407ed1332`:**
- repository `campus-library`;
- requisito: *"Add a genre filter to the book list…"*;
- modalità `scripted`.

| Fase | Esito |
|---|---|
| Planning | Root preliminare di sola lettura, 9 permessi proposti |
| Approvazione | 9/9 permessi firmati (Ed25519, password) |
| Esecuzione | Root operativa; 4 Task (Data, Test ×2, Test run); 12 decisioni del Gateway, **12 allow, 0 deny** |
| Runner | PASS (2 fasi: `npm ci`, `npm test`) |
| Esito | Draft PR #4 creata; merge lasciato all'umano |

**Tempi:**
- Planning ≈ 15 s;
- esecuzione (dalla firma alla Draft PR) ≈ 48 s;
- verifica Rust della VP: mediana 1.487 ms (min 946, max 1.660), compresa la risoluzione sul trust layer EVM;
- OPA: mediana 3,4 ms.

**Riproduzione:**
1. Build delle immagini con `docker buildx build --target chain|app`, passando il CA del proxy come secret `extra_ca`.
2. `docker compose -f compose.yaml -f <override con DELEGATION_FREE_MODES=1> up -d --no-build`.
3. Login, `POST /api/requests`, `POST /api/requests/<id>/planning` con `{"mode":"scripted"}`, `POST /api/sessions/<id>/approve`.

## 3. Invarianti da preservare

Legenda del meccanismo:
- **C** crittografico (core Rust);
- **S** stato fidato (journal o memoria del processo owner);
- **P** policy (OPA).

| # | Invariante | Dove oggi | Mecc. | Nel refactoring |
|---|---|---|---|---|
| I1 | La Root operativa coincide con il grant firmato dall'Engineer (permessi, sessione, repository, branch, revisione, hash del requisito, scadenza ≤ grant) | `poc/apps/gateway/src/trusted-authority-only-admissions.ts:378-429` (attivazione) | S | **Mantenere.** Controllo una volta per sessione nel Gateway, senza passare dal DCM |
| I2 | Ogni Child è coperto dal padre (permessi ⊆, scadenza ≤ antenati) | `src/delegation/issuance/delegation_issuer.rs` | C | Mantenere. Vale già a ogni profondità |
| I3 | Verifica della catena: firme, presentatore = titolare = delegato, continuità, copertura per ogni hop, trust anchor, accumulatore, revoca di **ogni** antenato | `src/delegation/verification/delegation_verifier.rs:60-292` | C | Mantenere |
| I4 | Prova legata alla richiesta: audience + challenge da 32 byte, TTL, consumo prima della verifica (anti-replay sulla stessa istanza) | `poc/apps/gateway/src/prepare.ts`, `execute.ts:196-230` | S | Mantenere |
| I5 | Il permesso richiesto è derivato dal Gateway dai parametri reali, non dichiarato dall'agente | `prepare.ts:83`, `canonical.ts` | S | Mantenere |
| I6 | Il DID del presentatore della VP coincide con il delegato del Task | `admissions.ts:735-736`, `1794-1795` | C+S | **Mantenere**, ma confrontando con il titolare del Child (`verified.presenter_id` / `credential_id`) invece che con la riga del DCM |
| I7 | Ammissione del Task: sessione, requisito, revisione, branch; agente nel registro fidato; capability della Agent Card; epoca progressiva; id non riusato; dipendenze già registrate | `poc/packages/orchestrator-runtime/src/trusted-authority-only-execution-coordinator.ts:236-309` | S | **Spostare** in un DCM per ogni delegante, nel suo runtime fidato |
| I8 | Child ↔ Task: permessi del Child = permessi del Task; epoca e DID coincidenti | `trusted-authority-only-child-issuer.ts:103-118`; `admissions.ts:496-570` | S | **Ridefinire.** Il DCM del delegante lega Task → Child; il Gateway indicizza lo stato per `credential_id` del Child (già restituito, autenticato, dal verificatore: `types.ts:200-209`) |
| I9 | Un effetto del Task solo se le dipendenze sono completate (attestate dal Gateway) | `admissions.ts` (`preflightCanonicalRequest`: `#completed`); owner runtime (`review-host.mjs:416-466`) | S | **Decisione aperta** (§5, Q1): il Gateway conosce le dipendenze solo tramite il DCM |
| I10 | Al più un effetto operativo per Task, con prenotazione durevole (flight) prima dell'I/O; esiti ambigui terminali | `admissions.ts:589-660`; `trusted-authority-only-task-fence-journal.ts` | S | Mantenere, indicizzato per Child. **Aggiungere** il budget cumulativo per sottoalbero (§4) |
| I11 | Task "letture + una scrittura": tutte le operazioni sulla stessa HEAD; scrittura solo dopo le letture previste; HEAD-CAS su Gitea; nessun retry | `trusted-authority-only-sequential-read-update-stager.ts`; `trusted-authority-only-mutation-executor.ts` | S | Mantenere, indicizzato per Child |
| I12 | Completamento attestato da un osservatore indipendente sul provider o sul Runner, confrontato con il flight | `admissions.ts:783-860` | S | Mantenere. **Aggiungere** il completamento composto (§4) |
| I13 | Regole di workflow: branch creato prima dei Task degli specialisti; Draft PR solo dopo un PASS; il Test agent aggiorna solo sorgenti di test; `run_tests` solo dal Test agent | owner runtime; `admissions.ts`; `poc/opa/policy.rego` | S+P | Mantenere |
| I14 | Policy di repository: branch protetti, percorsi vietati, `operation == tool`, branch di lavoro, merge vietato | `poc/opa/policy.rego` | P | Mantenere. **Aggiungere** profondità massima e fan-out (§4) |
| I15 | Revoca: status list per credenziale, verificata per ogni antenato; risoluzione fail-closed | `delegation_verifier.rs:255-292`; `evm_anchored_status_list_resolver.rs` | C | Mantenere. Ogni delegante deve poter pubblicare la propria status list (§6) |
| I16 | Chiavi isolate nei wallet per ruolo; i modelli non vedono chiavi, credenziali né funzioni di emissione | `poc/engineer-console/src/role-wallet.mjs`; `poc/mcp-shared/README.md` | S | Mantenere. L'emissione da parte degli specialisti passa solo dal loro DCM fidato |
| I17 | Esecuzione sequenziale: nessuna nuova decisione finché i Task precedenti non sono attestati | `review-host.mjs:416-466` | S | Mantenere ed estendere ai sottoalberi |
| I18 | Journal durevoli (`O_CREAT \| O_EXCL`, fsync); fail-closed su esiti ambigui | journal in `orchestrator-runtime/src`, `gateway/src` | S | Mantenere |

## 4. Invarianti nuovi richiesti dalla generalizzazione (decisioni approvate)

| # | Invariante | Note di progetto |
|---|---|---|
| N1 | **Budget d'effetto cumulativo per sottoalbero**, esplicito e distinto dallo scope. Il Task padre e tutti i discendenti condividono il budget; emettere più Child non lo moltiplica | Il budget non si deduce dai permessi. Va dichiarato all'ammissione del Task di primo livello, e ogni consumo è prenotato dal Gateway in modo atomico e durevole prima dell'effetto (esiti ambigui contati come consumati). La chiave del budget è il Child di primo livello, ricavabile dalla gerarchia autenticata della VP. Da decidere se dichiararlo in un campo firmato della credenziale o nello stato del Gateway (§5, Q2) |
| N2 | **Profondità massima** configurabile | In OPA (`hierarchy_depth ≤ max`) e/o nel verificatore |
| N3 | **Fan-out massimo** per Task | Nel DCM di ogni delegante; il Gateway lo può controllare contando i Child per padre |
| N4 | **Completamento composto** | Un Task sottodelegato è completo quando sono attestati tutti i suoi sotto-Task e l'eventuale effetto proprio; il completamento deriva da evidenze del Gateway, non da dichiarazioni |
| N5 | **Sequenzialità nei sottoalberi** | Un solo Task in esecuzione per volta nell'intera sessione (stesso branch: niente conflitti HEAD-CAS) |
| N6 | **Gateway indipendente dal DCM** | Il Gateway si fida solo di: grant firmato (attivazione), VP verificate, proprio stato |

## 5. Questioni di progetto da decidere prima del passo 1

**Q1 — Dipendenze (I9).** Oggi il Gateway conosce le dipendenze di un Task leggendo il DCM. Senza il DCM le opzioni sono:
- (a) le dipendenze diventano una responsabilità del delegante, che emette il Child successivo solo dopo il completamento attestato; il Gateway applica la sequenzialità globale (N5);
- (b) le dipendenze vengono scritte nella credenziale.

**Proposta:** (a). Con N5 la sequenzialità globale implica l'ordine. Un delegante compromesso resta comunque confinato nella propria autorità e nel proprio budget.

**Q2 — Dove dichiarare il budget (N1).**
- (a) campo firmato nel Child, che richiede una modifica al formato della credenziale;
- (b) dichiarazione del delegante di primo livello (l'Orchestrator) al Gateway attraverso un canale autenticato, conservata nello stato del Gateway.

**Proposta:** valutare prima (b), che non tocca il formato. (a) va adottata solo se (b) reintroduce una dipendenza dal runtime del delegante.

**Q3 — Ruolo di un DID.** Le regole OPA per ruolo (`run_tests` solo dal Test agent) richiedono la mappa DID → ruolo. Oggi viene dal registro dei ruoli (`agent-roles.mjs`) e dal DCM; il Gateway deve leggerla direttamente dal registro fidato.

## 6. Supporto all'emissione da parte degli specialisti: verifica

**Già presente:**
- Ogni wallet per ruolo, all'avvio, crea un `DelegationIssuer` e pubblica sul trust layer identità, materiale dell'accumulatore e chiave di verifica (`services/delegation-adapter/src/crypto.rs:254-277`, `initialize_issuers`). Il controllo di salute della console lo conferma: *"Engineer e un wallet per ciascuno dei 7 ruoli registrati sulla blockchain"*.
- **Dal punto di vista crittografico, ogni specialista è già un emittente.**
- Il core Rust e il verificatore gestiscono catene di qualsiasi profondità (test su catene ricorsive con fan-out).
- Il verificatore restituisce al Gateway `credential_id`, `issuer_id`, `root_credential_id` autenticato e `hierarchy_depth` (`poc/apps/gateway/src/types.ts:200-209`). Il Gateway può quindi indicizzare lo stato per Child **senza modificare il formato della credenziale**.

**Mancante (vincoli espliciti "solo Orchestrator"):**

| Punto | File | Che cosa cambiare |
|---|---|---|
| Matrice delle capability: `IssueChild` e `ManageStatus` solo per l'Orchestrator; gli specialisti hanno solo `CreatePresentation` | `services/delegation-adapter/src/config.rs:187-215` | Dare `IssueChild` e `ManageStatus` ai ruoli che possono delegare |
| `issue_child` rifiuta ogni chiamante diverso dall'Orchestrator e ogni delegato che non sia uno specialista | `services/delegation-adapter/src/crypto.rs` (`issue_child`, controllo `caller.role() != CallerRole::Orchestrator`) | Consentire a qualsiasi ruolo delegante di emettere verso un altro ruolo registrato, mai verso sé stesso o verso un antenato (cicli) |
| L'emittente usato è sempre quello dell'Orchestrator; anche la status list è registrata sotto l'Orchestrator | `crypto.rs` (`self.issuers.get(&CallerRole::Orchestrator)`, `register_active_status(CallerRole::Orchestrator, …)`) | Usare l'emittente e la status list del ruolo chiamante |
| Il Child viene derivato da un genitore presente nel wallet: per uno specialista è il proprio Child ricevuto | `crypto.rs` (`parent_credential_id`) | Verificare che il wallet dello specialista memorizzi il Child ricevuto (`store_credential`) e possa usarlo come genitore |
| Lo strumento MCP di emissione è esposto solo al wallet dell'Orchestrator | `poc/mcp-shared/src/owner-private-crypto-catalog.mjs` | Esporlo solo al DCM fidato del delegante, mai al modello |
| Il DCM è istanziato solo per l'Orchestrator, nel Review Host | `poc/apps/orchestrator/src/trusted-authority-only-review-host.mjs:168` | Renderlo una libreria usata dal runtime fidato di ogni agente delegante |
| Il Gateway presume che ogni Child derivi direttamente dalla Root (`child.root_credential_id === root.root_credential_id`) e legge i Task dal DCM | `poc/apps/gateway/src/trusted-authority-only-admissions.ts:289-295, 453, 520` e seguenti | Passo 1: stato per `credential_id`, Root ricavata dalla gerarchia autenticata |
| Il runtime degli specialisti non ha uno strumento "delega" né il registro fidato | `poc/packages/agent-runtime/src` | Strumento di delega che produce una *proposta*; registro in sola lettura |
| Nessun limite di profondità | `poc/opa/policy.rego:61-69` (`hierarchy_depth >= 0`) | N2 |

**Conclusione.** Il formato della credenziale e il trust layer **non** richiedono modifiche per la sottodelega in sé: ogni ruolo è già un emittente registrato e la verifica è già multi-livello. Le modifiche riguardano:
- i permessi del wallet e dell'adapter;
- il DCM per ogni delegante;
- il Gateway (stato per Child, root dalla gerarchia);
- il runtime degli specialisti;
- la policy (profondità e fan-out).

Resta aperta solo Q2 (budget): potrebbe richiedere un campo firmato nella credenziale.

## 7. Rischi notati

- **Verifica della VP:** ≈ 1,5 s di mediana per richiesta. Cresce con la profondità, perché il verificatore risolve sul trust layer ogni antenato. Da misurare nel passo 4 con catene a 2–3 livelli.
- **Store di prepare in memoria e per istanza** (I4): invariato, adeguato a un'istanza singola del Gateway.
- **Spazio disco** della sessione di sviluppo: le directory `target` dei servizi Rust (≈ 7 GB) sono state rimosse dopo i test; si ricostruiscono con `cargo test`.
