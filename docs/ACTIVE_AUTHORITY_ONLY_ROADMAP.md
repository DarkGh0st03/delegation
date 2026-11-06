# Roadmap attiva — Delegation authority-only

Riferimento concordato: audit indipendente del 6 novembre 2026 (baseline R353.7),
riaffermato dall'utente con «Continua il lavoro seguendo questo sempre».
Questa roadmap guida le priorità: la presenza di componenti non dimostra ancora
un comportamento autonomo del sistema.

## Ordine del lavoro

1. **Operazioni proprie dell'Orchestrator.** Root operativa e VP per branch/PR;
   Child DC soltanto per Backend, Frontend e Test. Nessuna modifica al Core Rust
   per consentire autodelega. Binding esatto sessione/Task/root/revisione, Gateway
   Rust e OPA, effetto singolo e completamento verificato indipendentemente.
2. **Executor autonomo.** Un controller possiede il ciclo osservazione → scelta
   dei Task → esecuzione → verifica → completamento. Riusa Coordinator e registri
   trusted. La sequenza non deve essere predisposta dal test harness; il modello
   deve poter ispezionare codice entro lo scope approvato.
3. **Recovery diagnostico.** Riutilizzare D1, fornire diagnosi tecniche sanificate
   e letture autorizzate al modello; lasciare scegliere specialista e correzione
   entro il plafond firmato. Il solo digest del fallimento non è una diagnosi.
4. **Migrazione architetturale.** Child tramite MCP attivo; discovery e FunctionTools
   configurabili; scope preliminare gerarchico e letture composte; launcher canonici
   authority-only. Rimuovere il legacy sostituito dopo verifica delle dipendenze.
5. **Prova gratuita unica.** Requisito → Planning via Gateway reale → approvazione
   delle sole permission → branch → sviluppo → Test → eventuale D1 → PR attestata.
   Distinguere fixture, modelli scriptati e generazione effettiva del codice.
6. **Pilot Gemini**, soltanto con consenso esplicito ai costi e gate CI concordati.
   GUI locale finale successiva. Merge sempre separato e umano.

## Evidenze correnti

