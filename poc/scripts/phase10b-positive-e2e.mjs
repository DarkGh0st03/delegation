import assert from "node:assert/strict";
import {
  DelegationEvidenceHandler,
  DeterministicA2AOrchestrator,
  GatewayControlledToolClient,
  createSpecializedAgentController,
  modelVisibleTaskContext,
  startSpecializedAgentServer
} from "@thesis/agent-runtime";
import {
  AccountSuspensionSequentialCoordinator,
  DelegatedA2ARoleRunner,
  DeterministicOrchestratorAuthorityIssuer,
  OrchestratorProtectedGatewayClient,
  SoftwareEngineerAuthorityBootstrap
} from "@thesis/orchestrator-runtime";

const gateway = process.env.GATEWAY_SMOKE_URL ?? "http://127.0.0.1:8080";
const adapter = process.env.DELEGATION_ADAPTER_URL ?? "http://127.0.0.1:8090";
const gitea = process.env.GITEA_SMOKE_BASE_URL;
const giteaToken = process.env.GITEA_GATEWAY_TOKEN;
const giteaOwner = process.env.GITEA_OWNER ?? "thesis";
const giteaRepository = process.env.GITEA_REPOSITORY ?? "iam-console-poc";
const expectedMainRevision =
  process.env.EXPECTED_GITEA_REVISION ??
  "405748b1e77992b6bd8630a3ab6f990658d32f6b";

const tokens = {
  engineer: process.env.ADAPTER_CALLER_ENGINEER,
  orchestrator: process.env.ADAPTER_CALLER_ORCHESTRATOR,
  backend: process.env.ADAPTER_CALLER_BACKEND,
  frontend: process.env.ADAPTER_CALLER_FRONTEND,
  test: process.env.ADAPTER_CALLER_TEST
};

for (const [name, value] of Object.entries(tokens)) {
  if (!value) throw new Error("Missing required Adapter token for " + name);
}
if (!gitea) throw new Error("Missing GITEA_SMOKE_BASE_URL");
if (!giteaToken) throw new Error("Missing GITEA_GATEWAY_TOKEN");

const rootCredentialId =
  process.env.ORCHESTRATOR_ROOT_CREDENTIAL_ID ??
  "urn:phase10b:orchestrator-root";

