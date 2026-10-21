// Static, non-sensitive demo fixture. NEVER treat this as delegated authority.
// This matches poc/packages/plan-contracts/schema/workflow-plan.schema.json v1.
globalThis.DELEGATION_MOCK_PLAN = {
  schema_version: "1.0.0",
  plan_id: "plan-demo-iam-suspension",
  session_id: "session-demo-approval",
  version: 1,
  repository: {
    authority: "gitea.local",
    owner: "thesis",
    repository: "iam-console-poc"
  },
  base_revision: "405748b1e77992b6bd8630a3ab6f990658d32f6b",
  requirement: "Implementa la sospensione e la riattivazione degli account utente.",
  candidate_agents: [
    { agent_id:"backend", did:"did:thesis:backend-agent", card_ref:"trusted-registry:backend" },
    { agent_id:"frontend", did:"did:thesis:frontend-agent", card_ref:"trusted-registry:frontend" },
    { agent_id:"test", did:"did:thesis:test-agent", card_ref:"trusted-registry:test" }
  ],
  tasks: [
    {
      id:"branch-1", agent_id:"orchestrator", title:"Preparare il branch di lavoro",
      description:"Creare un branch isolato dalla revisione analizzata.",
      depends_on:[],
      resources:["gitea://gitea.local/thesis/iam-console-poc"]
    },
    {
      id:"backend-1", agent_id:"backend", title:"Implementare API backend",
      description:"Aggiungere le transizioni ACTIVE ↔ SUSPENDED e i relativi endpoint.",
      depends_on:["branch-1"],
      resources:[
        "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/src/users/user.service.ts",
        "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/src/users/user.routes.ts"
      ]
    },
    {
      id:"frontend-1", agent_id:"frontend", title:"Aggiornare l'interfaccia",
      description:"Mostrare stato account e azioni Suspend/Reactivate.",
      depends_on:["backend-1"],
      resources:[
        "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/frontend/src/pages/UserDetailPage.tsx"
      ]
    },
    {
      id:"test-1", agent_id:"test", title:"Implementare ed eseguire i test",
      description:"Verificare endpoint, UI e transizioni non valide.",
      depends_on:["backend-1","frontend-1"],
      resources:[
        "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/tests/backend/user.service.test.ts",
        "gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension"
      ]
    },
    {
      id:"pr-1", agent_id:"orchestrator", title:"Aprire la Pull Request",
      description:"Creare la PR dopo la verifica dei risultati dei test.",
      depends_on:["test-1"],
      resources:["gitea://gitea.local/thesis/iam-console-poc"]
    }
  ],
  requested_permissions: [
    {id:"p1",task_id:"branch-1",agent_id:"orchestrator",operation:"create_branch",resource:"gitea://gitea.local/thesis/iam-console-poc",reason:"Creare un branch di lavoro isolato"},
    {id:"p2",task_id:"backend-1",agent_id:"backend",operation:"update_file",resource:"gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/src/users/user.service.ts",reason:"Implementare le transizioni dello stato"},
    {id:"p3",task_id:"backend-1",agent_id:"backend",operation:"update_file",resource:"gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/backend/src/users/user.routes.ts",reason:"Esporre gli endpoint API"},
    {id:"p4",task_id:"frontend-1",agent_id:"frontend",operation:"update_file",resource:"gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/apps/frontend/src/pages/UserDetailPage.tsx",reason:"Esporre i controlli nell'interfaccia"},
    {id:"p5",task_id:"test-1",agent_id:"test",operation:"create_file",resource:"gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension/files/tests/backend/user.service.test.ts",reason:"Aggiungere test di regressione"},
    {id:"p6",task_id:"test-1",agent_id:"test",operation:"run_tests",resource:"gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension",reason:"Eseguire test sul branch di lavoro"},
    {id:"p7",task_id:"pr-1",agent_id:"orchestrator",operation:"create_pull_request",resource:"gitea://gitea.local/thesis/iam-console-poc",reason:"Presentare il risultato per revisione umana"}
  ],
  assumptions: ["Scenario IAM Console fisso per il PoC GitHub Actions"],
  uncertainties: ["I file effettivi saranno confermati dalla scansione read-only"]
};
// UI mock suggestion list only. The authoritative operation catalog is in Rust.
globalThis.DELEGATION_MOCK_OPERATION_CHOICES = [
  "read_repository","list_directory","read_file","create_file","update_file",
  "write_file","create_branch","create_pull_request","run_tests","read_test_results"
];
