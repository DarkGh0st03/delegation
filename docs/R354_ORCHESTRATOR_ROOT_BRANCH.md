# R354 — Branch dell'Orchestrator attraverso Gateway

Il primo Task della sessione può essere scelto da ADK come Orchestrator
`create_branch`, entro il grant immutabile dell'Engineer. L'owner originale registra
il Task, lo lega al Gateway e fissa la revisione approvata; non emette una Child.
Il modello non può fornire SHA, root, DID o permessi aggiuntivi come autorità.

Il runtime e l'host HTTP canonici accettano soltanto l'executor concreto appartenente
allo stesso Gateway, con abilitazione esplicita, Core Rust e OPA. Prepare, flight
one-shot persistente, VP della root a profondità zero e policy allow precedono il POST.
Il journal distingue root-branch, root-PR e Child e non consente completamenti fra
percorsi diversi. L'executor storico createBranch non viene usato nel nuovo percorso.

Il client usa `old_ref_name` con la SHA immutabile, verifica che main non sia cambiato
e che il branch non esista, poi verifica risposta e GET. Una risposta ambigua non
consente retry. Un secondo client esegue l'osservazione che completa il Task; il POST
da solo non sblocca dipendenze. Una lettura incoerente nell'owner ritira la root.
Riferimento del contratto Gitea:
https://github.com/go-gitea/gitea/blob/main/modules/structs/repo.go
https://github.com/go-gitea/gitea/blob/main/routers/api/v1/repo/branch.go

Validazione locale: 53 test sessione/Gateway (12 nuovi casi branch), quattro test
original Engineer/ADK/branch, 31 provider/host e sette runtime PASS. Le risposte del
verifier, OPA e provider nei nuovi test sono fixture esplicite: non sono prova nativa.
La PR R353.9 ha invece evidenza nativa SUCCESS nella run 42255261326.

Da completare: native branch e sostituzione della creazione branch del vecchio
harness. Quel fixture usa un HEAD feature prepopolato come baseline, mentre questa
API richiede il main approvato: la migrazione deve preservare questa differenza,
senza aggirare il controllo della revisione. Seguire ACTIVE_AUTHORITY_ONLY_ROADMAP.md.
Nessun pilot a pagamento, modifica al Core Rust, merge o effetto su main.
