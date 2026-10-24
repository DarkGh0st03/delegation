import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,chmod,symlink,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {loadTrustedEngineerServiceConfig}
  from "../src/trusted-engineer-service.mjs";
async function fixture(){
  const home=await mkdtemp(join(tmpdir(),"engineer-service-config-"));
  const dirs={};
  for(const name of ["approval","checkpoints","replays","admissions","recovery","planning"]){
    dirs[name]=join(home,name);
    await mkdir(dirs[name],{mode:0o700});
  }
  const filename=n=>join(home,n);
  const files={
    config:filename("config.json"),
    plan:filename("plan.json"),privateKey:filename("signing.key"),
    publicKey:filename("public.pem"),
    backendPublicKey:filename("backend-public.pem"),
    github:filename("github.token"),hmac:filename("hmac.hex"),
    ca:filename("ca.pem"),cert:filename("server.pem"),
    tlsKey:filename("server.key"),adapter:filename("adapter.token"),
    gateway:filename("gateway.hex")
  };
  for(const [path,data] of [
    [files.plan,"{\"session_id\":\"test\"}"],
    [files.privateKey,"LOCAL TEST KEY"],
    [files.publicKey,"-----BEGIN PUBLIC KEY-----\nexample\n-----END PUBLIC KEY-----"],
    [files.backendPublicKey,"-----BEGIN PUBLIC KEY-----\nbackend\n-----END PUBLIC KEY-----"],
    [files.github,"offline-github-token"],
    [files.hmac,"ab".repeat(32)+"\n"],
    [files.ca,"-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----"],
    [files.cert,"-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----"],
    [files.tlsKey,"-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----"],
    [files.adapter,"offline-adapter-bearer"],
    [files.gateway,"ef".repeat(32)]
  ])await writeFile(path,data,{mode:0o600});
  const config={
    approval:{
      engineerDid:"did:test:engineer",keyId:"approved",
      expectedSessionId:"test-session",expectedBaseRevision:"a".repeat(40),
      repository:{authority:"gitea.local",owner:"demo",repository:"test"},
      receiptDirectory:dirs.approval,
      trustedPlanFile:files.plan,privateKeyFile:files.privateKey,
      publicKeyPemFile:files.publicKey,
      passwordSaltHex:"cc".repeat(16),
      passwordScryptHex:"dd".repeat(64),
      checkpoint:{directory:dirs.checkpoints,backendKeyId:"planning-backend",
        backendPublicKeyPemFile:files.backendPublicKey,
        expectedWorkBranch:"feature/account-suspension"}
    },
    oidc:{
      pinned:{repository:"DarkGh0st03/delegation",
        ref:"refs/heads/refactor/post-prof-plan-contracts-20261021",
        workflowPath:".github/workflows/trusted-private-github-admission.yml",
        sourceSha:"b".repeat(40)},
      trust:{expectedAudience:"urn:private-engineer",
        expectedSubject:"repo:trusted-repository",
        expectedRepositoryId:"123",expectedOwnerId:"456"},
      replayDirectory:dirs.replays,admissionDirectory:dirs.admissions,
      bindAddress:"127.0.0.1",
      githubApiTokenFile:files.github,hmacSecretHexFile:files.hmac,
      tls:{caFile:files.ca,certFile:files.cert,keyFile:files.tlsKey,
        expectedClientFingerprint256:Array(32).fill("AA").join(":")}
    },
    recovery:{
      directory:dirs.recovery,planningDirectory:dirs.planning,
      gatewaySocketPath:filename("gateway.sock"),
      gatewaySecretFile:files.gateway,adapterBaseUrl:"http://127.0.0.1:8090",
      adapterTokenFile:files.adapter
    },
    approvalPort:0,oidcPort:0
  };
  const save=()=>writeFile(files.config,JSON.stringify(config),{mode:0o600});
  await save();
  return {home,dirs,files,config,save,
    close:()=>rm(home,{recursive:true,force:true})};
}
test("service loads only protected, local config and independent secrets",async()=>{
  const f=await fixture();
  try{
    const c=await loadTrustedEngineerServiceConfig(f.files.config);
    assert.equal(c.oidc.hmacSecret.length,32);
    assert.equal(c.oidc.githubApiToken,"offline-github-token");
    assert.equal(c.recovery.adapterToken,"offline-adapter-bearer");
    assert.equal(c.recovery.planningDirectory,f.dirs.planning);
    assert.equal(c.approval.publicKeyPem.includes("BEGIN PUBLIC KEY"),true);
    assert.equal(c.oidc.tls.expectedClientFingerprint256,
      f.config.oidc.tls.expectedClientFingerprint256);
    assert.equal(c.oidc.pinned.sourceSha,"b".repeat(40));
    assert.equal(c.approval.expectedBaseRevision,"a".repeat(40));
    assert.equal("hmacSecretHexFile" in c.oidc,false);
    assert.equal("adapterTokenFile" in c.recovery,false);
    assert.equal("publicKeyPemFile" in c.approval,false);
    assert.equal("checkpoint" in c.approval,false);
    assert.equal(typeof c.approval.planningCheckpointStore.load,"function");
    assert.equal(typeof c.approval.planningCheckpointStore.persistVerified,"function");
    assert.equal(c.recovery.gatewaySocketPath,f.config.recovery.gatewaySocketPath);
  }finally{await f.close();}
});
test("service refuses group-readable files, symlinks and writable state dirs",async()=>{
  const f=await fixture();
  try{
    await chmod(f.files.config,0o644);
    await assert.rejects(loadTrustedEngineerServiceConfig(f.files.config),
      /configuration denied/);
    await chmod(f.files.config,0o600);
    await chmod(f.files.hmac,0o644);
    await assert.rejects(loadTrustedEngineerServiceConfig(f.files.config),
      /configuration denied/);
    await chmod(f.files.hmac,0o600);
    const alias=join(f.home,"hmac-alias");
    await symlink(f.files.hmac,alias);
    f.config.oidc.hmacSecretHexFile=alias;
    await f.save();
    await assert.rejects(loadTrustedEngineerServiceConfig(f.files.config),
      /configuration denied/);
    f.config.oidc.hmacSecretHexFile=f.files.hmac;
    await f.save();
    await chmod(f.dirs.recovery,0o755);
    await assert.rejects(loadTrustedEngineerServiceConfig(f.files.config),
      /configuration denied/);
  }finally{await f.close();}
});
test("service refuses empty/weak tokens, missing TLS material or unsafe config",async()=>{
  const f=await fixture();
  try{
    const original=f.config.oidc.tls.expectedClientFingerprint256;
    f.config.oidc.tls.expectedClientFingerprint256="not-pinned";
    await f.save();
    await assert.rejects(loadTrustedEngineerServiceConfig(f.files.config),
      /configuration denied/);
    f.config.oidc.tls.expectedClientFingerprint256=original;
    await f.save();
    await writeFile(f.files.github,"",{mode:0o600});
    await assert.rejects(loadTrustedEngineerServiceConfig(f.files.config),
      /configuration denied/);
    await writeFile(f.files.github,"offline-github-token",{mode:0o600});
    f.config.oidc.extra="unreviewed-field";
    f.config.extra="arbitrary-source";
    await f.save();
    await assert.rejects(loadTrustedEngineerServiceConfig(f.files.config),
      /configuration denied/);
  }finally{await f.close();}
});


