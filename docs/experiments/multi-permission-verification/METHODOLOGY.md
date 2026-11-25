# Fase 1 — Benchmark della verifica multi-permesso: metodologia

**Stato:** esperimento, branch `experiment/multi-permission-verification-benchmark`, base `main` @ `97547d24`.
**Vincoli rispettati:** nessuna modifica al workflow operativo, al formato delle credenziali, agli smart contract o al core (`src/`). Nessuna API a pagamento. `main` invariato.

## 1. Domanda

A parità di autorizzazioni richieste, quanto costa verificare **k permessi con k VP separate** (una per permesso, come oggi nel percorso operativo) rispetto a **una sola VP che ne divulga k** (verifica multi-permesso già implementata: `AuthorizationContext::new_multiple`, `DirectCoreRustVerifier.verifyMultiple`)?

Variabile indipendente: k ∈ {1, 2, 5, 10, 15, 32, 64, 128} (128 è il limite del core, `AuthorizationContext`).
Fattori: modalità (`single`, `multi`) × configurazione della catena (vedi §3).
Variabili dipendenti: latenza di verifica, di generazione della VP e totale; latenza per permesso; dimensione della VP; numero di interrogazioni al trust layer; esito (accettato/rifiutato) dei casi negativi.

## 2. Cosa misura e cosa non misura

Il binario `examples/multi_permission_benchmark.rs` usa **solo l'API pubblica** del crate e compone il verificatore **come il binding nativo del Gateway** (`services/delegation-core-node/src/lib.rs::verify_real`):

```
DelegationVerifier(
  EvmTrustResolver(TrustChainReader, AccumulatorMaterialProvider, VerificationKeyProvider),
  EvmAnchoredStatusListResolver(JwtAuthenticatedStatusListCredentialProvider, StatusListAnchorReader))
```

Sono reali: firma e verifica Ed25519 della VP, selective disclosure (`retain_only`), verifica dei membership witness (pairing BN254, `vb_accumulator`), metadati, gerarchia e `pp`, attenuazione (`covers`), scadenze, impegni del materiale di accumulatore (keccak), Status List firmate JWT EdDSA, compresse GZIP e ancorate per hash.

Sono **in memoria** (al posto di RPC Anvil, file degli artefatti e risoluzione `did:ethr` via `node`) le **sorgenti** del trust layer. Ogni interfaccia è avvolta da un contatore:

| Contatore | Interfaccia | In produzione |
|---|---|---|
| `q_identity_status`, `q_trust_anchor`, `q_latest_material_version`, `q_material_anchor` | `TrustChainReader` | `eth_call` su EnterpriseTrustRegistry / IssuerRegistry |
| `q_status_anchor` | `StatusListAnchorReader` | `eth_call` su IssuerRegistry |
| `q_accumulator_data` | `AccumulatorMaterialProvider` | lettura file artefatti pubblici |
| `q_status_list_fetch` | `StatusListCredentialProvider` | lettura file Status List |
| `q_verification_key` | `VerificationKeyProvider` | risoluzione DID Document (`node resolve-did-json.mjs`, un processo per chiamata) |

Quindi: **le latenze isolano il costo crittografico e di parsing del core**; **i contatori danno il numero esatto di interrogazioni** che un deployment reale eseguirebbe per la stessa verifica. Il costo reale di ogni interrogazione **non è misurato** qui (vedi §7).

## 3. Configurazioni

Credenziale con **N = 128 permessi** `read_file` su file distinti (`gitea://gitea.local/team/app/branches/feature%2Fs1/files/src/module_NNN.ts`), sempre la stessa per ogni k: cambia solo quanti ne vengono divulgati e richiesti.

| Config | Presentatore | Catena | Profondità |
|---|---|---|---|
| `root` | Orchestrator | Root (Engineer → Orchestrator), 128 file | 0 |
| `child` | Backend | Root 128 file → Child 128 file | 1 |
| `child_dirscope` | Backend | Root con **una** directory `directories/src` → Child 128 file (usa `pp` e la copertura gerarchica Gitea) | 1 |

