/** Two *distinct software requirements* against the same pinned IAM-console baseline.
 * These are OFFLINE scripted implementation fixtures, not AI-generated code.
 * The signed plan enumerates every modified resource independently.
 */
import {ACCOUNT_SUSPENSION_REFERENCE_FILES} from "./account-suspension-reference.mjs";

function replaceExact(files,path,before,after){
  const current=files[path];
  if(typeof current!=="string"||!current.includes(before))
    throw Error("Fixture source changed unexpectedly: "+path);
  files[path]=current.replace(before,after);
}

function departmentDirectoryFiles(){
  const files={...ACCOUNT_SUSPENSION_REFERENCE_FILES};
  replaceExact(files,"apps/backend/src/users/user.service.ts",
    "  getUser(id: string): UserDetails {",
`  /** Independent requirement: filter the directory, not account lifecycle. */
  listUsersByDepartment(department: string): UserSummary[] {
    const query = department.trim().toLocaleLowerCase();
    if (!query) return [];
    return this.repository.findAll()
      .filter((user) => user.department.toLocaleLowerCase() === query)
      .map(({ id, displayName, email, status }) => ({
        id, displayName, email, status
      }));
  }

  getUser(id: string): UserDetails {`);
  replaceExact(files,"apps/backend/src/users/user.controller.ts",
    "    getUser(request: Request, response: Response, next: NextFunction): void {",
`    listUsersByDepartment(request: Request, response: Response): void {
      const department = String(request.params.department);
      response.json(service.listUsersByDepartment(department));
    },

    getUser(request: Request, response: Response, next: NextFunction): void {`);
  replaceExact(files,"apps/backend/src/users/user.routes.ts",
    '  router.get("/:id", controller.getUser);',
`  // Static prefix must precede the dynamic user-id route.
  router.get("/by-department/:department", controller.listUsersByDepartment);
  router.get("/:id", controller.getUser);`);
  replaceExact(files,"apps/frontend/src/api/users-api.ts",
    "export async function getUser(id: string): Promise<UserDetails> {",
`export async function listUsersByDepartment(department: string): Promise<UserSummary[]> {
  return parseResponse<UserSummary[]>(
    await fetch("/api/users/by-department/" + encodeURIComponent(department), {
      headers: ADMIN_HEADERS
    })
  );
}

export async function getUser(id: string): Promise<UserDetails> {`);
  replaceExact(files,"apps/frontend/src/pages/UserDetailPage.tsx",
    "  getUser,\n  reactivateUser,",
    "  getUser,\n  listUsersByDepartment,\n  reactivateUser,");
  replaceExact(files,"apps/frontend/src/pages/UserDetailPage.tsx",
    '  const [statusPending, setStatusPending] = useState(false);',
`  const [statusPending, setStatusPending] = useState(false);
  const [departmentCount, setDepartmentCount] = useState<number>();`);
  replaceExact(files,"apps/frontend/src/pages/UserDetailPage.tsx",
    '  async function handleSubmit(event: FormEvent) {',
`  useEffect(() => {
    if (!user?.department) return;
    let active = true;
    listUsersByDepartment(user.department)
      .then((users) => { if (active) setDepartmentCount(users.length); })
      .catch(() => { if (active) setDepartmentCount(undefined); });
    return () => { active = false; };
  }, [user?.department]);

  async function handleSubmit(event: FormEvent) {`);
  replaceExact(files,"apps/frontend/src/pages/UserDetailPage.tsx",
    '      <form className="profile-form" onSubmit={handleSubmit}>',
`      <section aria-label="Department directory" className="department-directory">
        <h2>Department directory</h2>
        <p>Colleagues in {user.department}: {
          departmentCount === undefined ? "Loading" : departmentCount
        }</p>
      </section>

      <form className="profile-form" onSubmit={handleSubmit}>`);
  replaceExact(files,"tests/backend/user.service.test.ts",
    '  it("suspends and reactivates an account", () => {',
`  it("filters a directory case-insensitively without changing account status", () => {
    const service = new UserService(new InMemoryUserRepository());
    const department = service.getUser("usr-001").department;
    const members = service.listUsersByDepartment("  " + department.toUpperCase() + " ");
    expect(members.some((user) => user.id === "usr-001")).toBe(true);
    expect(service.listUsersByDepartment("no-such-department")).toEqual([]);
    expect(service.getUser("usr-001").status).toBe("ACTIVE");
  });

  it("suspends and reactivates an account", () => {`);
  replaceExact(files,"tests/backend/user.routes.test.ts",
    '  it("supports profile updates", async () => {',
`  it("returns only department colleagues with admin authorization", async () => {
    const app = createApp();
    const own = await request(app).get("/api/users/usr-001").set(ADMIN).expect(200);
    const department = own.body.department;
    const route = "/api/users/by-department/" + encodeURIComponent(department);
    await request(app).get(route).expect(401);
    const filtered = await request(app).get(route).set(ADMIN).expect(200);
    expect(filtered.body.some((member: {id:string}) => member.id === "usr-001"))
      .toBe(true);
    await request(app).get("/api/users/by-department/nonexistent")
      .set(ADMIN).expect(200, []);
  });

  it("supports profile updates", async () => {`);
  files["tests/e2e/account-suspension.spec.ts"]+=`

test("department directory search is available through the real UI and API", async ({ page, request }) => {
  const user = await request.get("/api/users/usr-001", {
    headers: { "x-demo-role": "admin" }
  });
  expect(user.ok()).toBeTruthy();
  const department = (await user.json()).department as string;
  const response = await request.get(
    "/api/users/by-department/" + encodeURIComponent(department),
    { headers: { "x-demo-role": "admin" } }
  );
  expect(response.ok()).toBeTruthy();
  const colleagues = (await response.json()) as Array<{ id: string }>;
  expect(colleagues.some((member) => member.id === "usr-001")).toBeTruthy();
  await page.goto("/users/usr-001");
  const panel = page.getByRole("region", { name: "Department directory" });
  await expect(panel.getByText("Colleagues in " + department + ": " + colleagues.length))
    .toBeVisible();
});
`;
  return Object.freeze(files);
}
const department=departmentDirectoryFiles();
const previous=Object.keys(ACCOUNT_SUSPENSION_REFERENCE_FILES).sort();
const current=Object.keys(department).sort();
if(JSON.stringify(previous)!==JSON.stringify(current))throw Error("Fixture key mismatch");
// Offline signed Task descriptions; executable changes still must originate
// from the agent's actual read_file result, never a complete reference file.
const ROUTE_TASK_INTENT=Object.freeze({
  "account-suspension":[
    "Implement approved backend account suspension and reactivation.",
    "ROUTE POST /:id/suspend suspendUser AFTER PATCH /:id/profile",
    "ROUTE POST /:id/reactivate reactivateUser AFTER POST /:id/suspend",
    "CONTROLLER HANDLER suspendUser CALL suspendUser",
    "CONTROLLER HANDLER reactivateUser CALL reactivateUser",
    "CONTROLLER ERROR AccountStatusConflictError STATUS 409 CODE ACCOUNT_STATUS_CONFLICT",
    "STATUS TYPE AccountStatus CONST ACCOUNT_STATUS ADD SUSPENDED"
  ].join("\n"),
  "department-directory":[
    "Implement approved backend directory while preserving account lifecycle.",
    "ROUTE GET /by-department/:department listUsersByDepartment BEFORE GET /:id",
    "ROUTE POST /:id/suspend suspendUser AFTER PATCH /:id/profile",
    "ROUTE POST /:id/reactivate reactivateUser AFTER POST /:id/suspend"
  ].join("\n")
});
const IAM_EDIT_INTENT=Object.freeze({
  backend:Object.freeze([
    "packages/shared/src/account-status.ts",
    "apps/backend/src/users/user.service.ts",
    "apps/backend/src/users/user.controller.ts",
    "apps/backend/src/users/user.routes.ts",
    "tests/backend/user.service.test.ts",
    "tests/backend/user.routes.test.ts"
  ]),
  frontend:Object.freeze([
    "apps/frontend/src/api/users-api.ts",
    "apps/frontend/src/pages/UserDetailPage.tsx",
    "apps/frontend/src/styles.css",
    "tests/frontend/UserDetailPage.test.tsx"
  ])
});
const IAM_TEST_FILE="tests/e2e/account-suspension.spec.ts";
export const APPROVED_OFFLINE_SCENARIOS=Object.freeze({
  "account-suspension":Object.freeze({
    id:"account-suspension",requirement:"Implement account suspension and reactivation",
    fixtureBranch:"feature/account-suspension",workBranch:"feature/native-planning-read",
    statusIndexBase:18071,
    files:ACCOUNT_SUSPENSION_REFERENCE_FILES,
    planning_intent:Object.freeze({edits:IAM_EDIT_INTENT,newTestFile:IAM_TEST_FILE,
      taskInstructions:{backend:ROUTE_TASK_INTENT["account-suspension"]}})
  }),
  "department-directory":Object.freeze({
    id:"department-directory",
    requirement:"Provide authorized, case-insensitive user directory search by department",
    fixtureBranch:"feature/department-directory",
    workBranch:"feature/native-department-directory",
    statusIndexBase:18171,
    files:department,
    planning_intent:Object.freeze({edits:IAM_EDIT_INTENT,newTestFile:IAM_TEST_FILE,
      taskInstructions:{backend:ROUTE_TASK_INTENT["department-directory"]}})
  })
});
export function getApprovedOfflineScenario(id="account-suspension"){
  if(!Object.hasOwn(APPROVED_OFFLINE_SCENARIOS,id))
    throw Error("Unsupported approved offline scenario");
  const selected=APPROVED_OFFLINE_SCENARIOS[id];
  return selected;
}
