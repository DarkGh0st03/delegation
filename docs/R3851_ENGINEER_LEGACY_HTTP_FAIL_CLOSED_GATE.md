# R385.1 — Gate fail-closed contro l'HTTP Adapter Root nel profilo authority-only

Data: 8 novembre 2026. Branch:
`refactor/post-prof-plan-contracts-20261021`, PR #38 Draft.
Questa fase completa l'isolamento di caricamento R385.0 con una
**separazione comportamentale** anche per chiamanti che importano
direttamente il modulo storico.

## Minaccia e confine

In R385.0 il selettore `createTrustedEngineerCredentialPort`
sceglieva prioritariamente Rust Node-API, poi Rust Unix, e solo in
assenza di configurazioni native permetteva il vecchio MCP/HTTP.
Tuttavia `createOwnerPrivateMcpEngineerCredentialPort` e la nuova
`createLegacyOwnerPrivateMcpEngineerCredentialPort` erano ancora
richiamabili **direttamente** da un modulo con accesso al processo
owner. Un caller che conoscesse l'URL storico avrebbe potuto ignorare
la policy del selettore se l'architettura era authority-only.

Non e' accettabile che il Software Engineer authority-only impieghi un
MCP tra il proprio modulo fiduciario e il Core Rust, ne' che il
vecchio trasporto HTTP operi come fallback quando il Rust Core manca.

## Implementazione

- Nuovo guard puro `trusted-engineer-legacy-fixture-gate.ts`:
  rifiuta la fixture se `DELEGATION_GATEWAY_ARCHITECTURE=authority-only`,
  `APPROVED_RUNNER_NATIVE_MCP=1`,
  `ENGINEER_CORE_NATIVE_MODE=1` oppure
  `ADAPTER_ENGINEER_NATIVE_SOCKET` e' definito (anche vuoto).
- `trusted-engineer-crypto-port.ts` controlla il guard nella
  factory legacy, prima della scelta del fallback e **a ogni
  richiesta di emissione/revoca**. La modifica della modalita'
  dopo la costruzione di una porta non permette di riutilizzarla.
- `trusted-engineer-legacy-mcp-http-port.ts` controlla lo stesso
  guard nella factory compatibile, nelle richieste e nel callback
  privato **prima dell'effetto Rust/HTTP**, evitando bypass via import
  diretto e cambi di modalita' durante l'handshake MCP.
- Le fixture con profilo esplicitamente non nativo mantengono
  `createOwnerPrivateMcpEngineerCredentialPort` e i test storici.
  Nessun nuovo servizio, endpoint, approvazione o provider e' creato.

## Regressioni

I test `trusted-engineer-crypto-port.test.ts` verificano:
1. Rifiuto dei due entrypoint legacy (wrapper e modulo diretto)
   quando l'architettura e' `authority-only`, senza chiamate HTTP;
2. Rifiuto di emissione e revoca dopo che un port legacy gia'
   costruito viene esposto a un cambio di profilo;
3. I precedenti test di emissione preliminare/operativa, revoca
   confermata, grant esatti, errore Rust senza disclosure e assenza
   di fallback restano invariati.
Il test statico `r3850-engineer-issuer-boundary.test.mjs`
verifica che le due factory condividano il nuovo guard.

I test fanno parte della Fast CI gratuita. **L'esito R385.1 deve
essere verificato sulla SHA finale prima di dichiarare PASS.**

## Prossimi gate

Il vecchio HTTP Adapter e' ancora presente per gli E2E storici;
non eliminarlo finche' l'audit dei caller non e' concluso.
Restano migrazione/isolation dei restanti handoff Signed DAG,
verifica native Rust/Gateway/MCP task-local, review Engineer Ed25519,
Runner Docker, Gitea CAS, PR Draft; native E2E end-to-end **post-cleanup**
sulla stessa SHA della validazione gratuita finale.
Non avviare Gemini a pagamento senza nuovo consenso esplicito.
Nessun merge di `main`.
