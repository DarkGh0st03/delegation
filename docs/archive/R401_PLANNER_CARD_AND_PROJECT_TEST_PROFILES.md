# R401 — Consolidamento mirato dei contratti generali

**8 novembre 2026.** Branch: `refactor/post-prof-plan-contracts-20261021`; PR #38 **Draft**, non mergiata.
Questo checkpoint segue la priorità definita dopo l'audit R400: chiudere le
rigidità di generalizzazione realmente rilevanti **senza riscrivere** l'Adaptive
Work Loop, poi inventariare la reachability prima di cancellare test e runtime
storici. Non sono state autorizzate inferenze Gemini a pagamento.

## 1. Agent Card e registro trusted (R401.2)

- `trusted-adk-planner.ts` costruisce `read_agent_card` e la lista iniziale
  degli agenti dal registro trusted passato dal proprietario della sessione.
  Non utilizza più un enum fisso Backend/Frontend/Test per la scelta dei Card.
- Le operazioni proposte vengono verificate contro le capacità dichiarate
  nella registrazione trusted, indipendentemente dai permessi concessi
  successivamente dal Software Engineer e dalla verifica del Gateway.
- La configurazione storica dei tre specialisti rimane compatibile con il PoC.
  Un nuovo ruolo richiede un ID valido, una DID e un card_ref pin, capacità
  esplicite ammesse e metadati di Agent Card forniti dal trusted owner:
  Gemini non crea nuove Card o endpoint di discovery.
- Il `trusted-authority-only-review-host.mjs` passa al Planner le stesse
  capacità dell'elenco trusted già usato dal Coordinator.
- Limite dichiarato: il **bootstrap canonico del PoC continua a
  provisionare Backend/Frontend/Test**. Il supporto a nuovi ruoli nel
  contratto Planning non dimostra, da solo, la presenza di nuovi processi
  A2A o del loro signer.

## 2. Profili trusted dei test applicativi (R401, R401.1)

- `gitea-permission-containment.mjs` espone
  `createTrustedProjectTestSourceProfile` per descrivere radici e suffissi
  dei test di un repository, con validazione e oggetto immutabile.
- Il profilo predefinito di IAM Console permette esattamente i consueti
  `tests/backend` e `tests/frontend`, con `.test.ts`/`.test.tsx`.
- Il trusted Review Host e il Decision Proposer ricevono lo **stesso**
  oggetto profilato e lo applicano alla lettura diagnostica, alla creazione
  e alla riparazione (lettura+update dello stesso file). Oggetti JSON non
  provisionati vengono rifiutati.
- Il profilo è una **restrizione di forma**, non una credenziale: ogni
  operazione richiede comunque un grant nella Root originale, una Child DC
  vincolata al Task, una VP valida, Rust/OPA e le verifiche provider.
- Non è stato ampliato il perimetro dei test di acceptance del ricercatore
  o del Runner; nessun modello può modificare il profilo trusted.

## 3. Contratto del catalogo Rust e degli adapter Gateway

Riferimenti nel codice:
- `src/delegation/authorization/operation.rs`: fonte canonica delle
  **31** operazioni riconosciute.
- `poc/apps/gateway/src/operation-catalog.ts`: copia **generata** dal
  catalogo Rust; non è un secondo catalogo autonomo.
- `poc/apps/gateway/src/types.ts` (`TOOL_NAMES`): **8** operazioni
  che possiedono uno schema/adapter esecutivo nel Gateway corrente:
  `read_repository`, `list_directory`, `read_file`, `update_file`,
  `create_file`, `create_branch`, `create_pull_request`,
  `run_tests`.
- `poc/apps/gateway/src/operation-support.ts` separa i risultati:
  `unknown`, `unavailable`, `supported`. Nella validazione Gateway,
  una operazione sconosciuta è rifiutata con `unknown_operation` (400);
  una operazione Rust nota ma senza adapter restituisce
  `provider_operation_unavailable` (501).

I tre livelli sono indipendenti:
1. **Riconoscimento**: operazione definita dal catalogo Rust.
2. **Disponibilità**: schema e provider realmente implementati nel Gateway.
3. **Autorizzazione**: Root/Child DC, VP e policy OPA concedono l'operazione
   esatta per il Task/risorsa/branch richiesto.

Il fatto che un'operazione sia nel catalogo o che un FunctionTool sia visibile
al modello **non autorizza** la sua esecuzione. Le 23 operazioni senza adapter
non richiedono automaticamente implementazione in questa fase; in particolare
`merge_pull_request` rimane soggetto al Human Gate indipendente.

## 4. Validazione e prossimo passo

R401 aggiunge casi positivi per un layout di test alternativo e negativi
per profili falsificati, percorsi non canonici, scope acceptance e grant
senza la forma richiesta. R401.2 aggiunge prove scripted di lettura Card e
rifiuto di operazioni fuori capacità. I test scripted non dimostrano
autonomia generativa e non invocano Gemini.

**Non dichiarare completato il checkpoint senza Fast CI positiva
sull'ultima SHA.** Prima del pilot pagato sono necessari inventario di
raggiungibilità/copertura, rimozione dei caller legacy non-test, test di
sicurezza preservati ed E2E nativa Rust/OPA/Gitea/Docker sull'HEAD post-cleanup.

**Prossima fase:** inventario completo (entry point, import statici/dinamici,
workflow, CLI, runtime, test unici). Le cancellazioni di moduli storici
seguono soltanto dopo il trasferimento delle responsabilità e i test
di non-reachability; nessuna quota arbitraria di file.
