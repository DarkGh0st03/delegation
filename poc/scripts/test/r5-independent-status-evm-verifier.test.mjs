import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {gzipSync} from "node:zlib";
import {keccak256Bytes,observeR5IndependentEvmStatus}
  from "../r5-independent-status-evm-verifier.mjs";

const hex=bytes=>"0x"+keccak256Bytes(bytes).toString("hex");
const SHA="ab".repeat(32);
const ADDR="0x1234567890abcdef1234567890abcdef12345678";
const REG="0x1111111111111111111111111111111111111111";
const DID="did:ethr:0x7a69:"+ADDR;
const URL="https://status.example/lists/native-r5-independent";
const INDEX=2048;
function fixture(bit=true){
  const keys=generateKeyPairSync("ed25519");
  const jwk=keys.publicKey.export({format:"jwk"});
  const bits=Buffer.alloc(16384);
  if(bit)bits[INDEX>>3]|=128>>(INDEX%8);
  const doc={
    "@context":["https://www.w3.org/ns/credentials/v2"],
    id:URL,type:["VerifiableCredential","BitstringStatusListCredential"],
    issuer:DID,validFrom:"2026-10-27T00:00:00Z",
    credentialSubject:{
      id:URL+"#list",type:"BitstringStatusList",statusPurpose:"revocation",
      encodedList:"u"+gzipSync(bits).toString("base64url")
    }
  };
  const compact=x=>Buffer.from(JSON.stringify(x)).toString("base64url");
  const unsigned=compact({alg:"EdDSA",typ:"vc+jwt"})+"."+compact(doc);
  const jwt=unsigned+"."+
    sign(null,Buffer.from(unsigned),keys.privateKey).toString("base64url");
  let anchorHash=hex(Buffer.from(jwt)),version=3,chainId="0x7a69",
    blockHash=SHA,requests=[],mutateAt=()=>{};
  const word=x=>BigInt(x).toString(16).padStart(64,"0");
  const anchor=()=>{
    return "0x"+word(1)+"_"+anchorHash.slice(2).toLowerCase()+
      "_"+word(version)+"_"+word(1888888888)+"_"+word(1);
  };
  const fetchFn=async(rpcUrl,options)=>{
    assert.equal(rpcUrl,"http://127.0.0.1:8545");
    assert.equal(options.method,"POST");
    assert.equal(options.redirect,"error");
    assert.equal(options.headers.authorization,undefined);
    const req=JSON.parse(options.body);
    requests.push(req);
    mutateAt(req);
    const results={
      eth_chainId:chainId,
      eth_blockNumber:"0x9",
      eth_getBlockByNumber:{hash:blockHash},
      eth_call:anchor().replaceAll("_","")
    };
    if(req.method==="eth_call"){
      assert.equal(req.params[0].to,REG);
      assert.equal(req.params[1],"0x9");
      assert.equal(req.params[0].data.length,2+8+64+64);
      assert.equal(req.params[0].data.slice(10,74),
        ADDR.slice(2).toLowerCase().padStart(64,"0"));
      assert.equal(req.params[0].data.slice(74),
        hex(Buffer.from(URL)).slice(2));
      assert.equal(req.params[0].data.slice(2,10),
        hex(Buffer.from("getStatusList(address,bytes32)")).slice(2,10));
    }
    return {status:200,ok:true,text:async()=>JSON.stringify({
      jsonrpc:"2.0",id:1,result:results[req.method]
    })};
  };
  return {
    args:{
      rpcUrl:"http://127.0.0.1:8545",expectedChainId:"0x7a69",
      registryAddress:REG,issuerAddress:ADDR,issuerDid:DID,
      statusListCredential:URL,statusListIndex:INDEX,signedStatusJwt:jwt,
      issuerPublicJwk:jwk,fetchFn
    },
    requests,alterHash:value=>{anchorHash=value;},
    alterVersion:value=>{version=value;},
    alterChain:value=>{chainId=value;},
    alterBlock:value=>{blockHash=value;},
    onRequest:cb=>{mutateAt=cb;}
  };
}
test("R5 Ethereum Keccak-256 uses the correct non-FIPS domain, including empty and abc vectors",()=>{
  assert.equal(hex(Buffer.alloc(0)),
    "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(hex(Buffer.from("abc")),
    "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
});
test("R5 validates real Ed25519 JWT, revoked W3C bit and exact raw JWT hash from independently pinned eth_call",async()=>{
  const f=fixture();
  const answer=await observeR5IndependentEvmStatus(f.args);
  assert.equal(answer.status,
    "public_jwt_signature_evm_anchor_and_revoked_bit_verified");
  assert.equal(answer.anchor_version,3);
  assert.equal(answer.chain_id,"0x7a69");
  assert.equal(answer.block_hash,SHA);
  assert.equal(answer.adapter_status_endpoint_used,false);
  assert.equal(answer.gateway_bearer_used,false);
  assert.equal(answer.independent_chain_finality_verified,false);
  assert.equal(answer.external_r5_go,false);
  assert.deepEqual(f.requests.map(r=>r.method),[
    "eth_chainId","eth_blockNumber","eth_getBlockByNumber",
    "eth_call","eth_getBlockByNumber"
  ]);
});
test("R5 status bit clear denies before any Ethereum RPC access",async()=>{
  const f=fixture(false);
  await assert.rejects(observeR5IndependentEvmStatus(f.args),/NO-GO/);
  assert.equal(f.requests.length,0);
});
test("R5 forged JWT, unknown Ed25519 public key, or payload swap denies before RPC",async()=>{
  const f=fixture();
  const badJwt=f.args.signedStatusJwt.slice(0,-1)+"a";
  const another=generateKeyPairSync("ed25519").publicKey.export({format:"jwk"});
  const cases=[
    {signedStatusJwt:badJwt},
    {issuerPublicJwk:another},
    {issuerDid:"did:ethr:0x7a69:"+ADDR.slice(0,-1)+"9"},
    {statusListCredential:"https://status.example/lists/wrong"}
  ];
  for(const bad of cases){
    const copy=fixture();
    await assert.rejects(observeR5IndependentEvmStatus({
      ...copy.args,...bad
    }),/NO-GO/);
    assert.equal(copy.requests.length,0);
  }
  assert.equal(f.requests.length,0);
});
test("R5 rejects invalid EVM chain, missing/stale anchor, zero version and block reorganization",async()=>{
  for(const mode of ["chain","hash","version","reorg"]){
    const f=fixture();
    if(mode==="chain")f.alterChain("0x1");
    if(mode==="hash")f.alterHash("0x"+"12".repeat(32));
    if(mode==="version")f.alterVersion(0);
    if(mode==="reorg"){
      let n=0;
      f.onRequest(req=>{
        if(req.method==="eth_getBlockByNumber"&&++n===2)
          f.alterBlock("ef".repeat(32));
      });
    }
    await assert.rejects(observeR5IndependentEvmStatus(f.args),/NO-GO/);
  }
});
test("R5 remote RPC, mismatched DID address and invalid index cannot initiate network",async()=>{
  for(const bad of [
    {rpcUrl:"https://remote-unknown.example.org"},
    {expectedChainId:"0x01"},
    {issuerAddress:"0x2222222222222222222222222222222222222222"},
    {statusListIndex:-1}
  ]){
    const f=fixture();
    await assert.rejects(observeR5IndependentEvmStatus({...f.args,...bad}),
      /NO-GO/);
    assert.equal(f.requests.length,0);
  }
});
