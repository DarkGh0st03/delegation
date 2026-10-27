import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {observeProtectedR5UncertainChildRecovery}
  from "../r5-protected-child-recovery.mjs";

const SHA="a".repeat(40),DIGEST="b".repeat(64);
test("R5 recovery never opens a private credential on GitHub Actions, and CLI hides secrets",()=>{
  const url=new URL("../r5-protected-child-recovery.mjs",import.meta.url);
  const child=spawnSync(process.execPath,[
    "--experimental-strip-types",url.pathname
  ],{encoding:"utf8",timeout:15000,env:{
    PATH:process.env.PATH??"",GITHUB_ACTIONS:"true",
    DELEGATION_R5_CHILD_RECOVERY_CONFIG:"/private/secret-config",
    DELEGATION_R5_EXPECTED_SESSION_ID:"r5-real",
    DELEGATION_R5_EXPECTED_SOURCE_SHA:SHA,
    DELEGATION_R5_EXPECTED_PLAN_DIGEST:DIGEST,
    DELEGATION_R5_EXPECTED_OPERATIONAL_ROOT_ID:"urn:r5:operational"
  }});
  assert.equal(child.status,1);
  assert.equal(child.stdout,"");
  assert.match(child.stderr,/R5 protected uncertain child recovery NO-GO/);
  assert.doesNotMatch(child.stderr,/secret-config|urn:r5:operational/);
});
test("R5 recovery requires two independent owner pins before any protected file read",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"r5-recovery-config-"));
  try{
    const configDir=join(dir,"operator");
    await mkdir(configDir,{mode:0o700});
    const configPath=join(configDir,"config.json");
    await writeFile(configPath,JSON.stringify({
      schema:"r5-owner-uncertain-child-recovery-v1",
      source_sha:SHA,session_id:"r5-original",
      plan_digest:DIGEST,operational_root_id:"urn:r5:operational",
      issuance_journal_directory:"/private/issuance",
      engineer_approval_directory:"/private/approvals",
      engineer_public_key_file:"/private/engineer.pub",
      engineer_did:"did:example:engineer",engineer_key_id:"key1",
      adapter_base_url:"http://127.0.0.1:8191",
      gateway_verifier_bearer_file:"/private/verifier.token"
    }),{mode:0o600});
    const previous=process.env.GITHUB_ACTIONS;
    delete process.env.GITHUB_ACTIONS;
    try{
      let fetched=0;
      const base={configPath,expectedSessionId:"r5-original",
        expectedSourceSha:SHA,expectedPlanDigest:DIGEST,
        expectedRootId:"urn:r5:operational",
        fetchFn:async()=>{fetched++;throw Error("MUST NOT FETCH");}};
      await assert.rejects(observeProtectedR5UncertainChildRecovery({
        ...base,expectedRootId:"urn:forged"
      }),/NO-GO/);
      await assert.rejects(observeProtectedR5UncertainChildRecovery({
        ...base,expectedSourceSha:"c".repeat(40)
      }),/NO-GO/);
      assert.equal(fetched,0);
    }finally{
      if(previous===undefined)delete process.env.GITHUB_ACTIONS;
      else process.env.GITHUB_ACTIONS=previous;
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
