# R384.6 — Primo ritiro del legacy operativo (8 novembre 2026)

**Contesto:** roadmap `docs/ACTIVE_AUTHORITY_ONLY_ROADMAP.md`, PR #38
(`refactor/post-prof-plan-contracts-20261021`, Draft). Questa fase segue
R384.5, che ha Fast CI e Authenticated Engineer Approval SUCCESS su
`bf663547349346c8af0dc8f68865f4100693c509`.

## Perimetro già ritirato

| Elemento | Evidenza | Esito |
| --- | --- | --- |
| `startProtectedGeminiOwnerSession` in `run-trusted-gemini-owner.mjs` | L'API pubblicata per compatibilità lancia immediatamente un DENY, indipendentemente dalla modalità; nessun file protetto, modello, Rust Root o provider viene toccato | **Legacy Signed DAG non più avviabile dal launcher** |
| CLI `run-trusted-gemini-owner.mjs` | Rifiuta la modalità diversa da `authority-only` prima di bootstrap e lettura del modello | **Nessun fallback al launcher precedente** |
| `.github/workflows/gemini-paid-shared-mcp-final.yml` | Sia `account-suspension` sia `f1-real-gitea-planning` richiedono `if: ${{ false }}` | **Entrambi i job fatturabili sempre SKIPPED** |
| Regressione offline `trusted-authority-only-legacy-retirement.test.mjs` | Controlla rifiuto dell'API, modalità CLI e i **due** job, più i confini canonici | Aggiunta a Fast CI, esito sulla nuova SHA da confermare |

**Nota sul workflow:** l'archivio YAML rimane per permettere di
individuare configurazioni e riferimenti storici. Un utente può ancora
vedere il workflow manuale, ma nessun job originale deve partire.
Non considerare questa conservazione una certificazione del pilot.

## Matrice reachability: candidati, non eliminazioni automatiche

| Categoria | Percorsi da verificare | Trattamento |
| --- | --- | --- |
| Runtime DAG storico | `poc/packages/orchestrator-runtime/src/trusted-reviewed-approved-dag.ts` | Candidato: verificare importatori diretti, runtime e test prima di eliminare |
| Recovery basato sul DAG | `trusted-operational-repair-planner.ts`, `trusted-repair-dag-controller.ts` | Candidati: controllare edge verso CI e test di sicurezza |
| Adapter legacy | `authority-adapter-transport.ts`, eventuali listener HTTP opzionali | Isolare solo dopo verifica dei consumatori; conservare il Core Rust |
| Workflow storici gratuiti | `functional-signed-dag-e2e.yml`, `engineer-embedded-signed-dag-e2e.yml`, checkpoint intermedi | Conservare temporaneamente come regressioni, poi consolidare |
| Servizi crittografici attivi | Core Rust, issuer/verifier, `poc/mcp-shared` per Child/VP, Gateway Rust + OPA | **Non eliminare**: dipendenze dell'architettura canonica |
| Approval e Runner | Engineer permission-only, Ed25519, journaling, CAS, evidence MAC, Test Runner | **Non eliminare**: invarianti di sicurezza |

Il vecchio inventario `poc/scripts/r6-legacy-references.mjs` analizza
import statici, script, workflow ed entrypoint configurati. La sua
documentazione avverte che l'assenza di un arco statico **non** prova
che un file sia irrilevante: vanno ispezionati anche gli import dinamici
e le attivazioni non letterali. Non rimuovere un candidato soltanto
perché il nome sembra obsoleto.

## Ulteriori gate, prima del pilot Gemini

1. Attendere Fast CI della SHA di R384.6 e correggere tutte le regressioni.
2. Costruire reachability distinta per codice, test, YAML, npm, Rust, import
   dinamici e riferimenti configurati; migrare o isolare ogni consumatore.
3. Consolidare le regressioni utili ed eliminare gli eseguibili DAG storici
   realmente non raggiungibili, in commit piccoli e verificabili.
4. Eseguire un E2E completo **dopo** il cleanup sulla stessa SHA delle
   regressioni finali.
5. Consentire il **solo pilot authority-only locale** con review Engineer,
   token/permission invariati e consenso esplicito prima dei costi Gemini.

Il ritiro iniziale non amplia la Root, non crea Child, non modifica `main`,
non avvia Gemini e non certifica autonomia generativa.