const FEATURE_FILES = {
  "packages/shared/src/account-status.ts": "/**\n * Account lifecycle states exposed by the IAM console.\n */\nexport type AccountStatus = \"ACTIVE\" | \"SUSPENDED\";\n\nexport const ACCOUNT_STATUS = {\n  ACTIVE: \"ACTIVE\",\n  SUSPENDED: \"SUSPENDED\"\n} as const satisfies Record<string, AccountStatus>;\n",
  "apps/backend/src/users/user.service.ts": "import {\n  ACCOUNT_STATUS,\n  type AccountStatus,\n  type UpdateUserProfileInput,\n  type UserDetails,\n  type UserSummary\n} from \"@iam/shared\";\nimport { InMemoryUserRepository } from \"./user.repository.js\";\n\nexport class UserNotFoundError extends Error {\n  constructor(id: string) {\n    super(\"User \" + id + \" was not found.\");\n    this.name = \"UserNotFoundError\";\n  }\n}\n\nexport class AccountStatusConflictError extends Error {\n  constructor(\n    id: string,\n    readonly currentStatus: AccountStatus,\n    readonly requestedStatus: AccountStatus\n  ) {\n    super(\n      \"User \" +\n        id +\n        \" cannot transition from \" +\n        currentStatus +\n        \" to \" +\n        requestedStatus +\n        \".\"\n    );\n    this.name = \"AccountStatusConflictError\";\n  }\n}\n\nexport class UserService {\n  constructor(private readonly repository: InMemoryUserRepository) {}\n\n  listUsers(): UserSummary[] {\n    return this.repository.findAll().map(({ id, displayName, email, status }) => ({\n      id,\n      displayName,\n      email,\n      status\n    }));\n  }\n\n  getUser(id: string): UserDetails {\n    const user = this.repository.findById(id);\n    if (!user) {\n      throw new UserNotFoundError(id);\n    }\n    return user;\n  }\n\n  updateProfile(id: string, input: UpdateUserProfileInput): UserDetails {\n    const user = this.repository.findById(id);\n    if (!user) {\n      throw new UserNotFoundError(id);\n    }\n\n    return this.repository.save({\n      ...user,\n      displayName: input.displayName,\n      email: input.email,\n      department: input.department,\n      jobTitle: input.jobTitle\n    });\n  }\n\n  suspendUser(id: string): UserDetails {\n    return this.transitionStatus(\n      id,\n      ACCOUNT_STATUS.ACTIVE,\n      ACCOUNT_STATUS.SUSPENDED\n    );\n  }\n\n  reactivateUser(id: string): UserDetails {\n    return this.transitionStatus(\n      id,\n      ACCOUNT_STATUS.SUSPENDED,\n      ACCOUNT_STATUS.ACTIVE\n    );\n  }\n\n  private transitionStatus(\n    id: string,\n    expectedStatus: AccountStatus,\n    nextStatus: AccountStatus\n  ): UserDetails {\n    const user = this.repository.findById(id);\n    if (!user) {\n      throw new UserNotFoundError(id);\n    }\n    if (user.status !== expectedStatus) {\n      throw new AccountStatusConflictError(id, user.status, nextStatus);\n    }\n    return this.repository.save({ ...user, status: nextStatus });\n  }\n}\n",
  "apps/backend/src/users/user.controller.ts": "import type { NextFunction, Request, Response } from \"express\";\nimport { z } from \"zod\";\nimport {\n  AccountStatusConflictError,\n  UserNotFoundError,\n  UserService\n} from \"./user.service.js\";\n\nconst updateProfileSchema = z.object({\n  displayName: z.string().trim().min(1).max(120),\n  email: z.string().trim().email().max(200),\n  department: z.string().trim().min(1).max(120),\n  jobTitle: z.string().trim().min(1).max(120)\n});\n\nexport function createUserController(service: UserService) {\n  return {\n    listUsers(_request: Request, response: Response): void {\n      response.json(service.listUsers());\n    },\n\n    getUser(request: Request, response: Response, next: NextFunction): void {\n      try {\n        response.json(service.getUser(String(request.params.id)));\n      } catch (error) {\n        next(error);\n      }\n    },\n\n    updateProfile(request: Request, response: Response, next: NextFunction): void {\n      try {\n        const input = updateProfileSchema.parse(request.body);\n        response.json(service.updateProfile(String(request.params.id), input));\n      } catch (error) {\n        next(error);\n      }\n    },\n\n    suspendUser(request: Request, response: Response, next: NextFunction): void {\n      try {\n        response.json(service.suspendUser(String(request.params.id)));\n      } catch (error) {\n        next(error);\n      }\n    },\n\n    reactivateUser(request: Request, response: Response, next: NextFunction): void {\n      try {\n        response.json(service.reactivateUser(String(request.params.id)));\n      } catch (error) {\n        next(error);\n      }\n    }\n  };\n}\n\nexport function userErrorHandler(\n  error: unknown,\n  _request: Request,\n  response: Response,\n  _next: NextFunction\n): void {\n  if (error instanceof UserNotFoundError) {\n    response.status(404).json({ code: \"USER_NOT_FOUND\", message: error.message });\n    return;\n  }\n\n  if (error instanceof AccountStatusConflictError) {\n    response.status(409).json({\n      code: \"ACCOUNT_STATUS_CONFLICT\",\n      message: error.message\n    });\n    return;\n  }\n\n  if (error instanceof z.ZodError) {\n    response.status(400).json({\n      code: \"INVALID_INPUT\",\n      message: \"The supplied user profile is invalid.\",\n      details: error.flatten()\n    });\n    return;\n  }\n\n  response.status(500).json({\n    code: \"INTERNAL_ERROR\",\n    message: \"Unexpected server error.\"\n  });\n}\n",
  "apps/backend/src/users/user.routes.ts": "import { Router } from \"express\";\nimport { createUserController } from \"./user.controller.js\";\nimport { InMemoryUserRepository } from \"./user.repository.js\";\nimport { UserService } from \"./user.service.js\";\n\nexport function createUserRouter(\n  repository: InMemoryUserRepository = new InMemoryUserRepository()\n): Router {\n  const router = Router();\n  const controller = createUserController(new UserService(repository));\n\n  router.get(\"/\", controller.listUsers);\n  router.get(\"/:id\", controller.getUser);\n  router.patch(\"/:id/profile\", controller.updateProfile);\n  router.post(\"/:id/suspend\", controller.suspendUser);\n  router.post(\"/:id/reactivate\", controller.reactivateUser);\n\n  return router;\n}\n",
  "apps/frontend/src/api/users-api.ts": "import type {\n  ApiError,\n  UpdateUserProfileInput,\n  UserDetails,\n  UserSummary\n} from \"@iam/shared\";\n\nconst ADMIN_HEADERS = {\n  \"x-demo-role\": \"admin\"\n};\n\nasync function parseResponse<T>(response: Response): Promise<T> {\n  if (!response.ok) {\n    const error = (await response.json()) as ApiError;\n    throw new Error(error.message ?? \"Request failed with \" + response.status);\n  }\n  return (await response.json()) as T;\n}\n\nexport async function listUsers(): Promise<UserSummary[]> {\n  return parseResponse<UserSummary[]>(\n    await fetch(\"/api/users\", { headers: ADMIN_HEADERS })\n  );\n}\n\nexport async function getUser(id: string): Promise<UserDetails> {\n  return parseResponse<UserDetails>(\n    await fetch(\"/api/users/\" + encodeURIComponent(id), { headers: ADMIN_HEADERS })\n  );\n}\n\nexport async function updateUserProfile(\n  id: string,\n  input: UpdateUserProfileInput\n): Promise<UserDetails> {\n  return parseResponse<UserDetails>(\n    await fetch(\"/api/users/\" + encodeURIComponent(id) + \"/profile\", {\n      method: \"PATCH\",\n      headers: {\n        ...ADMIN_HEADERS,\n        \"content-type\": \"application/json\"\n      },\n      body: JSON.stringify(input)\n    })\n  );\n}\n\nexport async function suspendUser(id: string): Promise<UserDetails> {\n  return parseResponse<UserDetails>(\n    await fetch(\"/api/users/\" + encodeURIComponent(id) + \"/suspend\", {\n      method: \"POST\",\n      headers: ADMIN_HEADERS\n    })\n  );\n}\n\nexport async function reactivateUser(id: string): Promise<UserDetails> {\n  return parseResponse<UserDetails>(\n    await fetch(\"/api/users/\" + encodeURIComponent(id) + \"/reactivate\", {\n      method: \"POST\",\n      headers: ADMIN_HEADERS\n    })\n  );\n}\n",
  "apps/frontend/src/pages/UserDetailPage.tsx": "import { type FormEvent, useEffect, useState } from \"react\";\nimport { Link, useParams } from \"react-router-dom\";\nimport type { UpdateUserProfileInput, UserDetails } from \"@iam/shared\";\nimport {\n  getUser,\n  reactivateUser,\n  suspendUser,\n  updateUserProfile\n} from \"../api/users-api.js\";\nimport { UserStatusBadge } from \"../components/UserStatusBadge.js\";\n\nexport function UserDetailPage() {\n  const { id = \"\" } = useParams();\n  const [user, setUser] = useState<UserDetails>();\n  const [form, setForm] = useState<UpdateUserProfileInput>();\n  const [message, setMessage] = useState<string>();\n  const [error, setError] = useState<string>();\n  const [statusPending, setStatusPending] = useState(false);\n\n  useEffect(() => {\n    getUser(id)\n      .then((loaded) => {\n        setUser(loaded);\n        setForm({\n          displayName: loaded.displayName,\n          email: loaded.email,\n          department: loaded.department,\n          jobTitle: loaded.jobTitle\n        });\n      })\n      .catch((reason: unknown) => {\n        setError(reason instanceof Error ? reason.message : \"Unable to load user.\");\n      });\n  }, [id]);\n\n  async function handleSubmit(event: FormEvent) {\n    event.preventDefault();\n    if (!form) return;\n\n    setMessage(undefined);\n    setError(undefined);\n    try {\n      const updated = await updateUserProfile(id, form);\n      setUser(updated);\n      setMessage(\"Profile updated successfully.\");\n    } catch (reason) {\n      setError(reason instanceof Error ? reason.message : \"Unable to update profile.\");\n    }\n  }\n\n  async function changeStatus(action: \"suspend\" | \"reactivate\") {\n    setMessage(undefined);\n    setError(undefined);\n    setStatusPending(true);\n    try {\n      const updated =\n        action === \"suspend\" ? await suspendUser(id) : await reactivateUser(id);\n      setUser(updated);\n      setMessage(\n        action === \"suspend\"\n          ? \"Account suspended successfully.\"\n          : \"Account reactivated successfully.\"\n      );\n    } catch (reason) {\n      setError(reason instanceof Error ? reason.message : \"Unable to update account status.\");\n    } finally {\n      setStatusPending(false);\n    }\n  }\n\n  if (error && !user) {\n    return <p className=\"error-message\">{error}</p>;\n  }\n\n  if (!user || !form) {\n    return <p>Loading user...</p>;\n  }\n\n  return (\n    <section>\n      <Link to=\"/\">← Back to users</Link>\n\n      <div className=\"page-header detail-header\">\n        <div>\n          <p className=\"eyebrow\">User details</p>\n          <h1>{user.displayName}</h1>\n        </div>\n        <UserStatusBadge status={user.status} />\n      </div>\n\n      <div className=\"notice\">\n        Administrators can suspend an active account and reactivate a suspended\n        account without changing the user profile.\n      </div>\n\n      <div className=\"account-actions\" aria-label=\"Account actions\">\n        {user.status === \"ACTIVE\" ? (\n          <button\n            type=\"button\"\n            disabled={statusPending}\n            onClick={() => void changeStatus(\"suspend\")}\n          >\n            Suspend account\n          </button>\n        ) : (\n          <button\n            type=\"button\"\n            disabled={statusPending}\n            onClick={() => void changeStatus(\"reactivate\")}\n          >\n            Reactivate account\n          </button>\n        )}\n      </div>\n\n      <form className=\"profile-form\" onSubmit={handleSubmit}>\n        <label>\n          Display name\n          <input\n            value={form.displayName}\n            onChange={(event) => setForm({ ...form, displayName: event.target.value })}\n          />\n        </label>\n\n        <label>\n          Email\n          <input\n            type=\"email\"\n            value={form.email}\n            onChange={(event) => setForm({ ...form, email: event.target.value })}\n          />\n        </label>\n\n        <label>\n          Department\n          <input\n            value={form.department}\n            onChange={(event) => setForm({ ...form, department: event.target.value })}\n          />\n        </label>\n\n        <label>\n          Job title\n          <input\n            value={form.jobTitle}\n            onChange={(event) => setForm({ ...form, jobTitle: event.target.value })}\n          />\n        </label>\n\n        <button type=\"submit\">Save profile</button>\n      </form>\n\n      {message ? <p className=\"success-message\">{message}</p> : null}\n      {error ? <p className=\"error-message\">{error}</p> : null}\n    </section>\n  );\n}\n",
  "apps/frontend/src/styles.css": ":root {\n  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;\n  color: #15233f;\n  background: #f5f7fb;\n}\n\n* { box-sizing: border-box; }\nbody { margin: 0; }\na { color: #255bb8; text-decoration: none; }\nbutton, input { font: inherit; }\n\n.app-shell {\n  width: min(1040px, calc(100% - 32px));\n  margin: 0 auto;\n  padding: 48px 0 80px;\n}\n\n.page-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 24px;\n  margin-bottom: 24px;\n}\n\n.detail-header { margin-top: 30px; }\nh1 { margin: 4px 0 0; font-size: 2.1rem; }\n.eyebrow { margin: 0; color: #66758f; font-weight: 700; text-transform: uppercase; font-size: .75rem; letter-spacing: .12em; }\n\n.baseline-label,\n.status-badge {\n  border-radius: 999px;\n  padding: 7px 12px;\n  font-weight: 750;\n  font-size: .8rem;\n}\n.baseline-label { background: #e8eefb; color: #315a9d; }\n.status-active { background: #dff6e9; color: #16633b; }\n.status-suspended { background: #fde8e8; color: #9b1c1c; }\n\n.user-grid { display: grid; gap: 12px; }\n.user-card {\n  background: white;\n  border: 1px solid #dce3ef;\n  border-radius: 14px;\n  padding: 18px 20px;\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  box-shadow: 0 8px 25px rgba(25, 45, 80, .05);\n}\n.user-card strong, .user-card span { display: block; }\n.user-card span { color: #6d7890; margin-top: 4px; }\n\n.notice {\n  background: #fff8df;\n  border: 1px solid #efdda0;\n  padding: 14px 16px;\n  border-radius: 10px;\n  margin-bottom: 16px;\n}\n\n.account-actions {\n  display: flex;\n  gap: 12px;\n  margin-bottom: 24px;\n}\n.account-actions button {\n  border: 0;\n  border-radius: 8px;\n  padding: 11px 18px;\n  background: #9b1c1c;\n  color: white;\n  font-weight: 750;\n  cursor: pointer;\n}\n.account-actions button:disabled {\n  cursor: wait;\n  opacity: .65;\n}\n\n.profile-form {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 16px;\n  background: white;\n  border: 1px solid #dce3ef;\n  padding: 24px;\n  border-radius: 14px;\n}\n.profile-form label { display: grid; gap: 7px; font-weight: 650; }\n.profile-form input {\n  border: 1px solid #c9d3e4;\n  border-radius: 8px;\n  padding: 11px 12px;\n}\n.profile-form button {\n  width: fit-content;\n  border: 0;\n  border-radius: 8px;\n  padding: 11px 18px;\n  background: #255bb8;\n  color: white;\n  font-weight: 750;\n  cursor: pointer;\n}\n\n.success-message { color: #16633b; }\n.error-message { color: #a32929; }\n\n@media (max-width: 700px) {\n  .profile-form { grid-template-columns: 1fr; }\n  .page-header { align-items: flex-start; }\n}\n",
  "tests/backend/user.service.test.ts": "import { describe, expect, it } from \"vitest\";\nimport { InMemoryUserRepository } from \"../../apps/backend/src/users/user.repository.js\";\nimport {\n  AccountStatusConflictError,\n  UserService\n} from \"../../apps/backend/src/users/user.service.js\";\n\ndescribe(\"UserService account lifecycle\", () => {\n  it(\"lists seeded users as ACTIVE\", () => {\n    const service = new UserService(new InMemoryUserRepository());\n    expect(service.listUsers()).toHaveLength(3);\n    expect(service.listUsers().every((user) => user.status === \"ACTIVE\")).toBe(true);\n  });\n\n  it(\"updates profile information without changing status\", () => {\n    const service = new UserService(new InMemoryUserRepository());\n    const before = service.getUser(\"usr-001\");\n\n    const updated = service.updateProfile(\"usr-001\", {\n      displayName: \"Alice R.\",\n      email: \"alice.r@example.test\",\n      department: \"Platform Engineering\",\n      jobTitle: \"Senior Software Engineer\"\n    });\n\n    expect(updated.displayName).toBe(\"Alice R.\");\n    expect(updated.status).toBe(before.status);\n  });\n\n  it(\"suspends and reactivates an account\", () => {\n    const service = new UserService(new InMemoryUserRepository());\n\n    expect(service.suspendUser(\"usr-001\").status).toBe(\"SUSPENDED\");\n    expect(service.reactivateUser(\"usr-001\").status).toBe(\"ACTIVE\");\n  });\n\n  it(\"rejects repeated state transitions\", () => {\n    const service = new UserService(new InMemoryUserRepository());\n\n    service.suspendUser(\"usr-001\");\n    expect(() => service.suspendUser(\"usr-001\")).toThrow(\n      AccountStatusConflictError\n    );\n\n    service.reactivateUser(\"usr-001\");\n    expect(() => service.reactivateUser(\"usr-001\")).toThrow(\n      AccountStatusConflictError\n    );\n  });\n});\n",
  "tests/backend/user.routes.test.ts": "import request from \"supertest\";\nimport { describe, expect, it } from \"vitest\";\nimport { createApp } from \"../../apps/backend/src/app.js\";\n\nconst ADMIN = { \"x-demo-role\": \"admin\" };\n\ndescribe(\"User API account lifecycle\", () => {\n  it(\"rejects unauthenticated user requests\", async () => {\n    await request(createApp()).get(\"/api/users\").expect(401);\n  });\n\n  it(\"returns users to the demo administrator\", async () => {\n    const response = await request(createApp())\n      .get(\"/api/users\")\n      .set(ADMIN)\n      .expect(200);\n\n    expect(response.body).toHaveLength(3);\n  });\n\n  it(\"supports profile updates\", async () => {\n    const response = await request(createApp())\n      .patch(\"/api/users/usr-001/profile\")\n      .set(ADMIN)\n      .send({\n        displayName: \"Alice Updated\",\n        email: \"alice.updated@example.test\",\n        department: \"Engineering\",\n        jobTitle: \"Staff Engineer\"\n      })\n      .expect(200);\n\n    expect(response.body.displayName).toBe(\"Alice Updated\");\n    expect(response.body.status).toBe(\"ACTIVE\");\n  });\n\n  it(\"supports ACTIVE to SUSPENDED to ACTIVE transitions\", async () => {\n    const app = createApp();\n\n    const suspended = await request(app)\n      .post(\"/api/users/usr-001/suspend\")\n      .set(ADMIN)\n      .expect(200);\n    expect(suspended.body.status).toBe(\"SUSPENDED\");\n\n    const reactivated = await request(app)\n      .post(\"/api/users/usr-001/reactivate\")\n      .set(ADMIN)\n      .expect(200);\n    expect(reactivated.body.status).toBe(\"ACTIVE\");\n  });\n\n  it(\"returns 409 for duplicate account transitions\", async () => {\n    const app = createApp();\n\n    await request(app)\n      .post(\"/api/users/usr-001/suspend\")\n      .set(ADMIN)\n      .expect(200);\n    await request(app)\n      .post(\"/api/users/usr-001/suspend\")\n      .set(ADMIN)\n      .expect(409);\n\n    await request(app)\n      .post(\"/api/users/usr-001/reactivate\")\n      .set(ADMIN)\n      .expect(200);\n    await request(app)\n      .post(\"/api/users/usr-001/reactivate\")\n      .set(ADMIN)\n      .expect(409);\n  });\n});\n",
  "tests/frontend/UserDetailPage.test.tsx": "import React from \"react\";\nimport { render, screen, waitFor } from \"@testing-library/react\";\nimport { MemoryRouter, Route, Routes } from \"react-router-dom\";\nimport { afterEach, describe, expect, it, vi } from \"vitest\";\nimport { UserDetailPage } from \"../../apps/frontend/src/pages/UserDetailPage.js\";\n\nafterEach(() => {\n  vi.unstubAllGlobals();\n});\n\nfunction mockUser(status: \"ACTIVE\" | \"SUSPENDED\") {\n  vi.stubGlobal(\n    \"fetch\",\n    vi.fn().mockResolvedValue({\n      ok: true,\n      json: async () => ({\n        id: \"usr-001\",\n        displayName: \"Alice Romano\",\n        email: \"alice.romano@example.test\",\n        department: \"Engineering\",\n        jobTitle: \"Software Engineer\",\n        status\n      })\n    })\n  );\n}\n\nfunction renderPage() {\n  render(\n    <MemoryRouter initialEntries={[\"/users/usr-001\"]}>\n      <Routes>\n        <Route path=\"/users/:id\" element={<UserDetailPage />} />\n      </Routes>\n    </MemoryRouter>\n  );\n}\n\ndescribe(\"UserDetailPage account lifecycle\", () => {\n  it(\"shows Suspend for an ACTIVE account\", async () => {\n    mockUser(\"ACTIVE\");\n    renderPage();\n\n    await waitFor(() => expect(screen.getByText(\"Alice Romano\")).toBeInTheDocument());\n    expect(screen.getByText(\"ACTIVE\", { exact: true })).toBeInTheDocument();\n    expect(screen.getByRole(\"button\", { name: /suspend account/i })).toBeInTheDocument();\n  });\n\n  it(\"shows Reactivate for a SUSPENDED account\", async () => {\n    mockUser(\"SUSPENDED\");\n    renderPage();\n\n    await waitFor(() => expect(screen.getByText(\"Alice Romano\")).toBeInTheDocument());\n    expect(screen.getByText(\"SUSPENDED\", { exact: true })).toBeInTheDocument();\n    expect(screen.getByRole(\"button\", { name: /reactivate account/i })).toBeInTheDocument();\n  });\n});\n",
  "tests/e2e/account-suspension.spec.ts": "import { expect, test } from \"@playwright/test\";\n\ntest(\"administrator can suspend and reactivate an account\", async ({ page }) => {\n  await page.goto(\"/\");\n  await expect(page.getByRole(\"heading\", { name: \"Users\" })).toBeVisible();\n  await page.getByText(\"Alice Romano\").click();\n\n  await expect(page.getByText(\"ACTIVE\", { exact: true })).toBeVisible();\n  await page.getByRole(\"button\", { name: /suspend account/i }).click();\n\n  await expect(page.getByText(\"SUSPENDED\", { exact: true })).toBeVisible();\n  await page.getByRole(\"button\", { name: /reactivate account/i }).click();\n\n  await expect(page.getByText(\"ACTIVE\", { exact: true })).toBeVisible();\n});\n"
};

