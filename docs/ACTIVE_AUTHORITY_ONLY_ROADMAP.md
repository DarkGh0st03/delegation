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
- **Prossima integrazione prioritaria:** esercitare il nuovo controller adattivo
  contro Rust/EVM, OPA, Gitea e Docker reali, poi unire *nella stessa sessione*
  branch da main e Draft PR già validati separatamente. I codici TS sono solo
  una diagnosi iniziale: mancano posizioni, messaggi tecnici sanificati e letture
  di codice autorizzate tramite Gateway. Il recovery deve supportare anche altri
  tipi di errore e specialisti, senza modificare la root firmata né fare retry
  ciechi di provider ambigui. Conservare soltanto Account Suspension, test
  gratuiti prima di Gemini e PR #38 Draft.

Non avviare suite native complete a ogni commit. Usare test mirati e Fast CI;
riservare la prova nativa a checkpoint di integrazione significativi. PR #38 Draft,
nessun merge o modifica di main.
