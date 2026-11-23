# Audit mirato: Prepare/Execute, Gateway–DCM, vincoli di workflow

**Data:** 23/11/2026.
**Codice:** `main` @ `f245734e` (branch `refactor/post-prof-plan-contracts-20261021`, nessuna modifica al codice).
**Decisione di partenza:** l'architettura resta Engineer → Orchestrator (Root DC) → specialisti (Child DC). Nessuna sottodelega applicativa tra specialisti. Il core Rust resta multi-livello.

**Terminologia:** DCM = Delegation Control Module (`TrustedAuthorityOnlyExecutionCoordinator`).

## 1. Problemi concreti trovati

| # | Tipo | Dove | Problema | Impatto | Proposta |
|---|---|---|---|---|---|
| F1 | Documentazione | `poc/apps/orchestrator/src/canonical-owner-deployment.mjs:166-182` | Nella fase operativa la Prepare **è** legata al ruolo. Ogni specialista raggiunge il Gateway tramite una `fetch` in-process legata al proprio ruolo: Prepare accettata solo se `body.agent_role === role`; Execute solo se il record preparato ha lo stesso ruolo. Le spiegazioni date finora ("Prepare non autenticata, un agente può dichiararsi un altro") erano sbagliate | Solo documentale | Correggere le spiegazioni. Il codice è corretto |
| F2 | Documentazione | `poc/engineer-console/src/sessions.mjs:698-707` | Le capability usate dal DCM vengono da un **registro fidato configurato dalla console** (`trustedAgentRegistry`: DID, `card_ref: "trusted:<ruolo>"`, capability fisse: specialisti read/update/create, Test anche `run_tests`, Orchestrator branch/PR). Non vengono lette dalle Agent Card A2A | Solo documentale: `GARANZIE_END_TO_END_DELEGATION.md` dice "capability dichiarate nella Agent Card fidata" | Correggere: "capability del registro fidato dei ruoli, configurato dal runtime" |
| F3 | Codice morto | `poc/apps/orchestrator/src/trusted-authority-only-review-host.mjs:416-466` (`proposeAndStageTask`) | Metodo mai chiamato, né dal codice né dai test. Contiene un limite fisso di 8 decisioni diverso dai budget reali (`trusted-authority-only-execution-budgets.mjs`: fino a 24 Child e 25 decisioni). Il percorso reale è il loop adattivo (`review-host.mjs:779-860`) | Manutenibilità e comprensione: è facile citarlo per errore come regola attiva | Rimuoverlo e rieseguire le suite (semplificazione sicura) |
| F4 | Confine di fiducia | `poc/engineer-console/src/sessions.mjs:604-632`; `canonical-owner-deployment.mjs:132-200`; `trusted-authority-only-owner-bootstrap.mjs:185-215` | Nella fase operativa Gateway (prepare/execute come funzioni), DCM, runtime dell'Orchestrator (ADK) e runtime degli specialisti (ADK, A2A su loopback) sono **nello stesso processo Node** del container `app`. Processi separati: wallet per ruolo (`trusted-core.mjs`), Runner, Gitea, OPA, Anvil. `PROJECT_KNOWLEDGE.md` §5.3 parla di "processi separati": non corrisponde al codice | Threat model: la prompt injection non aggira i controlli, perché l'output del modello è un dato validato. Una **esecuzione di codice** in quel processo (per esempio tramite una dipendenza) annullerebbe però i controlli di stato. Restano le chiavi nei wallet separati e la verifica Rust, eseguita nello stesso processo | Nessuna modifica per la tesi. Dichiarare il confine esatto nel threat model. La separazione del Gateway in un processo o container proprio è uno sviluppo futuro (già "tappa 2") |
| F5 | Ridondanza | `poc/apps/gateway/src/trusted-authority-only-admissions.ts:1741-1745` | Il preflight controlla permesso ⊆ Task, ⊆ grant **e** ⊆ Root. Grant = Root è garantito all'attivazione (righe 378-429); Task ⊆ grant ∩ Root è garantito dal DCM; Child = Task è garantito dall'emissione | Nessuno: confronti in memoria (µs) | Lasciare; al più un commento |
| F6 | Profondità | `services/delegation-adapter/src/crypto.rs` (`issue_child`, `store_credential` 797-819); `admissions.ts:734-739, 1795-1799`; `poc/opa/policy.rego:61-69` | La profondità è **limitata per costruzione**: solo l'Orchestrator può emettere; il genitore deve essere una credenziale delegata al chiamante (cioè la Root); il Gateway accetta solo il Child iscritto (`verified.credential_id === child.credential_id`). OPA controlla solo `hierarchy_depth >= 0` | La criticità "nessun limite di profondità" (tranche 2) non è una vulnerabilità del PoC, ma il perimetro non è scritto nella policy | Facoltativo: regola esplicita `hierarchy_depth == 1` per le operazioni degli specialisti in OPA (con test), per dichiarare il perimetro anche in policy |

**Nessuna vulnerabilità trovata nel collegamento Gateway–DCM** oltre all'assunzione F4:
- il Gateway legge il DCM tramite riferimenti in-process controllati con `instanceof`, mai da messaggi A2A;
- ogni discrepanza tra Task, Child, flight o Root porta a un rifiuto o a `failed_closed`.

