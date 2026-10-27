import test from "node:test";
import assert from "node:assert/strict";
import {parseApprovedStatusRule,applyApprovedStatusRule}
  from "./source-derived-status-edits.mjs";
const baseline='/** Unrelated header. */\nexport type AccountStatus = "ACTIVE";\n\n'+
  'export const ACCOUNT_STATUS = {\n  ACTIVE: "ACTIVE"\n} as const satisfies Record<string, AccountStatus>;\n';
const task="Extend the authorized account lifecycle.\n"+
  "STATUS TYPE AccountStatus CONST ACCOUNT_STATUS ADD SUSPENDED";
test("source-derived status preserves unrelated code and adds approved value",()=>{
  const result=applyApprovedStatusRule(baseline,parseApprovedStatusRule(task));
  assert.ok(result.startsWith("/** Unrelated header. */"));
  assert.ok(result.includes('export type AccountStatus = "ACTIVE" | "SUSPENDED";'));
  assert.ok(result.includes('  ACTIVE: "ACTIVE",\n  SUSPENDED: "SUSPENDED"'));
});
test("same transformation works for unrelated type/constant names",()=>{
  const source=baseline.replaceAll("AccountStatus","MembershipState")
    .replaceAll("ACCOUNT_STATUS","MEMBERSHIP_STATE");
  const result=applyApprovedStatusRule(source,parseApprovedStatusRule(
    "STATUS TYPE MembershipState CONST MEMBERSHIP_STATE ADD PAUSED"));
  assert.ok(result.includes('MembershipState = "ACTIVE" | "PAUSED";'));
  assert.ok(result.includes('  PAUSED: "PAUSED"'));
});
test("missing signed instruction, duplication, or inconsistent source fail closed",()=>{
  for(const instruction of ["none",
    task+"\nSTATUS TYPE AccountStatus CONST ACCOUNT_STATUS ADD BLOCKED",
    "STATUS TYPE AccountStatus CONST ACCOUNT_STATUS ADD invalid"
  ])assert.throws(()=>parseApprovedStatusRule(instruction),/NO-GO/);
  const rule=parseApprovedStatusRule(task);
  for(const input of [
    baseline.replace('type AccountStatus','type OtherStatus'),
    baseline.replace('  ACTIVE: "ACTIVE"','  ACTIVE: "BROKEN"'),
    baseline.replace('"ACTIVE";','"ACTIVE" | "SUSPENDED";'),
    baseline.replace('} as const satisfies','} satisfies')
  ])assert.throws(()=>applyApprovedStatusRule(input,rule),/NO-GO/);
});
