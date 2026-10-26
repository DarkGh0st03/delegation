import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync,spawnSync} from "node:child_process";
import {X509Certificate} from "node:crypto";
import {createServer} from "node:https";
import {probeR5PrivateScriptedMtlsReadOnly as probe}
  from "../r5-scripted-mtls-network-probe.mjs";
const SHA="a".repeat(40);
function openssl(args){
  execFileSync("openssl",args,{stdio:"ignore",timeout:12000});
}
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),"r5-real-private-mtls-"));
  const f=n=>join(dir,n);
  try{
    openssl(["req","-x509","-newkey","ec","-pkeyopt",
      "ec_paramgen_curve:P-256","-nodes","-keyout",f("ca.key"),
      "-out",f("ca.pem"),"-days","2","-subj","/CN=R5MockPrivateCA",
      "-addext","basicConstraints=critical,CA:TRUE",
      "-addext","keyUsage=critical,keyCertSign,cRLSign"]);
    async function leaf(n,extension){
      openssl(["req","-new","-newkey","ec","-pkeyopt",
        "ec_paramgen_curve:P-256","-nodes","-keyout",f(n+".key"),
        "-out",f(n+".csr"),"-subj","/CN="+n]);
      await writeFile(f(n+".ext"),extension,{mode:0o600});
      openssl(["x509","-req","-in",f(n+".csr"),
        "-CA",f("ca.pem"),"-CAkey",f("ca.key"),"-CAcreateserial",
        "-out",f(n+".pem"),"-days","2","-extfile",f(n+".ext")]);
    }
    await leaf("server",[
      "basicConstraints=critical,CA:FALSE",
      "keyUsage=digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",
      "subjectAltName=IP:127.0.0.1",""
    ].join("\n"));
    await leaf("client",[
      "basicConstraints=critical,CA:FALSE",
      "keyUsage=digitalSignature",
      "extendedKeyUsage=clientAuth",""
    ].join("\n"));
    const ca=await readFile(f("ca.pem"),"utf8"),
      serverCert=await readFile(f("server.pem"),"utf8"),
      serverKey=await readFile(f("server.key"),"utf8"),
      clientCert=await readFile(f("client.pem"),"utf8"),
      clientKey=await readFile(f("client.key"),"utf8");
    const serverFingerprint=new X509Certificate(serverCert).fingerprint256;
    let requests=0;
    const server=createServer({
      ca,cert:serverCert,key:serverKey,
      requestCert:true,rejectUnauthorized:true,minVersion:"TLSv1.2"
    },(req,res)=>{
      requests++;
      res.writeHead(404,{"content-type":"application/json"});
      res.end('{"status":"denied"}');
    });
    await new Promise((resolve,reject)=>{
      server.once("error",reject);
      server.listen(0,"127.0.0.1",resolve);
    });
    return {
      target:"https://127.0.0.1:"+server.address().port+
        "/v1/trusted/github/scripted-offline-oidc-admission",
      tls:{ca,cert:clientCert,key:clientKey,
        expectedServerFingerprint256:serverFingerprint},
      get requests(){return requests;},
      close:async()=>{
        await new Promise(resolve=>server.close(resolve));
        await rm(dir,{recursive:true,force:true});
      }
    };
  }catch(error){await rm(dir,{recursive:true,force:true});throw error;}
}
test("R5 REAL local mTLS HTTP negative probe accepts pinned host and client without granting authority",async()=>{
  const f=await fixture();try{
    const result=await probe({
      intakeUrl:f.target,tls:f.tls,expectedSourceSha:SHA
    });
    assert.deepEqual(result,{
      status:"private_mtls_negative_status_probe_only",
      source_sha:SHA,
      real_mtls_http_denial_observed:true,
      oidc_authenticated:false,signed_engineer_approval:false,
      approved_dag_complete:false,delegated_root_retired:false
    });
    assert.equal(f.requests,1);
  }finally{await f.close();}
});
test("R5 REAL local mTLS probe denies server certificate fingerprint mismatch",async()=>{
  const f=await fixture();try{
    await assert.rejects(probe({
      intakeUrl:f.target,expectedSourceSha:SHA,
      tls:{...f.tls,expectedServerFingerprint256:
        Array(32).fill("AA").join(":")}
    }),/network probe NO-GO/);
    assert.equal(f.requests,0);
  }finally{await f.close();}
});
test("R5 REAL local mTLS probe denies mismatched client certificate",async()=>{
  const f=await fixture();try{
    const wrong=await fixture();
    try{
      await assert.rejects(probe({
        intakeUrl:f.target,expectedSourceSha:SHA,
        tls:{...f.tls,cert:wrong.tls.cert,key:wrong.tls.key}
      }),/network probe NO-GO/);
      assert.equal(f.requests,0);
    }finally{await wrong.close();}
  }finally{await f.close();}
});
test("R5 mTLS probe refuses unpinned source, nonadmission paths and insecure protocols",async()=>{
  const f=await fixture();try{
    for(const item of [
      {expectedSourceSha:"not-sha"},
      {intakeUrl:f.target.replace("https:","http:")},
      {intakeUrl:f.target.replace("oidc-admission","other")},
      {intakeUrl:f.target+"?run_id=42"},
      {tls:{...f.tls,expectedServerFingerprint256:"invalid"}}
    ])await assert.rejects(probe({
      intakeUrl:f.target,tls:f.tls,expectedSourceSha:SHA,...item
    }),/network probe NO-GO/);
    assert.equal(f.requests,0);
  }finally{await f.close();}
});
test("R5 operator mTLS network CLI cannot accidentally start or leak without config",()=>{
  const script=new URL("../r5-scripted-mtls-network-probe.mjs",import.meta.url);
  const result=spawnSync(process.execPath,[
    "--experimental-strip-types",script.pathname
  ],{env:{PATH:process.env.PATH},encoding:"utf8",timeout:12000});
  assert.equal(result.status,1);
  assert.equal(result.stdout,"");
  assert.match(result.stderr,/network probe NO-GO/);
  assert.doesNotMatch(result.stderr,/BEGIN|PRIVATE KEY|Bearer|https:/);
});