## 2. Prepare/Execute: ridondanze vere e ripetizioni volute

| Controllo | Prepare | Execute | Valutazione |
|---|---|---|---|
| Ruolo del chiamante | `fetch` legata al ruolo | Record dello stesso ruolo | Necessario in entrambi (F1) |
| Validazione e normalizzazione della richiesta, permesso derivato dal Gateway | ✓ | Usa il record congelato | Necessario |
| Preflight: Task iscritto, agente, dipendenze, branch, permesso nel Task, regole del Test agent, HEAD fissata | ✓ | ✓ (rieseguito nei binding, `admissions.ts:761` e seguenti) | **Ripetizione voluta:** tra le due fasi possono cambiare completamenti, scadenze e fence (TOCTOU) |
| Permesso ⊆ grant ⊆ Root | ✓ | ✓ | **Ridondante** (F5), innocuo |
| Consumo della challenge e TTL | — | ✓ | Necessario |
| VP Rust (firma, presentatore, audience, challenge, catena, revoca) | — | ✓ | Necessario |
| Permesso coperto anche lato TypeScript (`validateVerifiedDelegation`) | — | ✓ | Ridondante rispetto a Rust; difesa in profondità |
| OPA | — | ✓ | Necessario |
| DID presentatore = DID del Task; `credential_id` = Child iscritto; Root autenticata = Root attiva; impronta della richiesta | — | ✓ | Necessario: lega la prova crittografica al Task |
| Flight durevole, HEAD-CAS, osservatore indipendente | — | ✓ | Necessario |

## 3. Vincoli di workflow: verifica

Tutte le suite passano (baseline: `REFACTOR_STEP0_INVARIANTS.md`), e l'E2E simulato del 23/11 li esercita. I test che coprono ciascun vincolo:

| Vincolo | Implementazione | Test rappresentativi |
|---|---|---|
| Al massimo 15 letture + 1 scrittura per Task | `MAX_TASK_READS = 15` (`plan-contracts/src/gitea-permission-containment.mjs:124`); stager sequenziale | "multi-read Task refuses reads after all granted reads and a second write path"; "no second write, no write without reading the edited file, no Test write on application code" |
| Id del Task, epoca, nessun replay | DCM `registerTask`; journal `O_EXCL` | "Coordinator rejects escalation, foreign agent, scope or dependency…"; "journal prevents replay after process reconstruction…"; "forged Task ID cannot trigger the Gateway completion observer" |
| Revisione Git (HEAD fissata, CAS) | Stager, executor mutation/create | "CAS refuses stale branch HEAD without any provider mutation"; "changed pinned HEAD denies read…"; "concurrent remote branch advance rejects create CAS" |
| Attestazioni indipendenti | Osservatori Gitea/Runner con MAC | "forged Task, wrong key and tampered Gitea bytes/head are denied"; "bogus completion observer fails closed; no dependency unlock"; "lost acknowledgement after CAS is AMBIGUOUS, never success" |
| Sequenzialità | Loop adattivo: nessuna nuova decisione finché i Task precedenti non sono attestati o in fallimento autenticato (`review-host.mjs:803-818`) | "Gateway denies replay, dependencies without trusted completion…"; "independently verified Test FAIL is observable, not a completed dependency" |
| Anti-replay della richiesta | `consumed` + TTL | "an expired bundle is consumed and cannot be replayed"; "opt-in Gateway read publishes evidence and denies replay" |

## 4. Semplificazioni sicure

1. Rimuovere `proposeAndStageTask` (F3).
2. Facoltativo: regola OPA `hierarchy_depth == 1` per gli specialisti (F6).
3. Nient'altro: le altre ripetizioni sono volute oppure innocue (F5).

## 5. Proprietà dimostrabili nella tesi con l'architettura attuale

| Proprietà | Evidenza |
|---|---|
| L'autorità operativa è limitata dalla decisione umana (Root = grant firmato) | Implementazione + test |
| Attenuazione verificata a ogni hop della catena (crittografica) | Test Rust |
| Privilegio minimo per Task (Child = permessi del Task; ≤ 15 letture + 1 scrittura) | Implementazione + test |
| Prova legata all'agente e alla richiesta (firma della VP, audience, challenge monouso) | Implementazione + test |
| Nessun effetto sul repository senza VP valida + OPA + collegamento al Task | Implementazione + test + E2E |
| Effetti al più una volta, su revisione attesa (HEAD-CAS); esiti ambigui terminali | Implementazione + test |
| Avanzamento solo su evidenze verificate; sequenzialità | Implementazione + test |
| Revoca per anello (antenati compresi), fail-closed | Test Rust |
| Divulgazione selettiva dei permessi (nasconde *n − k*) | Test Rust (nessuna rivendicazione di cardinality hiding o unlinkability) |
| Merge sempre umano | Policy + design |

**Non dichiarabili:**
- sottodelega ricorsiva tra agenti (il core la supporta, l'applicazione no);
- anti-replay con più istanze del Gateway;
- isolamento a livello di processo tra Gateway e agenti (F4);
- prove formali.
