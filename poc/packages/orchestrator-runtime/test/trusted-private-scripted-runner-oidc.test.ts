import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,chmod,symlink,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {loadProtectedScriptedRunnerOidcConfig,submitProtectedPrivateScriptedRunnerAdmission}
  from "../../../apps/orchestrator/src/trusted-private-scripted-runner-oidc.mjs";

const SHA="c".repeat(40),RUN="39999990001";
const ref="refs/heads/refactor/post-prof-plan-contracts-20261021";
const repo="DarkGh0st03/delegation";
const workflow=".github/workflows/trusted-scripted-offline-session-hold.yml";
const fingerprint=Array(32).fill("AA").join(":");
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),"private-oidc-runner-"));
  const files={
    cfg:join(dir,"settings.json"),ca:join(dir,"ca.pem"),
    cert:join(dir,"runner.pem"),key:join(dir,"runner.key"),
    event:join(dir,"event.json")
  };
  for(const [p,contents] of [[files.ca,"disposable-ca"],
    [files.cert,"disposable-cert"],[files.key,"disposable-key"]])
    await writeFile(p,contents,{mode:0o600});
  const config={
    expectedRepository:repo,expectedRef:ref,
    expectedWorkflowPath:workflow,expectedSourceSha:SHA,
    intakeUrl:"https://10.27.10.4:8443/v1/trusted/github/scripted-offline-oidc-admission",
    audience:"urn:delegation:test-private-oidc",
    expectedServerFingerprint256:fingerprint,
    caFile:files.ca,clientCertFile:files.cert,clientKeyFile:files.key
  };
  await writeFile(files.cfg,JSON.stringify(config),{mode:0o600});
  await writeFile(files.event,JSON.stringify({
    repository:{full_name:repo},ref,
    inputs:{authorization:"I AUTHORIZE A SCRIPTED OFFLINE TEST ONLY",execution_profile:"scripted_offline"}
  }),{mode:0o600});
  const env={
    DELEGATION_SCRIPTED_RUNNER_OIDC_CONFIG:files.cfg,
    GITHUB_EVENT_PATH:files.event,
    ACTIONS_ID_TOKEN_REQUEST_URL:
      "https://token.actions.githubusercontent.com/oidc",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN:"unit-test-token",
    GITHUB_ACTIONS:"true",GITHUB_EVENT_NAME:"workflow_dispatch",
    GITHUB_RUN_ATTEMPT:"1",GITHUB_REPOSITORY:repo,GITHUB_REF:ref,
    GITHUB_WORKFLOW_REF:repo+"/"+workflow+"@"+ref,
    GITHUB_SHA:SHA,GITHUB_RUN_ID:RUN
  };
  return {dir,files,config,env,close:()=>rm(dir,{recursive:true,force:true})};
}
test("private runner binds all local trust pins and emits only nonauthorization",async()=>{
  const f=await fixture();try{
    const loaded=await loadProtectedScriptedRunnerOidcConfig(f.files.cfg);
    assert.equal(loaded.expectedSourceSha,SHA);
    assert.deepEqual(loaded.tls,{
      ca:"disposable-ca",cert:"disposable-cert",key:"disposable-key",
      expectedServerFingerprint256:fingerprint
    });
    let requests=0;
    const result=await submitProtectedPrivateScriptedRunnerAdmission({
      environment:f.env,
      async submit(input){
        requests++;
        assert.equal(input.intakeUrl,f.config.intakeUrl);
        assert.equal(input.tokenRequestBearer,"unit-test-token");
        assert.equal(input.env.GITHUB_SHA,SHA);
        assert.equal(input.env.GITHUB_WORKFLOW_REF,
          repo+"/"+workflow+"@"+ref);
        assert.equal(input.tls.key,"disposable-key");
        assert.equal(input.event.inputs.authorization,
          "I AUTHORIZE A SCRIPTED OFFLINE TEST ONLY");
        return {status:"scripted_authenticated_only_not_engineer_approved",
          run_id:RUN,source_sha:SHA};
      }
    });
    assert.equal(requests,1);
    assert.deepEqual(result,{
      status:"scripted_authenticated_only_not_engineer_approved",
      run_id:RUN,source_sha:SHA,engineer_approval:"not_checked",
      operational_credential:"not_issued",model_inference_allowed:false,
      execution_profile:"scripted_offline"
    });
    assert.equal(JSON.stringify(result).includes("disposable-key"),false);
    assert.ok(Object.isFrozen(result));
  }finally{await f.close();}
});
test("rejects workflow source drift, altered manual claims and replay attempt",async()=>{
  const f=await fixture();try{
    let calls=0;
    const submit=async()=>{calls++;throw Error("No network or OIDC request");};
    for(const patch of [
      {GITHUB_SHA:"a".repeat(40)}, {GITHUB_EVENT_NAME:"push"},
      {GITHUB_RUN_ATTEMPT:"2"},
      {GITHUB_REF:"refs/heads/main"},
      {GITHUB_WORKFLOW_REF:repo+"/.github/workflows/old.yml@"+ref},
      {GITHUB_REPOSITORY:"attacker/fork"},
      {GITHUB_RUN_ID:"0"},
      {ACTIONS_ID_TOKEN_REQUEST_TOKEN:""}
    ])await assert.rejects(submitProtectedPrivateScriptedRunnerAdmission({
      environment:{...f.env,...patch},submit
    }));
    assert.equal(calls,0);
  }finally{await f.close();}
});
test("rejects public/HTTP targets, unsafe local files and symlinked secrets",async()=>{
  const f=await fixture();try{
    for(const intakeUrl of [
      "https://8.8.8.8/v1/trusted/github/scripted-offline-oidc-admission",
      "https://127.0.0.1/v1/trusted/github/scripted-offline-oidc-admission",
      "http://10.27.10.4/v1/trusted/github/scripted-offline-oidc-admission",
      "https://0.0.0.0/v1/trusted/github/scripted-offline-oidc-admission",
      "https://engineer.example/v1/trusted/github/scripted-offline-oidc-admission",
      "https://10.27.10.4/v1/trusted/github/scripted-offline-oidc-admission?token=x"
    ]){
      await writeFile(f.files.cfg,
        JSON.stringify({...f.config,intakeUrl}),{mode:0o600});
      await assert.rejects(loadProtectedScriptedRunnerOidcConfig(f.files.cfg));
    }
    await writeFile(f.files.cfg,JSON.stringify(f.config),{mode:0o600});
    await chmod(f.files.cfg,0o644);
    await assert.rejects(loadProtectedScriptedRunnerOidcConfig(f.files.cfg));
    await chmod(f.files.cfg,0o600);
    await chmod(f.files.key,0o644);
    await assert.rejects(loadProtectedScriptedRunnerOidcConfig(f.files.cfg));
    await chmod(f.files.key,0o600);
    const alias=join(f.dir,"key-link");
    await symlink(f.files.key,alias);
    await writeFile(f.files.cfg,
      JSON.stringify({...f.config,clientKeyFile:alias}),{mode:0o600});
    await assert.rejects(loadProtectedScriptedRunnerOidcConfig(f.files.cfg));
    await writeFile(f.files.cfg,
      JSON.stringify({...f.config,clientKeyFile:"./relative.key"}),
      {mode:0o600});
    await assert.rejects(loadProtectedScriptedRunnerOidcConfig(f.files.cfg));
  }finally{await f.close();}
});
test("wrong admission response cannot be promoted to signed authority",async()=>{
  const f=await fixture();try{
    for(const response of [
      {status:"scripted_authenticated_only_not_engineer_approved",
        source_sha:SHA,run_id:"42"},
      {status:"approved",source_sha:SHA,run_id:RUN},
      {status:"scripted_authenticated_only_not_engineer_approved",
        source_sha:"a".repeat(40),run_id:RUN}
    ]){
      await assert.rejects(submitProtectedPrivateScriptedRunnerAdmission({
        environment:f.env,async submit(){return response;}
      }),/denied/);
    }
  }finally{await f.close();}
});


