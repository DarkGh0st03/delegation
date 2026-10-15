// Researcher-owned checks, independent of candidate-authored project tests.
// This directory is mounted read-only beside the exact candidate application.
import {expect,test} from "@playwright/test";

const ADMIN={"x-demo-role":"admin"};

test("researcher backend contract: shared account status exposes both lifecycle states",async()=>{
  // Import inside the test: the negative baseline may lack suspension exports,
  // which must be an assertion failure rather than a suite-collection failure.
  const target=new URL("../packages/shared/src/account-status.ts",import.meta.url);
  const {ACCOUNT_STATUS}=await import(target.href);
  expect(ACCOUNT_STATUS?.ACTIVE).toBe("ACTIVE");
  expect(ACCOUNT_STATUS?.SUSPENDED).toBe("SUSPENDED");
});

test("researcher backend contract: transitions persist status and preserve email",async()=>{
  const repositoryModule=new URL("../apps/backend/src/users/user.repository.ts",import.meta.url);
  const serviceModule=new URL("../apps/backend/src/users/user.service.ts",import.meta.url);
  const {InMemoryUserRepository}=await import(repositoryModule.href);
  const {UserService}=await import(serviceModule.href);
  const repository=new InMemoryUserRepository();
  const service=new UserService(repository);
  const initial=service.getUser("usr-001");
  expect(initial.status).toBe("ACTIVE");
  expect(typeof service.suspendUser).toBe("function");
  expect(typeof service.reactivateUser).toBe("function");
  const suspended=service.suspendUser("usr-001");
  expect(suspended.status).toBe("SUSPENDED");
  expect(repository.findById("usr-001")?.status).toBe("SUSPENDED");
  expect(suspended.email).toBe(initial.email);
  const reactivated=service.reactivateUser("usr-001");
  expect(reactivated.status).toBe("ACTIVE");
  expect(repository.findById("usr-001")?.status).toBe("ACTIVE");
  expect(reactivated.email).toBe(initial.email);
});

test("researcher backend contract: REST transitions require authentication and isolate unknown users",async()=>{
  const appModule=new URL("../apps/backend/src/app.ts",import.meta.url);
  const {createApp}=await import(appModule.href);
  const {default:request}=await import("supertest");
  const app=createApp();
  const before=await request(app).get("/api/users/usr-002").set(ADMIN).expect(200);
  await request(app).post("/api/users/usr-001/suspend").expect(401);
  await request(app).post("/api/users/does-not-exist/suspend").set(ADMIN).expect(404);
  const after=await request(app).get("/api/users/usr-002").set(ADMIN).expect(200);
  expect(after.body).toEqual(before.body);
  expect(after.body.status).toBe("ACTIVE");
});
