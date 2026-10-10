// Independent CI-only audit, not written or selected by the Gemini Agent.
// Copied into the pinned IAM baseline AFTER model-generated files are overlaid.
import { describe, it, expect } from "vitest";
import request from "supertest";
import { ACCOUNT_STATUS } from "@iam/shared";
import { InMemoryUserRepository } from "../../apps/backend/src/users/user.repository.js";
import { UserService } from "../../apps/backend/src/users/user.service.js";
import { createApp } from "../../apps/backend/src/app.js";

const ADMIN = {"x-demo-role":"admin"};

describe("Independent Account Suspension Backend audit",()=>{
  it("extends the shared status contract",()=>{
    expect(ACCOUNT_STATUS.ACTIVE).toBe("ACTIVE");
    expect(ACCOUNT_STATUS.SUSPENDED).toBe("SUSPENDED");
  });
  it("suspends and reactivates users, persisting status in the repository",()=>{
    const repo=new InMemoryUserRepository();
    const service=new UserService(repo);
    const initial=service.getUser("usr-001");
    expect(initial.status).toBe("ACTIVE");
    const suspended=service.suspendUser("usr-001");
    expect(suspended.status).toBe("SUSPENDED");
    expect(repo.findById("usr-001")?.status).toBe("SUSPENDED");
    expect(suspended.email).toBe(initial.email);
    const active=service.reactivateUser("usr-001");
    expect(active.status).toBe("ACTIVE");
    expect(repo.findById("usr-001")?.status).toBe("ACTIVE");
  });
  it("rejects duplicate suspend/reactivate transitions",()=>{
    const service=new UserService(new InMemoryUserRepository());
    service.suspendUser("usr-001");
    expect(()=>service.suspendUser("usr-001")).toThrow();
    service.reactivateUser("usr-001");
    expect(()=>service.reactivateUser("usr-001")).toThrow();
  });
  it("returns 404 for nonexistent users and does not mutate other users",async()=>{
    const app=createApp();
    await request(app).post("/api/users/does-not-exist/suspend").set(ADMIN).expect(404);
    const unchanged=await request(app).get("/api/users/usr-002").set(ADMIN).expect(200);
    expect(unchanged.body.status).toBe("ACTIVE");
  });
  it("implements protected REST transitions with conflict status 409",async()=>{
    const app=createApp();
    await request(app).post("/api/users/usr-001/suspend").expect(401);
    const suspension=await request(app).post("/api/users/usr-001/suspend").set(ADMIN).expect(200);
    expect(suspension.body.status).toBe("SUSPENDED");
    const current=await request(app).get("/api/users/usr-001").set(ADMIN).expect(200);
    expect(current.body.status).toBe("SUSPENDED");
    await request(app).post("/api/users/usr-001/suspend").set(ADMIN).expect(409);
    const reactivated=await request(app).post("/api/users/usr-001/reactivate").set(ADMIN).expect(200);
    expect(reactivated.body.status).toBe("ACTIVE");
    await request(app).post("/api/users/usr-001/reactivate").set(ADMIN).expect(409);
  });
});