const PLANS = {
  backend: {
    reads: [
      "packages/shared/src/account-status.ts",
      "apps/backend/src/users/user.service.ts",
      "apps/backend/src/users/user.controller.ts",
      "apps/backend/src/users/user.routes.ts",
      "apps/backend/src/users/user.model.ts",
      "apps/backend/src/users/user.repository.ts"
    ],
    writes: [
      ["update_file", "packages/shared/src/account-status.ts"],
      ["update_file", "apps/backend/src/users/user.service.ts"],
      ["update_file", "apps/backend/src/users/user.controller.ts"],
      ["update_file", "apps/backend/src/users/user.routes.ts"]
    ],
    runTests: false
  },
  frontend: {
    reads: [
      "packages/shared/src/account-status.ts",
      "apps/frontend/src/api/users-api.ts",
      "apps/frontend/src/pages/UserDetailPage.tsx",
      "apps/frontend/src/styles.css"
    ],
    writes: [
      ["update_file", "apps/frontend/src/api/users-api.ts"],
      ["update_file", "apps/frontend/src/pages/UserDetailPage.tsx"],
      ["update_file", "apps/frontend/src/styles.css"]
    ],
    runTests: false
  },
  test: {
    reads: [
      "tests/backend/user.service.test.ts",
      "tests/backend/user.routes.test.ts",
      "tests/frontend/UserDetailPage.test.tsx",
      "tests/e2e/user-profile.spec.ts"
    ],
    writes: [
      ["update_file", "tests/backend/user.service.test.ts"],
      ["update_file", "tests/backend/user.routes.test.ts"],
      ["update_file", "tests/frontend/UserDetailPage.test.tsx"],
      ["create_file", "tests/e2e/account-suspension.spec.ts"]
    ],
    runTests: true
  }
};

