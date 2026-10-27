import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {generateKeyPairSync,createHash,sign} from "node:crypto";
import {gzipSync} from "node:zlib";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {keccak256Bytes} from "../r5-independent-status-evm-verifier.mjs";
import {observeProtectedR5PublicEvmStatus}
  from "../r5-protected-independent-evm-audit.mjs";

const ADDR="0x1234567890abcdef1234567890abcdef12345678";
const REG="0x1111111111111111111111111111111111111111";
const DID="did:ethr:0x7a69:"+ADDR;
const URL="https://status.example/lists/r5-public-proof";
const INDEX=82;
const hex=x=>"0x"+keccak256Bytes(x).toString("hex");
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),"r5-independent-public-"));
  const operator=join(root,"operator"),pub=join(root,"public"),
    status=join(pub,"status-lists");
  await mkdir(operator,{mode:0o700});
  await mkdir(pub,{mode:0o755});
  await mkdir(status,{mode:0o755});
  const kp=generateKeyPairSync("ed25519");
  const bit=Buffer.alloc(16384);
  bit[INDEX>>3]|=128>>(INDEX%8);
  const document={
    id:URL,issuer:DID,
    type:["VerifiableCredential","BitstringStatusListCredential"],
    credentialSubject:{type:"BitstringStatusList",
      statusPurpose:"revocation",encodedList:"u"+gzipSync(bit).toString("base64url")}
  };
  const enc=x=>Buffer.from(JSON.stringify(x)).toString("base64url");
  const signing=enc({alg:"EdDSA",typ:"vc+jwt"})+"."+enc(document);
  const jwt=signing+"."+sign(null,Buffer.from(signing),kp.privateKey)
    .toString("base64url");
  const sha=createHash("sha256");
  for(const value of [DID,URL]){
    const bytes=Buffer.from(value),len=Buffer.alloc(8);
    len.writeBigUInt64BE(BigInt(bytes.length));
    sha.update(len).update(bytes);
  }
  const publicFile=join(status,sha.digest("hex")+".jwt");
  await writeFile(publicFile,jwt,{mode:0o644});
  const configPath=join(operator,"audit.json");
  const jwkPath=join(operator,"issuer.jwk");
  const config={
    schema:"r5-independent-evm-public-status-v1",
    rpc_url:"http://127.0.0.1:8545",expected_chain_id:"0x7a69",
    registry_address:REG,issuer_address:ADDR,issuer_did:DID,
    status_list_credential:URL,status_list_index:INDEX,
    public_artifact_root:pub,issuer_public_jwk_file:jwkPath
  };
  await writeFile(configPath,JSON.stringify(config),{mode:0o600});
  await writeFile(jwkPath,
    JSON.stringify(kp.publicKey.export({format:"jwk"})),{mode:0o600});
  const word=x=>BigInt(x).toString(16).padStart(64,"0");
  const chainResult="0x"+word(1)+hex(Buffer.from(jwt)).slice(2)+
    word(2)+word(123)+word(1);
  const calls=[];
  const fetchFn=async(_url,opts)=>{
    const q=JSON.parse(opts.body);
    calls.push(q.method);
    const result={
      eth_chainId:"0x7a69",eth_blockNumber:"0x6",
      eth_getBlockByNumber:{hash:"0x"+"bc".repeat(32)},
      eth_call:chainResult
    }[q.method];
    return {ok:true,status:200,text:async()=>JSON.stringify({
      jsonrpc:"2.0",id:1,result
    })};
  };
  const args={configPath,expectedChainId:"0x7a69",
    expectedRegistryAddress:REG,expectedIssuerDid:DID,
    expectedStatusListUrl:URL,expectedIndex:INDEX,fetchFn};
  return {root,configPath,publicFile,config,calls,args,
    close:()=>rm(root,{recursive:true,force:true})};
}
async function owner(args){
  const old=process.env.GITHUB_ACTIONS;
  delete process.env.GITHUB_ACTIONS;
  try{return await observeProtectedR5PublicEvmStatus(args);}
  finally{if(old===undefined)delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS=old;}
}
test("R5 protected operator reads Rust public artifact and verifies real Ed25519 JWT and independent pinned EVM hash",async()=>{
  const f=await fixture();try{
    const out=await owner(f.args);
    assert.equal(out.status,"public_jwt_signature_evm_anchor_and_revoked_bit_verified");
    assert.equal(out.anchor_version,2);
    assert.equal(out.gateway_bearer_used,false);
    assert.equal(out.external_r5_go,false);
    assert.deepEqual(f.calls,["eth_chainId","eth_blockNumber",
      "eth_getBlockByNumber","eth_call","eth_getBlockByNumber"]);
  }finally{await f.close();}
});
test("R5 externally pinned chain, registry and bit cannot be replaced by config",async()=>{
  const f=await fixture();try{
    for(const bad of [
      {expectedChainId:"0x1"},
      {expectedRegistryAddress:"0x"+"ff".repeat(20)},
      {expectedStatusListUrl:"https://evil.example/list"},
      {expectedIndex:INDEX+1}
    ]){
      await assert.rejects(owner({...f.args,...bad}),/NO-GO/);
      assert.equal(f.calls.length,0);
    }
  }finally{await f.close();}
});
test("R5 edited public artifact or mismatched signing key fails before EVM network",async()=>{
  const f=await fixture();try{
    const {readFile}=await import("node:fs/promises");
    const jwt=await readFile(f.publicFile,"utf8");
    await writeFile(f.publicFile,jwt.slice(0,-1)+
      (jwt.at(-1)==="a"?"b":"a"),{mode:0o644});
    await assert.rejects(owner(f.args),/NO-GO/);
    assert.equal(f.calls.length,0);
  }finally{await f.close();}
});
test("R5 GitHub Actions cannot use protected CLI and secret paths never reach logs",()=>{
  const url=new URL("../r5-protected-independent-evm-audit.mjs",import.meta.url);
  const child=spawnSync(process.execPath,[
    "--experimental-strip-types",url.pathname
  ],{encoding:"utf8",timeout:12000,env:{
    PATH:process.env.PATH??"",GITHUB_ACTIONS:"true",
    DELEGATION_R5_INDEPENDENT_EVM_CONFIG:"/private/secret-audit.json",
    DELEGATION_R5_EXPECTED_CHAIN_ID:"0x7a69",
    DELEGATION_R5_EXPECTED_REGISTRY_ADDRESS:REG,
    DELEGATION_R5_EXPECTED_ISSUER_DID:DID,
    DELEGATION_R5_EXPECTED_STATUS_LIST_ID:URL,
    DELEGATION_R5_EXPECTED_STATUS_INDEX:String(INDEX)
  }});
  assert.equal(child.status,1);
  assert.equal(child.stdout,"");
  assert.match(child.stderr,/R5 protected independent Ethereum verification NO-GO/);
  assert.doesNotMatch(child.stderr,/secret-audit|did:ethr|status.example/);
});
