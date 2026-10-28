import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,chmod,writeFile,symlink,readdir,mkdir}
  from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {TrustedFreshWorkDecisionStore}
  from "../src/trusted-fresh-work-decision-store.ts";
import type {TrustedPriorWorkAudit}
  from "../src/trusted-fresh-work-audit.ts";

const audit:TrustedPriorWorkAudit=Object.freeze({
  status:"prior_work_audited" as const,
  previous_session_id:"old-r42",proposed_next_session_id:"new-r42",
  previous_plan_digest:"b".repeat(64),
  previous_base_revision:"a".repeat(40),
  previous_branch:"feature/approved",
  previous_feature_head_sha:"c".repeat(40),
  changed_files:Object.freeze([
    Object.freeze({path:"src/service.ts",change:"modified" as const})
  ]),
  planning_authorized:false as const,prior_changes_imported:false as const
});
test("R42 durable owner decision survives a new store instance and cannot be replayed",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"r42-ledger-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const one=new TrustedFreshWorkDecisionStore(dir);
  const two=new TrustedFreshWorkDecisionStore(dir);
  const result=await one.recordDecision({audit,disposition:"start_from_pinned_main"});
  assert.equal(result.next_session_id,"new-r42");
  assert.deepEqual(await two.assertRecorded({
    audit,disposition:"start_from_pinned_main"
  }),result);
  await assert.rejects(two.recordDecision({
    audit,disposition:"quarantine_prior_branch"
  }),(e:any)=>e.code==="EEXIST");
  await assert.rejects(two.assertRecorded({
    audit,disposition:"quarantine_prior_branch"
  }),/does not match audited work/);
  const changed=Object.freeze({...audit,
    changed_files:Object.freeze([
      Object.freeze({path:"src/other.ts",change:"modified" as const})
    ])
  });
  await assert.rejects(two.assertRecorded({
    audit:changed,disposition:"start_from_pinned_main"
  }),/does not match audited work/);
});
test("R42 no permissive file, substituted data or symlinked owner directory",async t=>{
  const base=await mkdtemp(join(tmpdir(),"r42-reject-"));
  t.after(()=>rm(base,{recursive:true,force:true}));
  const dir=join(base,"owner");
  await mkdir(dir,{mode:0o700});
  const store=new TrustedFreshWorkDecisionStore(dir);
  await store.recordDecision({audit,disposition:"quarantine_prior_branch"});
  const file=join(dir,(await readdir(dir))[0]!);
  await chmod(file,0o644);
  await assert.rejects(store.assertRecorded({
    audit,disposition:"quarantine_prior_branch"
  }),/unsafe or incomplete/);
  await chmod(file,0o600);
  await writeFile(file,"{}",{mode:0o600});
  await assert.rejects(store.assertRecorded({
    audit,disposition:"quarantine_prior_branch"
  }),/unsafe or incomplete/);
  const symlinkDir=join(base,"alias");
  await symlink(dir,symlinkDir);
  await assert.rejects(new TrustedFreshWorkDecisionStore(symlinkDir)
    .recordDecision({audit,disposition:"start_from_pinned_main"}),
    /owner-only non-symlink directory required/);
});