test("service command loads Node 22 TypeScript dependencies and fails closed before startup",async()=>{
  const run=promisify(execFile);
  const executable=new URL("../src/start-trusted-engineer-service.mjs",import.meta.url);
  const env={...process.env};
  delete env.DELEGATION_ENGINEER_SERVICE_CONFIG;
  await assert.rejects(run(process.execPath,[
    "--experimental-strip-types",executable.pathname
  ],{env,timeout:12000,maxBuffer:8192}),error=>{
    assert.equal(error.code,1);
    assert.match(error.stderr,/Trusted Engineer service startup denied/);
    assert.doesNotMatch(error.stderr,/ERR_UNKNOWN_FILE_EXTENSION|secret|Bearer |private key/);
    assert.equal(error.stdout,"");
    return true;
  });
});
test("service rejects unknown nested host authorities and untrusted runtime overrides",async()=>{
  const f=await fixture();
  try{
    const variants=[
      [f.config.approval,"runtimeApproval",true],
      [f.config.oidc,"githubApiFetchFn","malicious"],
      [f.config.oidc.tls,"rejectUnauthorized",false],
      [f.config.oidc.pinned,"sourceShaOverride","c".repeat(40)],
      [f.config.oidc.trust,"ownerOverride","attacker"],
      [f.config.recovery,"credentials",{revokeRoot:"untrusted"}]
    ];
    for(const [target,key,value] of variants){
      target[key]=value;
      await f.save();
      await assert.rejects(loadTrustedEngineerServiceConfig(f.files.config),
        /configuration denied/);
      delete target[key];
    }
  }finally{await f.close();}
});


