import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {verifyR463PaidEngineerHostReadiness as check}
 from "../r463-gemini-private-host-preflight.mjs";

const SHA="a".repeat(40);
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
const WF=".github/workflows/trusted-gemini-private-session-hold.yml";
const SUBJECT="repo:DarkGh0st03@150908952/delegation@1374168963:ref:"+REF;
const FP1=Array(32).fill("11").join(":");
const FP2=Array(32).fill("22").join(":");
const openssl=args=>execFileSync("openssl",args,{
 stdio:"ignore",timeout:12000
});
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),"r463-paid-private-offline-"));
 const at=name=>join(dir,name);
 try{
  openssl(["req","-x509","-newkey","ec","-pkeyopt",
   "ec_paramgen_curve:P-256","-nodes",
   "-keyout",at("ca.key"),"-out",at("ca.crt"),
   "-days","2","-subj","/CN=R463-Private-Test-CA",
   "-addext","basicConstraints=critical,CA:TRUE",
   "-addext","keyUsage=critical,keyCertSign,cRLSign"]);
  openssl(["req","-new","-newkey","ec","-pkeyopt",
   "ec_paramgen_curve:P-256","-nodes",
   "-keyout",at("leaf.key"),"-out",at("leaf.csr"),
   "-subj","/CN=10.27.10.4"]);
  await writeFile(at("leaf.ext"),[
   "subjectAltName=IP:10.27.10.4",
   "basicConstraints=critical,CA:FALSE",
   "keyUsage=digitalSignature,keyEncipherment",
   "extendedKeyUsage=serverAuth",""
  ].join("\n"));
  openssl(["x509","-req","-in",at("leaf.csr"),
   "-CA",at("ca.crt"),"-CAkey",at("ca.key"),"-CAcreateserial",
   "-out",at("leaf.crt"),"-days","2","-extfile",at("leaf.ext")]);
  const tls={
   ca:await readFile(at("ca.crt"),"utf8"),
   cert:await readFile(at("leaf.crt"),"utf8"),
   key:await readFile(at("leaf.key"),"utf8"),
   expectedClientFingerprint256:FP1
  };
  const config={
   planningMode:"original",approvalPort:8101,oidcPort:8102,scriptedOidcPort:8103,
   recovery:{
    nativeEngineerSocketPath:"/private/native-engineer.sock",
    gatewaySocketPath:"/private/gateway.sock"
   },
   oidc:{
    pinned:{repository:"DarkGh0st03/delegation",ref:REF,
     workflowPath:WF,sourceSha:SHA},
    trust:{
     expectedSubject:SUBJECT,expectedRepositoryId:"1374168963",
     expectedOwnerId:"150908952",expectedAudience:"urn:private-gemini-r463"
    },
    bindAddress:"10.27.10.4",tls
   },
   scriptedOidc:{
    pinned:{repository:"DarkGh0st03/delegation",ref:REF,
     workflowPath:".github/workflows/trusted-scripted-offline-session-hold.yml",
     sourceSha:SHA},
    trust:{expectedAudience:"urn:scripted-no-provider-r463"},
    tls:{expectedClientFingerprint256:FP2}
   }
  };
  return {config,at,close:()=>rm(dir,{recursive:true,force:true})};
 }catch(e){await rm(dir,{recursive:true,force:true});throw e;}
}

test("R463 checked paid private Host config is evidence-only, never a live pilot",async()=>{
 const f=await fixture();
 try{
  const verified=check(f.config,{expectedSourceSha:SHA});
  assert.equal(verified.status,"paid_engineer_host_config_verified_not_deployed");
  assert.equal(verified.private_runner_connected,false);
  assert.equal(verified.oidc_job_seen,false);
  assert.equal(verified.engineer_signature_seen,false);
  assert.equal(verified.signed_root_issued,false);
  assert.equal(verified.model_api_calls,0);
  assert.equal(verified.r5_go,false);
  assert.equal(JSON.stringify(verified).includes("BEGIN PRIVATE KEY"),false);
  assert.equal(Object.isFrozen(verified),true);
 }finally{await f.close();}
});

test("R463 rejects a wrong paid workflow, GitHub OIDC issuer or exact SHA",async()=>{
 const f=await fixture();try{
  const changes=[
   x=>x.oidc.pinned.workflowPath=".github/workflows/trusted-private-github-admission.yml",
   x=>x.oidc.pinned.repository="attacker/delegation",
   x=>x.oidc.pinned.ref="refs/heads/main",
   x=>x.oidc.pinned.sourceSha="b".repeat(40),
   x=>x.oidc.trust.expectedOwnerId="111",
   x=>x.oidc.trust.expectedRepositoryId="222",
   x=>x.oidc.trust.expectedSubject="repo:attacker",
   x=>x.oidc.trust.expectedAudience="short",
   x=>x.scriptedOidc.trust.expectedAudience=x.oidc.trust.expectedAudience,
   x=>x.scriptedOidc.pinned.sourceSha="b".repeat(40),
   x=>x.scriptedOidc.tls.expectedClientFingerprint256=FP1
  ];
  for(const change of changes){
   const config=structuredClone(f.config);change(config);
   assert.throws(()=>check(config,{expectedSourceSha:SHA}),
    /R463 paid private Engineer Host NO-GO/u);
  }
  assert.throws(()=>check(f.config,{expectedSourceSha:"bad"}),
   /R463 paid private Engineer Host NO-GO/u);
 }finally{await f.close();}
});

test("R463 rejects unprotected listener endpoints, no native issuer or non-original Planning",async()=>{
 const f=await fixture();try{
  const changes=[
   x=>x.oidc.bindAddress="8.8.8.8",
   x=>x.oidc.bindAddress="127.0.0.1",
   x=>x.approvalPort=0,
   x=>x.oidcPort=x.approvalPort,
   x=>x.scriptedOidcPort=x.oidcPort,
   x=>{delete x.recovery.nativeEngineerSocketPath;},
   x=>x.recovery.gatewaySocketPath="http://127.0.0.1/gateway",
   x=>x.planningMode="fresh_repair"
  ];
  for(const change of changes){
   const c=structuredClone(f.config);change(c);
   assert.throws(()=>check(c,{expectedSourceSha:SHA}),
    /R463 paid private Engineer Host NO-GO/u);
  }
 }finally{await f.close();}
});

test("R463 rejects expired, wrong CA, wrong SAN, fake leaf and wrong TLS key",async()=>{
 const f=await fixture();try{
  assert.throws(()=>check(f.config,{
   expectedSourceSha:SHA,nowMs:Date.now()+5*86400000
  }),/R463 paid private Engineer Host NO-GO/u);
  const cases=[
   c=>c.oidc.tls.ca=c.oidc.tls.cert,
   c=>c.oidc.tls.cert="not a certificate",
   c=>c.oidc.tls.key=c.oidc.tls.ca,
   c=>c.oidc.tls.expectedClientFingerprint256="unknown"
  ];
  for(const change of cases){
   const c=structuredClone(f.config);change(c);
   assert.throws(()=>check(c,{expectedSourceSha:SHA}),
    /R463 paid private Engineer Host NO-GO/u);
  }
  openssl(["genpkey","-algorithm","EC","-pkeyopt",
   "ec_paramgen_curve:P-256","-out",f.at("foreign.key")]);
  const bad=structuredClone(f.config);
  bad.oidc.tls.key=await readFile(f.at("foreign.key"),"utf8");
  assert.throws(()=>check(bad,{expectedSourceSha:SHA}),
   /R463 paid private Engineer Host NO-GO/u);
 }finally{await f.close();}
});
