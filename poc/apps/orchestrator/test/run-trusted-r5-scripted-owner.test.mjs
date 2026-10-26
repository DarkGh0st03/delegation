import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,chmod,symlink,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {loadProtectedR5ScriptedOwnerInput,
  startProtectedR5ScriptedOwnerSession}
  from "../src/run-trusted-r5-scripted-owner.mjs";

const fixture=async()=>{
  const dir=await mkdtemp(join(tmpdir(),"r5-private-owner-input-"));
  const f=name=>join(dir,name);
  const signer=f("backend.key");
  await writeFile(signer,
    "-----BEGIN PRIVATE KEY-----\noffline-opaque-test-only\n-----END PRIVATE KEY-----\n",
    {mode:0o600});
  const input={
    profile:"scripted_offline",
    snapshot:{
      session_id:"r5-owner-original-session",
      repository:{authority:"gitea.local",owner:"thesis",repository:"iam"},
      base_revision:"a".repeat(40),
      directories:["","src","tests"],
      files:["src/b.ts","src/f.ts"]
    },
    preliminaryRoot:{
      credential_id:"urn:r5:preliminary",
      valid_from:new Date().toISOString(),
      validity_seconds:300,
      credential_status:{
        type:"BitstringStatusListEntry",statusPurpose:"revocation",
        statusListIndex:"401",
        statusListCredential:"https://status.example/roots"
      }
    },
    edits:{backend:["src/b.ts"],frontend:["src/f.ts"]},
    newTestFile:"tests/functional.test.ts",
    requirement:"Account Suspension ACTIVE/SUSPENDED",
    planId:"r5-reviewed-plan",
    agents:{
      backend:{did:"did:example:backend",card_ref:"private:backend"},
      frontend:{did:"did:example:frontend",card_ref:"private:frontend"},
      test:{did:"did:example:test",card_ref:"private:test"}
    },
    gatewayBaseUrl:"http://127.0.0.1:9001",
    backendPrivateKeyFile:signer
  };
  const inputFile=f("planning.json");
  await writeFile(inputFile,JSON.stringify(input),{mode:0o600});
  return {
    input,inputFile,signer,dir,
    async rewrite(value){await writeFile(inputFile,JSON.stringify(value),
      {mode:0o600});},
    close:()=>rm(dir,{recursive:true,force:true})
  };
};
test("R5 protected owner loads exact original signed Planning input from 0600, without exposing signer path",async()=>{
  const f=await fixture();try{
    const value=await loadProtectedR5ScriptedOwnerInput(f.inputFile);
    assert.equal(value.snapshot.base_revision,"a".repeat(40));
    assert.equal(value.profile,undefined);
    assert.equal(value.backendPrivateKeyFile,undefined);
    assert.match(value.backendPrivateKeyPem,/BEGIN PRIVATE KEY/);
    assert.equal(JSON.stringify({
      profile:value.profile,backendPrivateKeyFile:value.backendPrivateKeyFile
    }),"{}");
  }finally{await f.close();}
});
test("R5 owner rejects altered profile, untrusted keys and shared signer input",async()=>{
  const f=await fixture();try{
    for(const change of [
      x=>x.profile="paid_gemini",
      x=>x.unknownAuthorizer="user",
      x=>x.snapshot.hijackedRoot="surprise",
      x=>x.agents.orchestrator={did:"did:evil",card_ref:"private:evil"},
      x=>x.backendPrivateKeyFile=f.inputFile
    ]){
      const value=structuredClone(f.input);change(value);
      await f.rewrite(value);
      await assert.rejects(loadProtectedR5ScriptedOwnerInput(f.inputFile),
        /R5 protected live owner input denied/);
    }
  }finally{await f.close();}
});
test("R5 owner refuses writable signer, writable input and symbolic link",async()=>{
  const f=await fixture();try{
    await chmod(f.signer,0o644);
    await assert.rejects(loadProtectedR5ScriptedOwnerInput(f.inputFile),
      /R5 protected live owner input denied/);
    await chmod(f.signer,0o600);
    await chmod(f.inputFile,0o666);
    await assert.rejects(loadProtectedR5ScriptedOwnerInput(f.inputFile),
      /R5 protected live owner input denied/);
    await chmod(f.inputFile,0o600);
    const sym=join(f.dir,"pointer.json");
    await symlink(f.inputFile,sym);
    await assert.rejects(loadProtectedR5ScriptedOwnerInput(sym),
      /R5 protected live owner input denied/);
  }finally{await f.close();}
});
test("R5 privileged owner refuses GitHub Actions and missing source SHA before any root",async()=>{
  const f=await fixture();try{
    const old=process.env.GITHUB_ACTIONS;
    try{
      process.env.GITHUB_ACTIONS="true";
      await assert.rejects(startProtectedR5ScriptedOwnerSession({
        configPath:"/untrusted",expectedSourceSha:"a".repeat(40),
        inputFile:f.inputFile
      }),/R5 protected live owner input denied/);
    }finally{
      if(old===undefined)delete process.env.GITHUB_ACTIONS;
      else process.env.GITHUB_ACTIONS=old;
    }
    await assert.rejects(startProtectedR5ScriptedOwnerSession({
      configPath:"/untrusted",expectedSourceSha:"invalid",
      inputFile:f.inputFile
    }),/R5 protected live owner input denied/);
  }finally{await f.close();}
});
test("R5 foreground owner CLI never reads a key or starts a listener with missing protected config",()=>{
  const script=new URL("../src/run-trusted-r5-scripted-owner.mjs",import.meta.url);
  const p=spawnSync(process.execPath,[
    "--experimental-strip-types",script.pathname
  ],{
    env:{PATH:process.env.PATH},
    timeout:12000,encoding:"utf8"
  });
  assert.equal(p.status,1);
  assert.equal(p.stdout,"");
  assert.match(p.stderr,/R5 owner startup denied/);
  assert.doesNotMatch(p.stderr,/PRIVATE KEY|token|Bearer|BEGIN CERTIFICATE/);
});