test("trusted handoff lifecycle refuses second approval/run and closes authority exactly once",async()=>{
  const {createTrustedReviewedHandoffLifecycle}=await import(
    "../src/trusted-reviewed-handoff-lifecycle.mjs");
  let started=0,revoked=0;
  const owner=createTrustedReviewedHandoffLifecycle(async input=>{
    started++;
    assert.equal(input.session,"approved");
    return {async close(){revoked++;}};
  });
  const running=await owner.start({session:"approved"});
  assert.equal(typeof running.close,"function");
  assert.equal(owner.status,"active");
  assert.throws(()=>owner.start({session:"unapproved"}),/already attempted/);
  await Promise.all([owner.close(),owner.close()]);
  assert.equal(started,1);
  assert.equal(revoked,1);
  assert.equal(owner.status,"closed");
  assert.throws(()=>owner.start({session:"replayed"}),/already attempted/);
});
test("SIGTERM racing an unfinished approved handoff still revokes its root",async()=>{
  const {createTrustedReviewedHandoffLifecycle}=await import(
    "../src/trusted-reviewed-handoff-lifecycle.mjs");
  let unblock;
  const pending=new Promise(resolve=>{unblock=resolve;});
  let revoked=0;
  const owner=createTrustedReviewedHandoffLifecycle(async()=>{
    await pending;
    return {async close(){revoked++;}};
  });
  const started=owner.start({});
  const stopping=owner.close();
  unblock();
  await assert.rejects(started,/host shutdown/);
  await stopping;
  assert.equal(revoked,1);
  assert.equal(owner.status,"closed");
});
test("unconfirmed delegated-root revocation blocks clean host shutdown",async()=>{
  const {createTrustedReviewedHandoffLifecycle}=await import(
    "../src/trusted-reviewed-handoff-lifecycle.mjs");
  let attempts=0;
  const owner=createTrustedReviewedHandoffLifecycle(async()=>({
    async close(){
      attempts++;
      throw Error("revocation unconfirmed");
    }
  }));
  await owner.start({});
  await assert.rejects(owner.close(),/revocation unconfirmed/);
  await assert.rejects(owner.close(),/revocation unconfirmed/);
  assert.equal(attempts,1);
  assert.equal(owner.status,"closing");
  assert.throws(()=>owner.start({}),/already attempted/);
});


test("rejected trusted handoff start cannot be misreported as clean shutdown",async()=>{
  const {createTrustedReviewedHandoffLifecycle}=await import(
    "../src/trusted-reviewed-handoff-lifecycle.mjs");
  const owner=createTrustedReviewedHandoffLifecycle(async()=>{
    throw Error("operational root revocation unconfirmed");
  });
  await assert.rejects(owner.start({}),/revocation unconfirmed/);
  await assert.rejects(owner.close(),/manual reconciliation required/);
  assert.equal(owner.status,"closing");
  assert.throws(()=>owner.start({}),/already attempted/);
});

test("strict operational host config rejects missing, untrusted or shared checkpoint pins",async()=>{
  const f=await fixture();
  try{
    const original=f.config.approval.checkpoint;
    delete f.config.approval.checkpoint;
    await f.save();
    await assert.rejects(loadTrustedEngineerServiceConfig(f.files.config),
      /configuration denied/);
    f.config.approval.checkpoint={...original,
      directory:f.dirs.approval};
    await f.save();
    await assert.rejects(loadTrustedEngineerServiceConfig(f.files.config),
      /configuration denied/);
    f.config.approval.checkpoint={...original,
      expectedWorkBranch:"main"};
    await f.save();
    await assert.rejects(loadTrustedEngineerServiceConfig(f.files.config),
      /configuration denied/);
    f.config.approval.checkpoint={...original};
    await f.save();
    await chmod(f.files.backendPublicKey,0o644);
    await assert.rejects(loadTrustedEngineerServiceConfig(f.files.config),
      /configuration denied/);
  }finally{await f.close();}
});