async function waitForHealth(url, label) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(label + " did not become healthy");
}

async function giteaGet(path) {
  const response = await fetch(gitea + path, {
    headers: {
      authorization: "token " + giteaToken,
      accept: "application/json"
    }
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error("Gitea GET " + path + " -> " + response.status + ": " + raw);
  }
  return raw ? JSON.parse(raw) : {};
}

function controlledClient(context, role, adapterToken) {
  return new GatewayControlledToolClient({
    gatewayBaseUrl: gateway,
    agentRole: role,
    taskId: context.task_id,
    evidenceHandler: new DelegationEvidenceHandler({
      adapterBaseUrl: adapter,
      adapterToken,
      evidence: context.delegation_evidence
    })
  });
}

function calls(prefixValue, operations) {
  return operations.map((operation, index) => ({
    call_id: prefixValue + "_" + index,
    name: operation.name,
    arguments: JSON.stringify(operation.arguments)
  }));
}

class Phase10BScriptedModel {
  constructor(role) {
    this.role = role;
    this.turn = 0;
    this.plan = PLANS[role];
  }

  verifyPrevious(input) {
    if (!Array.isArray(input)) return;
    for (const output of input) {
      const parsed = JSON.parse(output.output);
      assert.equal(parsed.ok, true, JSON.stringify(parsed));
    }
  }

  async respond(requestValue) {
    this.verifyPrevious(requestValue.input);
    this.turn += 1;
    const modelId = "gpt-5.6-sol-phase10b-scripted-" + this.role;

    if (this.turn === 1) {
      return {
        response_id: "phase10b_" + this.role + "_read",
        model_id: modelId,
        output_text: "",
        function_calls: calls(
          "read_" + this.role,
          this.plan.reads.map((path) => ({
            name: "read_file",
            arguments: {
              branch: "feature/account-suspension",
              path
            }
          }))
        )
      };
    }

    if (this.turn === 2) {
      return {
        response_id: "phase10b_" + this.role + "_write",
        model_id: modelId,
        output_text: "",
        function_calls: calls(
          "write_" + this.role,
          this.plan.writes.map(([name, path]) => ({
            name,
            arguments: {
              branch: "feature/account-suspension",
              path,
              content: FEATURE_FILES[path]
            }
          }))
        )
      };
    }

    if (this.plan.runTests && this.turn === 3) {
      return {
        response_id: "phase10b_" + this.role + "_tests",
        model_id: modelId,
        output_text: "",
        function_calls: [
          {
            call_id: "run_tests_" + this.role,
            name: "run_tests",
            arguments: JSON.stringify({
              branch: "feature/account-suspension",
              profile: "poc-default"
            })
          }
        ]
      };
    }

    return {
      response_id: "phase10b_" + this.role + "_done",
      model_id: modelId,
      output_text:
        this.role === "test"
          ? "Account Suspension implementation and exact-SHA validation completed."
          : "Account Suspension " + this.role + " implementation completed.",
      function_calls: []
    };
  }
}

function taskHandler(role, token) {
  return async (context) => {
    const client = controlledClient(context, role, token);
    const runtime = createSpecializedAgentController({
      role,
      modelClient: new Phase10BScriptedModel(role),
      gatewayClient: client,
      maxIterations: 6
    });
    const result = await runtime.controller.run(modelVisibleTaskContext(context));

    if (result.status !== "completed") {
      throw new Error(role + " Agent Controller did not complete: " + result.summary);
    }
    if (!result.revision) {
      throw new Error(role + " Agent Controller produced no protected revision");
    }

    const errors = result.controlled_failures.map(
      (failure) => failure.kind + ": " + failure.message
    );
    if (errors.length > 0) {
      throw new Error(role + " Agent Controller reported controlled failures: " + errors.join("; "));
    }

    if (role === "test") {
      if (
        result.project_tests !== "pass" ||
        result.researcher_acceptance !== "pass" ||
        result.tested_commit_sha !== result.revision
      ) {
        throw new Error(
          "Test Agent gate failed: " +
            JSON.stringify({
              revision: result.revision,
              tested_commit_sha: result.tested_commit_sha,
              project_tests: result.project_tests,
              researcher_acceptance: result.researcher_acceptance
            })
        );
      }
    }

    return {
      role,
      summary: result.summary,
      files_modified: result.files_modified,
      files_created: result.files_created,
      branch: context.subtask.branch,
      revision: result.revision,
      commit_sha: result.revision,
      test_outcome: role === "test" ? "pass" : "not_run",
      errors: [],
      model_id: result.model_id ?? "unknown-model",
      model_iterations: result.iterations,
      ...(role === "test"
        ? {
            tested_commit_sha: result.tested_commit_sha,
            runner_profile: result.runner_profile,
            project_tests: result.project_tests,
            researcher_acceptance: result.researcher_acceptance
          }
        : {})
    };
  };
}

const adapterHealth = await waitForHealth(adapter + "/health", "Delegation Adapter");
assert.equal(adapterHealth.trust_profile, "evm");
const gatewayHealth = await waitForHealth(gateway + "/health", "Gateway");
assert.equal(gatewayHealth.provider, "gitea");
const runnerHealth = await waitForHealth(
  (process.env.TEST_RUNNER_URL ?? "http://127.0.0.1:8091") + "/health",
  "Controlled Test Runner"
);
assert.equal(runnerHealth.execution, "configured");

const bootstrap = new SoftwareEngineerAuthorityBootstrap({
  adapterBaseUrl: adapter,
  bearerToken: tokens.engineer
});

await bootstrap.issueOrchestratorRoot({
  credential_id: rootCredentialId,
  valid_from: new Date().toISOString(),
  validity_seconds: 7200,
  credential_status: {
    type: "BitstringStatusListEntry",
    statusPurpose: "revocation",
    statusListIndex: "9700",
    statusListCredential:
      "https://status.example/lists/phase10b-positive-e2e"
  }
});

const protectedGateway = new OrchestratorProtectedGatewayClient({
  gatewayBaseUrl: gateway,
  adapterBaseUrl: adapter,
  adapterToken: tokens.orchestrator,
  rootCredentialId
});

const backendServer = await startSpecializedAgentServer({
  role: "backend",
  port: 43451,
  taskHandler: taskHandler("backend", tokens.backend)
});
const frontendServer = await startSpecializedAgentServer({
  role: "frontend",
  port: 43452,
  taskHandler: taskHandler("frontend", tokens.frontend)
});
const testServer = await startSpecializedAgentServer({
  role: "test",
  port: 43453,
  taskHandler: taskHandler("test", tokens.test)
});

try {
  const coordinator = new AccountSuspensionSequentialCoordinator({
    gateway: protectedGateway,
    roleRunner: new DelegatedA2ARoleRunner({
      authorityIssuer: new DeterministicOrchestratorAuthorityIssuer({
        adapterBaseUrl: adapter,
        bearerToken: tokens.orchestrator
      }),
      a2a: new DeterministicA2AOrchestrator()
    }),
    rootCredentialId,
    agentBaseUrls: {
      backend: backendServer.baseUrl,
      frontend: frontendServer.baseUrl,
      test: testServer.baseUrl
    },
    statusListCredential:
      "https://status.example/lists/phase10b-positive-e2e",
    childValiditySeconds: 3600
  });

  const result = await coordinator.run();
  assert.equal(result.workflow.state, "pr_created");
  assert.deepEqual(result.workflow.completed_roles, [
    "backend",
    "frontend",
    "test"
  ]);

  const backendArtifact = result.delegated_tasks.backend.artifact;
  const frontendArtifact = result.delegated_tasks.frontend.artifact;
  const testArtifact = result.delegated_tasks.test.artifact;
  const testedRevision = testArtifact.tested_commit_sha;

  assert.notEqual(backendArtifact.revision, result.branch.revision);
  assert.notEqual(frontendArtifact.revision, backendArtifact.revision);
  assert.equal(testArtifact.project_tests, "pass");
  assert.equal(testArtifact.researcher_acceptance, "pass");
  assert.equal(testArtifact.runner_profile, "poc-default");
  assert.equal(testedRevision, testArtifact.revision);
  assert.equal(result.pull_request.revision, testedRevision);
  assert.equal(result.workflow.pull_request?.head_revision, testedRevision);

  for (const artifact of [
    backendArtifact,
    frontendArtifact,
    testArtifact
  ]) {
    assert.match(
      artifact.model_id ?? "",
      /^gpt-5\.6-sol-phase10b-scripted-/u
    );
  }

  const providerPr = await giteaGet(
    "/api/v1/repos/" +
      encodeURIComponent(giteaOwner) +
      "/" +
      encodeURIComponent(giteaRepository) +
      "/pulls/" +
      result.pull_request.pull_request_number
  );
  assert.equal(providerPr.head?.ref, "feature/account-suspension");
  assert.equal(providerPr.base?.ref, "main");
  assert.equal(providerPr.head?.sha, testedRevision);

  const mainBranch = await giteaGet(
    "/api/v1/repos/" +
      encodeURIComponent(giteaOwner) +
      "/" +
      encodeURIComponent(giteaRepository) +
      "/branches/main"
  );
  assert.equal(mainBranch.commit?.id, expectedMainRevision);

  const featureBranch = await giteaGet(
    "/api/v1/repos/" +
      encodeURIComponent(giteaOwner) +
      "/" +
      encodeURIComponent(giteaRepository) +
      "/branches/feature%2Faccount-suspension"
  );
  assert.equal(featureBranch.commit?.id, testedRevision);

  assert.equal(backendServer.executor.executionCount, 1);
  assert.equal(frontendServer.executor.executionCount, 1);
  assert.equal(testServer.executor.executionCount, 1);

  process.stdout.write(
    JSON.stringify(
      {
        result: "phase10b-positive-e2e-pass",
        trust_profile: adapterHealth.trust_profile,
        workflow_state: result.workflow.state,
        completed_roles: result.workflow.completed_roles,
        baseline_revision: result.branch.revision,
        backend_revision: backendArtifact.revision,
        frontend_revision: frontendArtifact.revision,
        tested_commit_sha: testedRevision,
        project_tests: testArtifact.project_tests,
        researcher_acceptance: testArtifact.researcher_acceptance,
        pull_request_number: result.pull_request.pull_request_number,
        main_unchanged: true,
        automatic_merge: false,
        model_ids: {
          backend: backendArtifact.model_id,
          frontend: frontendArtifact.model_id,
          test: testArtifact.model_id
        }
      },
      null,
      2
    ) + "\n"
  );
} finally {
  await testServer.close().catch(() => undefined);
  await frontendServer.close().catch(() => undefined);
  await backendServer.close().catch(() => undefined);
}