- **PR nativa confermata:** R353.9, checkpoint `06a7f7246b0641d9b8c757082111d3ebff3eaecd`,
  [run 42255261326](https://github.com/DarkGh0st03/delegation/actions/runs/42255261326)
  SUCCESS; Fast CI 42255260980 SUCCESS sulla stessa SHA.
  Backend/Frontend, Docker FAIL, D1 repair e retest/acceptance PASS, root originale
  invariata, una Draft PR e attestazione indipendente. Sei Task registrati, cinque
  completati: il primo Test rimane fallito. Replay e revoca verificati, main invariato,
  zero chiamate a pagamento. Rust non modificato per la correzione PR.
- **Limiti della prova:** modelli scriptati, applicazione funzionale predisposta
  dal test owner, trasporto preliminare Gateway fixture. Non è prova di generazione
  autonoma Gemini, né di Planning completamente reale.
- **Branch nativo confermato:** R354.2, checkpoint `d21ac06b84bef0e9f7f5313e9bad5abf7a9a9762`,
  [run 42258775959](https://github.com/DarkGh0st03/delegation/actions/runs/42258775959)
  SUCCESS; Fast CI 42258775993 SUCCESS sulla stessa SHA. Sorgente R354.1 `f0c52287`
  con Fast CI 42258410503 ed Engineer CI 42258410306 SUCCESS.
  Baseline main irrisolta invariata; branch assente fino all'approvazione; Task scelto
  da ADK scriptato e registrato dall'owner originale, una VP root a profondità zero,
  Rust/EVM e OPA reali, HTTP GatewayRuntime, un solo POST Gitea e completamento
  attestato da client read-only indipendente. Un Task registrato/completato, zero
  Child, replay e revoca verificati, zero chiamate a pagamento. Nessun file predisposto.
- **Limite del branch:** il trasporto preliminare Gateway rimane fixture, pur con
  lettura reale di main e VP preliminare nativa. È una prova branch-only, distinta
  dalla prova nativa recovery/PR: non chiude la prova gratuita unica R11.
- **Executor R355 avviato:** l'owner originale espone un ciclo ADK limitato che
  sceglie Task/stop/blocco, registra/delega, esegue A2A e attesta prima della scelta
  successiva. Non riceve una lista di Task. La richiesta di PR è una readiness
  verificata sulla HEAD corrente, non una PR già creata. Si riusano i registri e
  gli esecutori esistenti; il budget originale resta invariato.
- **R355.5 — Test FAIL osservato e riparazione adattiva SDK:** il nuovo owner
  verifica il Runner FAIL tramite ricevuta MAC, Gateway, Child, root e HEAD,
  senza candidato D1 preimpostato. Il modello scriptato decide Backend repair
  e retest PASS nella stessa sessione, preservando il Test iniziale incompleto.
  Engineer CI [42266112619](https://github.com/DarkGh0st03/delegation/actions/runs/42266112619)
  SUCCESS: 171 test principali PASS. Provider e issuer di questa prova SDK
  restano fixture; non attribuire questa evidenza a Gemini generativo o native E2E.
- **R355.6–R355.9 — recovery adattivo più generale e diagnostica minima:** un
  errore A2A/trasporto è terminale; solo un Runner FAIL confermato dalla ricevuta
  MAC originale può sbloccare un nuovo turno. Due FAIL autenticati successivi
  sono ora ammessi nella stessa sessione, mentre il terzo termina in sicurezza.
  Il modello vede storia verificata dei fallimenti e, per typecheck, codici TS
  sanificati e MAC-autenticati, mai log grezzi o credenziali. Engineer CI
  [42270124666](https://github.com/DarkGh0st03/delegation/actions/runs/42270124666)
  SUCCESS sul codice `0e0c4729`: 175 test principali PASS, nessun FAIL.
  Il test SDK usa ancora provider/issuer fixture e modelli scriptati.
- **R356.0 — primo Test FAIL controllato dal loop adattivo, nativo:**
  [run 42271611943](https://github.com/DarkGh0st03/delegation/actions/runs/42271611943)
  SUCCESS. Originale Engineer UI/review, root Rust/EVM, OPA e Gateway/Gitea
  reali; ADK scriptato sceglie il Test tramite A2A e riceve dal Runner
  Docker un autentico FAIL di typecheck. Una ricevuta MAC autentica il
  fallimento; il Test non viene completato; decisione bounded blocked,
  root revocata, main invariato. 3 Task / 2 completati / 1 Runner.
- **R356.1 — recovery dinamico + retest nativo:**
  [run 42273016127](https://github.com/DarkGh0st03/delegation/actions/runs/42273016127)
  SUCCESS. Test FAIL reale → decisione Backend D1 dopo prova → Gitea CAS
  attestata → Test di sostituzione e acceptance Docker reali PASS. Nessun
  candidato D1 prestabilito prima del FAIL; una sola root Engineer originale.
  5 Task / 4 completati / 2 Runner / 3 commit Gitea; il Test fallito
  resta incompleto. Root ritirata dopo readiness.
- **R356.2 — recovery adattivo e Draft PR native nella stessa sessione:**
  [run 42274902525](https://github.com/DarkGh0st03/delegation/actions/runs/42274902525)
  SUCCESS. Dopo il PASS indipendente, l'Orchestrator (VP root depth 0,
  nessuna autodelega Child) propone e crea una sola Draft PR su Gitea
  disposable; l'owner ne attesta separatamente HEAD e identità. Replay
  negato, main invariato, 6 Task / 5 completati / 2 Runner / 3 commit
  Gitea / 1 PR. Un Test FAIL resta permanentemente non-completato.
  Tutto a costo AI zero; i modelli di scelta e i contenuti correttivi
  rimangono **scriptati**, e la fonte applicativa iniziale è predisposta
  dal test owner prima dell'approvazione. Questo NON prova planning
  generativo, letture autonome del codice o feature branch creato da main
  nella stessa sessione: il gate R354 branch-only è ancora separato.
- **Prossima integrazione R357, obbligatoria per la prova gratuita unica:**
  partire da main non risolta, approvazione permission-only, root
  dell'Orchestrator crea e attesta il branch nella stessa sessione che
  prosegue con Backend/Frontend/Test/recovery/PR. Eliminare l'applicazione
  funzionale pre-seeded dal test owner; il modello deve poter leggere il
  codice autorizzato e produrre la modifica reale. Completare diagnostica
  sanificata (non solo fase, hash e codici TS), MCP/discovery e launcher
  authority-only prima del pilot generativo. Zero paid Gemini senza
  consenso esplicito, un solo scenario Account Suspension, PR #38 Draft.

Non avviare suite native complete a ogni commit. Usare test mirati e Fast CI;
riservare la prova nativa a checkpoint di integrazione significativi. PR #38 Draft,
nessun merge o modifica di main.
