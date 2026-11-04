
# R180 — Audit di raggiungibilità MCP e Private Worker

Branch: `refactor/post-prof-plan-contracts-20261021`.
Baseline auditata: `23ce341117f9c35aff388bc230c621e39f33422e` (R179); il commit R180 introduce
il blocco operativo dei due entry point legacy, senza richiamare Gemini.

## Esito, verificato sulle importazioni effettive

| Componente | Tratto raggiungibile | Decisione |
| --- | --- | --- |
| `poc/apps/a2a-agent/src/main.ts` | ADK FunctionTools → `GatewayControlledToolClient` | **MANTENERE**; vietare `ADK_MCP_SHARED_URL` e `ADK_MCP_{UPDATE_FILE,CREATE_FILE,RUN_TESTS}` all'avvio operativo |
| `poc/mcp-shared/src/main.ts` | MCP crypto `delegation_create_presentation` → `TaskRouter.createPresentation` | **MANTENERE** come listener crypto-only; `MCP_TOOL_PROFILE=legacy` viene rifiutato |
| `poc/mcp-shared/src/http-server.ts` | `profile=crypto` registra una sola operazione; `profile=legacy` richiama `registerLegacyRepositoryTools` | **MODIFICARE**: rimuovere l'alternativa storica dopo aver migrato i test HTTP; produzione già preclusa dal launcher |
| `poc/mcp-shared/src/legacy-repository-tools.ts` | Quattro registrazioni repository/Runner, invocate dalla sola factory legacy | **ELIMINARE** dopo migrazione regressioni legacy |
| `poc/mcp-shared/src/task-router.ts` | Il metodo `createPresentation` resta necessario al MCP crittografico; `readFile`, `updateFile`, `createFile`, `runTests` servono al ramo legacy | **DIVIDERE**: conservare inoltro crypto; rimuovere instradamento repository dopo migrazione dei test |
| `poc/packages/agent-runtime/src/private-mcp-worker-http.ts` | `/internal/mcp-crypto-call` → `PrivateMcpTaskRegistry.invokeCrypto` | **MANTENERE LA PARTE CRYPTO**; rimuovere `/internal/mcp-tool-call` storico con le dipendenze |
| `poc/packages/agent-runtime/src/private-mcp-task-registry.ts` | `stageGatewayChallenge`, `invokeCrypto`, `takeSignedProof` → VP trusted | **MANTENERE LA PARTE CRYPTO**; ripulire vecchio `invoke` repository in una fase separata |
| `poc/packages/agent-runtime/src/trusted-crypto-mcp-bridge.ts` | Cliente MCP trusted → reference alla VP privata | **MANTENERE**: ritorna un riferimento opaco, non la chiave o la VP al modello |
| `poc/packages/agent-runtime/src/adk-specialized-agents.ts` | `FunctionTool` diretto al Gateway nel percorso firmato; `MCPToolset` storico con `mcpReadFile` | **MODIFICARE**: rimuovere ramo legacy e test basati su di esso, lasciando invariato il modello ADK firmato |
| `poc/packages/agent-runtime/src/mcp-task-fetch.ts` e `timed-mcp-run-tests.ts` | Strumenti repository via MCP storico | **ELIMINARE** una volta eliminati i chiamanti |

## Chiusura dei confini di lancio (R180)

1. Il comando operativo `npm --prefix poc/mcp-shared start` può pubblicare solo il catalogo crypto. L'opt-in `MCP_TOOL_PROFILE=legacy` ora fallisce **prima di aprire la porta**.
2. Il launcher A2A operativo rifiuta `ADK_MCP_SHARED_URL` e i flag che sostituivano FunctionTools con repository MCP; `ADK_MCP_CRYPTO_URL` resta consentito. Non è un'autorizzazione: le DC, Core Rust, Gateway e OPA restano autoritativi.
3. I fixture storici possono ancora importare `createSharedMcpHttpServer({profile:"legacy"})` direttamente. Tale factory non è raggiungibile attraverso il comando operativo principale, ma **il codice non è ancora fisicamente eliminato**.
4. Non cancellare l'intero Private MCP Worker: la sua porzione crypto mantiene la challenge privata, l'identità del Task e la VP firmata fuori dal contesto Gemini. La rimozione indiscriminata interromperebbe il percorso richiesto dal professore.

## Criterio per dichiarare concluso R6

**Non ancora soddisfatto fisicamente**: migrare le regressioni storiche di HTTP/MCP e ADK,
poi eliminare `legacy-repository-tools.ts`, il ramo `MCPToolset` repository,
l'inoltro `/internal/mcp-tool-call` e i metodi solo legacy del router/registry.
Verificare successivamente Cumulative + Functional Signed DAG + D1 sulla
**stessa nuova SHA**. Nessuna esecuzione Gemini a pagamento senza consenso.

## R181 — isolato anche il codice caricato dal listener in produzione

Il listener MCP di produzione ora costruisce `CryptoWorkerRouter` con il
solo metodo `createPresentation` e la sola rotta privata
`/internal/mcp-crypto-call`. Non importa/istanzia più `TaskRouter`,
che include `readFile/updateFile/createFile/runTests`.
La factory `http-server.ts` carica `legacy-repository-tools.ts`
**dinamicamente e solo** nel ramo storico `profile:"legacy"`;
il comando operativo R180 può usare soltanto `profile:"crypto"`.

Il test di integrazione MCP crittografico usa direttamente il nuovo router.
I vecchi router/fixture restano nei test storici fino alla migrazione delle
suite. I confini active Task, challenge del Gateway, autorizzazione Core Rust
e OPA non sono sostituiti da questa separazione.

## R182 — Private Worker operativo: nessuna route repository

Il server A2A adesso registra il worker privato in modalità
`crypto` quando il Task usa soltanto `ADK_MCP_CRYPTO_URL`:
in questo caso viene esposta `/internal/mcp-crypto-call`, mentre
`/internal/mcp-tool-call` **non è registrata**. La modalità `legacy`
è esplicita soltanto nei fixture/test storici; il launcher operativo
R180 non consente l'endpoint MCP repository che la richiederebbe.

Il test HTTP crittografico reale verifica inoltre che il percorso
repository risponda 404 pur mantenendo funzionante l'emissione
della VP e la restituzione privata one-shot. Le API storiche rimangono
fisicamente presenti solo per le suite di regressione da migrare;
non sono state confuse con il worker crittografico necessario.
