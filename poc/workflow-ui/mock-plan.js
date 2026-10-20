// Non-sensitive demonstration fixture. NEVER treat this as authority.
globalThis.DELEGATION_MOCK_PLAN = {
  schema_version: "0.1-mock",
  repository: "thesis/iam-console-poc",
  base_revision: "405748b1e77992b6bd8630a3ab6f990658d32f6b",
  requirement: "Implementa la sospensione e la riattivazione degli account utente.",
  tasks: [
    {id:"backend-1",agent:"backend",title:"Implementare API Backend",description:"Aggiungere transizioni ACTIVE ↔ SUSPENDED ed endpoint per Suspend/Reactivate.",depends_on:[]},
    {id:"frontend-1",agent:"frontend",title:"Aggiornare interfaccia utente",description:"Mostrare stato degli account e pulsanti di sospensione e riattivazione.",depends_on:["backend-1"]},
    {id:"test-1",agent:"test",title:"Validare la funzionalità",description:"Verificare endpoint, UI e transizioni non valide.",depends_on:["backend-1","frontend-1"]}
  ],
  permissions: [
    {id:"p1",role:"orchestrator",operation:"create_branch",resource:"(repository)",enabled:true},
    {id:"p2",role:"orchestrator",operation:"create_pull_request",resource:"(repository)",enabled:true},
    {id:"p3",role:"backend",operation:"update_file",resource:"apps/backend/src/users/user.service.ts",enabled:true},
    {id:"p4",role:"backend",operation:"update_file",resource:"apps/backend/src/users/user.routes.ts",enabled:true},
    {id:"p5",role:"frontend",operation:"update_file",resource:"apps/frontend/src/pages/UserDetailPage.tsx",enabled:true},
    {id:"p6",role:"test",operation:"create_file",resource:"tests/backend/user.service.test.ts",enabled:true},
    {id:"p7",role:"test",operation:"run_tests",resource:"(working branch)",enabled:true}
  ]
};