`single`: k VP, ciascuna con 1 permesso e challenge propria, k verifiche. `multi`: 1 VP con k permessi, 1 verifica con `required_permissions` = k.

## 4. Protocollo

- Build `--release`, feature di default (come il binding di produzione: nessun `parallel_verification`).
- Processo singolo, thread singolo. Fixture (issuer, catene, Status List) creata una volta per configurazione; non è nel tempo misurato.
- 3 ripetizioni di warm-up scartate, **30 ripetizioni** misurate. In ogni ripetizione le 16 condizioni (8 k × 2 modalità) sono eseguite in **ordine casuale** (xorshift, seed registrato in `run-meta.json`).
- Tempo misurato con `std::time::Instant` (monotono). `gen_us` = creazione e firma delle VP (escluso il `clone` della credenziale); `verify_us` = `verify_verifiable_presentation`; `total_us` = somma.
- I contatori sono azzerati prima di ogni verifica e letti subito dopo.
- Per ogni prova si controlla che la verifica riesca e che la profondità restituita sia quella attesa (`ok`, `depth_ok`).

## 5. Casi negativi (10 ripetizioni, k ∈ {1, 10, 128})

| Caso | Mutazione | Esito atteso |
|---|---|---|
| `required_not_delegated` | un requisito fuori dalla credenziale | rifiuto dell'intero batch |
| `required_not_disclosed` | un requisito delegato ma non divulgato | rifiuto |
| `operation_escalation` | `update_file` richiesto, `read_file` delegato | rifiuto |
| `unheld_permission_requested` | il wallet riceve la richiesta di divulgare un permesso che non ha | `retain_only` lo scarta in silenzio; la verifica rifiuta |
| `forged_permission_reused_witness` | il titolare **modifica e rifirma** la propria VP aggiungendo un permesso e riusando un witness valido | firma valida; rifiuto da parte dell'accumulatore |
| `witness_swap` | il titolare rifirma la VP con due witness scambiati | rifiuto da parte dell'accumulatore |
| `wrong_challenge` | VP preparata per un'altra challenge | rifiuto |
| `revoked_root` | Root revocata (Status List aggiornata e ri-ancorata) | rifiuto |
| `revoked_child` | Child revocata (solo config Child) | rifiuto |
| `batch_over_128` | 129 requisiti | rifiuto prima della crittografia |
| `control_valid_batch` | batch valido dopo il ripristino degli stati | accettato |

## 6. Riproduzione

```bash
cargo build --release --example multi_permission_benchmark
./target/release/examples/multi_permission_benchmark --out docs/experiments/multi-permission-verification/raw/default --reps 30 --warmup 3 --neg-reps 10
python3 -I docs/experiments/multi-permission-verification/analyze.py docs/experiments/multi-permission-verification/raw/default
```

Variante esplorativa (non usata in produzione): `--features parallel_verification`.

## 7. Limiti e minacce alla validità

- **Trust layer non reale.** La latenza assoluta in produzione è dominata dalle interrogazioni (storico Phase 12C, `cbadb544`: verifica SSI/EVM ≈ 1,6 s per operazione). Qui se ne misura il **numero**, non il costo. Una stima del tempo reale richiede di misurare il costo medio per tipo di interrogazione sullo stack reale (Fase 1b, non eseguita).
- **Ambiente condiviso.** VM KVM a 4 vCPU; rumore di altri processi possibile. Mitigazioni: warm-up, ordine casuale, mediane e percentili, 30 ripetizioni.
- **Un solo tipo di permesso** (`read_file` su file). Risorse più lunghe cambiano la dimensione della VP, non il numero di pairing.
- **Toolchain.** rustc locale 1.97.0; l'immagine Docker del progetto usa 1.99.0.
- **Non misura** Prepare, OPA, binding del Gateway, provider: riguarda solo la verifica crittografica della delega e la generazione della VP.