test("scripted runner hold rejects unverified local source before OIDC",async()=>{
  const {readFile}=await import("node:fs/promises");
  const code=await readFile(new URL(
    "../../../apps/orchestrator/src/hold-private-scripted-github-session.mjs",
    import.meta.url),"utf8");
  assert.match(code,/verifyProtectedScriptedInstallation/);
  assert.ok(code.indexOf("await verifyProtectedScriptedInstallation(")>=0);
  assert.ok(code.indexOf("await verifyProtectedScriptedInstallation(")<
    code.indexOf("await submitProtectedPrivateScriptedRunnerAdmission("),
    "same-process installed SHA guard must precede any OIDC token submission");
});

test("R5 private hold verifies protected client TLS BEFORE requesting OIDC",async()=>{
  const {readFile}=await import("node:fs/promises");
  const code=await readFile(new URL(
    "../../../apps/orchestrator/src/hold-private-scripted-github-session.mjs",
    import.meta.url),"utf8");
  const tls=code.indexOf("verifyR5ScriptedRunnerTlsReadiness(trusted,");
  const submit=code.indexOf("await submitProtectedPrivateScriptedRunnerAdmission(");
  assert.ok(tls>=0&&submit>tls,
    "verified runner certificate and mTLS key must precede OIDC submission");
});

test("privileged self-hosted workflow never checks out mutable branch code",async()=>{
  const {readFile}=await import("node:fs/promises");
  const yaml=await readFile(new URL(
    "../../../../.github/workflows/trusted-scripted-offline-session-hold.yml",
    import.meta.url),"utf8");
  assert.match(yaml,/workflow_dispatch:/);
  assert.match(yaml,/id-token: write/);
  assert.match(yaml,/runs-on: \[self-hosted, linux, x64, delegation-private\]/);
  assert.match(yaml,/environment: r5-private-scripted-admission/);
  assert.match(yaml,/github\.run_attempt == 1/);
  assert.match(yaml,/node --experimental-strip-types \/opt\/delegation\/r5\/poc\/apps\/orchestrator\/src\/hold-private-scripted-github-session\.mjs/);
  const preflight="node --experimental-strip-types /opt/delegation/r5/poc/scripts/r5-scripted-dispatch-registration.mjs";
  const hold="node --experimental-strip-types /opt/delegation/r5/poc/apps/orchestrator/src/hold-private-scripted-github-session.mjs";
  assert.ok(yaml.includes(preflight),"immutable registration preflight required");
  assert.ok(yaml.indexOf(preflight)<yaml.indexOf(hold),
    "registration/source gate must run BEFORE requesting GitHub OIDC");
  assert.doesNotMatch(yaml,/actions\/checkout@|actions\/setup-node@/);
  // Security is about executable workflow commands, not explanatory
  // comments. A comment stating "no npm install" must not fail this
  // invariant, while an actual dependency download in run: still must.
  const executable=yaml.split("\n").filter(line=>
    !line.trimStart().startsWith("#")).join("\n");
  assert.doesNotMatch(executable,/npm ci|npm install|curl |wget |pip install/);
  assert.doesNotMatch(yaml,/run:.*(?:GITHUB_WORKSPACE|\.\/poc\/| node poc\/)/);
  assert.doesNotMatch(yaml,/GEMINI_API_KEY|GOOGLE_API_KEY|GEMINI_API_SECRET/);
});
