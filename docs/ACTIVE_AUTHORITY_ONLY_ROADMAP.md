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
- **Branch R354:** implementazione owner/ADK/Gateway/provider con root, revisione
  immutabile di main e lettore indipendente. Test mirati locali PASS; prova nativa
  del branch e sua integrazione al workflow completo ancora da realizzare.
- **Prossima integrazione:** il vecchio harness native crea e popola il branch prima
  dell'approvazione e usa quel suo HEAD come baseline. Non basta chiamare il nuovo
  executor: occorre una baseline main revisionata correttamente e creare il branch
  soltanto dopo l'approvazione attraverso Gateway. Conservare l'unico scenario Account
  Suspension e dichiarare esplicitamente il codice ancora prodotto dalla fixture.

Non avviare suite native complete a ogni commit. Usare test mirati e Fast CI;
riservare la prova nativa a checkpoint di integrazione significativi. PR #38 Draft,
nessun merge o modifica di main.
