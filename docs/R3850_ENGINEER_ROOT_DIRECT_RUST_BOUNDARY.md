# R385.0 — Software Engineer Root: separazione runtime Rust da fixture MCP/HTTP

Data: 8 novembre 2026. Branch:
`refactor/post-prof-plan-contracts-20261021`. PR #38 Draft.

## Problema

Nella fase R384.9 abbiamo rimosso l'export pubblico di
`SoftwareEngineerAuthorityBootstrap`, ma il selettore
`trusted-engineer-crypto-port.ts` continuava a caricare **all'import del
modulo** il client `authority-client.ts` e
`mcp-shared/src/owner-private-child-mcp.ts`, anche quando la configurazione
owner selezionava il Core Rust tramite Node-API (`ENGINEER_CORE_NATIVE_MODE=1`).

Questi moduli sono ancora utili per fixture e regressioni storiche,
ma l'architettura concordata dal professore non ammette un MCP intermedio
tra **Software Engineer** e **Core Rust**. Orchestrator e agenti, invece,
usano il MCP crittografico task-local per Child/VP.

## Intervento implementato

1. Creato `poc/packages/orchestrator-runtime/src/trusted-engineer-legacy-mcp-http-port.ts`.
   Contiene inalterata l'emissione/revoca Root tramite
   `createOwnerPrivateCryptographicMcpSession` + il vecchio client HTTP
   `SoftwareEngineerAuthorityBootstrap`. E' un modulo di **compatibilita'**
   per le fixture: non fa parte del percorso diretto.
2. `trusted-engineer-crypto-port.ts` non importa piu' staticamente
   ne' quel client ne' il MCP privato. La vecchia
   `createOwnerPrivateMcpEngineerCredentialPort` mantiene la API
   sincrona e gli stessi metodi asincroni, ma carica il modulo legacy
   **solo su un'effettiva operazione** tramite `import()`.
   Valida URL e bearer prima di importare e congela una copia dei
   grant al momento della chiamata, prima del primo `await`.
3. `createTrustedEngineerCredentialPort` conserva la precedenza:
   - `ENGINEER_CORE_NATIVE_MODE=1`: Node-API in-process verso il
     singolo Rust CryptoRuntime; se fallisce **nessun fallback**;
   - socket Unix nativo scelto esplicitamente: compatibilita' nativa
     Rust, senza HTTP;
   - in assenza di selettori nativi, `APPROVED_RUNNER_NATIVE_MCP=1`
     rifiuta il fallback; solo il percorso di vecchie fixture con
     Adapter URL esplicito consente il bridge MCP/HTTP.
4. Nuovi controlli `r3850-engineer-issuer-boundary.test.mjs`
   verificano la separazione statica e la precedenza dei rami.
   I test `trusted-engineer-crypto-port.test.ts` verificano che il
   ponte lazy non attenui le validazioni, preservi i grant immutati e
   mantenga la revoca Root. `trusted-engineer-native-port.test.ts`
   copre socket Rust, denial e mancato downgrade.
   Tutti sono inclusi nella Fast CI gratuita.

## Limitazioni e gate

- R385.0 **isola l'import e il trasporto**, non elimina ancora
  l'HTTP Adapter per i vecchi E2E. L'engineer crypto port contiene
  ancora una via compatibile selezionabile senza il flag canonical:
  occorre verificare le attivazioni di tutti i runner e workflow prima
  di bloccarla globalmente.
- L'uso del vecchio MCP per Root in una fixture non prova l'uso del
  percorso canonico: la prova nativa separata e' necessaria.
- Core Rust, Gateway diretto, approvazione Engineer Ed25519, limiti Root,
  Child/VP task-local MCP, Runner, CAS, MAC e Draft PR non cambiano.
- Nessuna spesa API Gemini ne' merge. **R385.0 resta in verifica finche'
  Fast CI non e' SUCCESS sulla SHA finale**; a cleanup concluso ripetere
  E2E Rust/EVM/OPA/Gitea/Docker/MCP sulla medesima SHA prima del pilot.

## Lavoro successivo

Continuare la classificazione reachability degli handoff DAG legacy;
non cancellare un modulo ancora importato da test di revoca,
recovery o segnalazioni del Runner. Prima del pilot autoritativo
mantenere invariata la condizione del consenso esplicito Gemini.
