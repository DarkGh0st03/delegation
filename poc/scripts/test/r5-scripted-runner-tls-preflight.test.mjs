import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync,spawnSync} from "node:child_process";
import {verifyR5ScriptedRunnerTlsReadiness as verify}
  from "../r5-scripted-runner-tls-preflight.mjs";
const SHA="a".repeat(40);
const REF="refs/heads/refactor/post-prof-plan-contracts-20261021";
const REPO="DarkGh0st03/delegation";
const SERVER_FP=Array(32).fill("AA").join(":");
function openssl(args){
  execFileSync("openssl",args,{stdio:"ignore",timeout:12000});
}
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),"r5-scripted-runner-tls-"));
  const f=name=>join(dir,name);
  try{
    openssl(["req","-x509","-newkey","ec","-pkeyopt",
      "ec_paramgen_curve:P-256","-nodes","-keyout",f("ca.key"),
      "-out",f("ca.crt"),"-days","2","-subj","/CN=R5LocalClientCA",
      "-addext","basicConstraints=critical,CA:TRUE",
      "-addext","keyUsage=critical,keyCertSign,cRLSign"]);
    openssl(["req","-new","-newkey","ec","-pkeyopt",
      "ec_paramgen_curve:P-256","-nodes","-keyout",f("client.key"),
      "-out",f("client.csr"),"-subj","/CN=PrivateScriptedRunner"]);
    await writeFile(f("client.ext"),[
      "basicConstraints=critical,CA:FALSE",
      "keyUsage=critical,digitalSignature",
      "extendedKeyUsage=clientAuth",""
    ].join("\n"));
    openssl(["x509","-req","-in",f("client.csr"),
      "-CA",f("ca.crt"),"-CAkey",f("ca.key"),"-CAcreateserial",
      "-out",f("client.crt"),"-days","2","-extfile",f("client.ext")]);
    const tls={
      ca:await readFile(f("ca.crt"),"utf8"),
      cert:await readFile(f("client.crt"),"utf8"),
      key:await readFile(f("client.key"),"utf8"),
      expectedServerFingerprint256:SERVER_FP
    };
    const pins={
      expectedRepository:REPO,expectedRef:REF,
      expectedWorkflowPath:
        ".github/workflows/trusted-scripted-offline-session-hold.yml",
      expectedSourceSha:SHA,intakeUrl:
        "https://10.27.10.4:8443/v1/trusted/github/scripted-offline-oidc-admission",
      audience:"urn:private-scripted-runner",tls
    };
    return {dir,pins,f,close:()=>rm(dir,{recursive:true,force:true})};
  }catch(e){await rm(dir,{recursive:true,force:true});throw e;}
}
test("R5 protected private runner accepts valid clientAuth TLS config but never declares connected",async()=>{
  const f=await fixture();try{
    const result=verify(f.pins,{expectedSourceSha:SHA});
    assert.deepEqual(result,{
      status:"runner_tls_config_verified_only_not_connected",
      source_sha:SHA,model_api_calls:0,
      server_handshake_proven:false,engineer_approval_proven:false
    });
    assert.equal(JSON.stringify(result).includes("PRIVATE KEY"),false);
  }finally{await f.close();}
});
test("R5 runner TLS preflight denies wrong source, workflow and public target",async()=>{
  const f=await fixture();try{
    for(const change of [
      p=>p.expectedSourceSha="b".repeat(40),
      p=>p.expectedRepository="attacker/delegation",
      p=>p.expectedRef="refs/heads/main",
      p=>p.expectedWorkflowPath="paid-workflow.yml",
      p=>p.intakeUrl="https://8.8.8.8:8443/v1/trusted/github/scripted-offline-oidc-admission",
      p=>p.intakeUrl="https://127.0.0.1:8443/v1/trusted/github/scripted-offline-oidc-admission",
      p=>p.intakeUrl="http://10.27.10.4:8443/v1/trusted/github/scripted-offline-oidc-admission",
      p=>p.intakeUrl="https://10.27.10.4/v1/trusted/github/scripted-offline-oidc-admission",
      p=>p.audience="short"
    ]){
      const p=structuredClone(f.pins);change(p);
      assert.throws(()=>verify(p,{expectedSourceSha:SHA}),
        /R5 private runner TLS NO-GO/);
    }
  }finally{await f.close();}
});
test("R5 runner TLS preflight denies invalid, expired, mismatched and reused leaf",async()=>{
  const f=await fixture();try{
    assert.throws(()=>verify(f.pins,{
      expectedSourceSha:SHA,nowMs:Date.now()+5*86400000
    }),/not currently valid/);
    const malformed=structuredClone(f.pins);
    malformed.tls.cert="INVALID CERTIFICATE";
    assert.throws(()=>verify(malformed,{expectedSourceSha:SHA}),
      /invalid protected runner certificate/);
    const wrongKey=structuredClone(f.pins);
    const alternate=f("alternate.key");
    openssl(["genpkey","-algorithm","EC","-pkeyopt",
      "ec_paramgen_curve:P-256","-out",alternate]);
    wrongKey.tls.key=await readFile(alternate,"utf8");
    assert.throws(()=>verify(wrongKey,{expectedSourceSha:SHA}),
      /protected private key mismatch/);
    const {X509Certificate}=await import("node:crypto");
    const leaf=new X509Certificate(f.pins.tls.cert);
    const reused=structuredClone(f.pins);
    reused.tls.expectedServerFingerprint256=leaf.fingerprint256;
    assert.throws(()=>verify(reused,{expectedSourceSha:SHA}),
      /must be distinct/);
    const notCA=structuredClone(f.pins);
    notCA.tls.ca=f.pins.tls.cert;
    assert.throws(()=>verify(notCA,{expectedSourceSha:SHA}),
      /directly signed/);
  }finally{await f.close();}
});
test("R5 runner TLS preflight denies leaf without clientAuth",async()=>{
  const f=await fixture();try{
    await writeFile(f("wrong.ext"),[
      "basicConstraints=critical,CA:FALSE",
      "keyUsage=critical,digitalSignature",
      "extendedKeyUsage=serverAuth",""
    ].join("\n"));
    openssl(["x509","-req","-in",f("client.csr"),
      "-CA",f("ca.crt"),"-CAkey",f("ca.key"),
      "-CAcreateserial","-out",f("wrong.crt"),
      "-days","2","-extfile",f("wrong.ext")]);
    const changed=structuredClone(f.pins);
    changed.tls.cert=await readFile(f("wrong.crt"),"utf8");
    assert.throws(()=>verify(changed,{expectedSourceSha:SHA}),
      /lacks clientAuth/);
  }finally{await f.close();}
});
test("R5 runner TLS CLI does not leak secrets or connect without config",()=>{
  const script=new URL("../r5-scripted-runner-tls-preflight.mjs",import.meta.url);
  const result=spawnSync(process.execPath,[
    "--experimental-strip-types",script.pathname
  ],{env:{PATH:process.env.PATH},encoding:"utf8",timeout:12000});
  assert.equal(result.status,1);
  assert.equal(result.stdout,"");
  assert.match(result.stderr,/configuration NO-GO/);
  assert.doesNotMatch(result.stderr,/BEGIN|PRIVATE KEY|Bearer|10\.27\./);
});
