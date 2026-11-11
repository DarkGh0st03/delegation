/**
 * R5 experimental INDEPENDENT verifier for a PUBLIC Ed25519 Status List JWT.
 *
 * No call to Adapter /v1/credentials/status/inspect, no Gateway bearer,
 * no authority, state mutation or credential reissuance. Directly verifies
 * the JWT signature, exact bytes committed by an EVM eth_call to the issuer
 * registry, and the selected W3C Status List bit.
 *
 * The RPC origin, contract address, chain ID, issuer DID, public verification
 * key, artifact bytes and index MUST be pinned out-of-band by the operator.
 * A caller-controlled local RPC is NOT an independently trusted Ethereum node,
 * and a block snapshot alone is not proof of finality or full R5 GO.
 */
import {createPublicKey,verify} from "node:crypto";
import {gunzipSync} from "node:zlib";

const MASK=(1n<<64n)-1n;
const RC=[
  0x0000000000000001n,0x0000000000008082n,
  0x800000000000808an,0x8000000080008000n,
  0x000000000000808bn,0x0000000080000001n,
  0x8000000080008081n,0x8000000000008009n,
  0x000000000000008an,0x0000000000000088n,
  0x0000000080008009n,0x000000008000000an,
  0x000000008000808bn,0x800000000000008bn,
  0x8000000000008089n,0x8000000000008003n,
  0x8000000000008002n,0x8000000000000080n,
  0x000000000000800an,0x800000008000000an,
  0x8000000080008081n,0x8000000000008080n,
  0x0000000080000001n,0x8000000080008008n
];
const ROT=[
  [0,36,3,41,18],[1,44,10,45,2],
  [62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14]
];
function deny(reason){throw Error("R5 independent EVM status NO-GO: "+reason);}
function rol(v,n){
  const r=BigInt(n);
  return r===0n?v:((v<<r)|(v>>(64n-r)))&MASK;
}
function permutation(a){
  for(const constant of RC){
    const c=Array.from({length:5},(_,x)=>
      a[x]^a[x+5]^a[x+10]^a[x+15]^a[x+20]);
    const d=Array.from({length:5},(_,x)=>
      c[(x+4)%5]^rol(c[(x+1)%5],1));
    for(let y=0;y<5;y++)for(let x=0;x<5;x++)
      a[x+5*y]^=d[x];
    const b=Array(25).fill(0n);
    for(let y=0;y<5;y++)for(let x=0;x<5;x++)
      b[y+5*((2*x+3*y)%5)]=rol(a[x+5*y],ROT[x][y]);
    for(let y=0;y<5;y++)for(let x=0;x<5;x++)
      a[x+5*y]=b[x+5*y]^((~b[((x+1)%5)+5*y]&MASK)&
        b[((x+2)%5)+5*y]);
    a[0]^=constant;
  }
}
/** Keccak-256 (Ethereum), NOT FIPS SHA3-256; no external dependencies. */
export function keccak256Bytes(value){
  const bytes=Buffer.from(value);
  const rate=136;
  const length=Math.ceil((bytes.length+1)/rate)*rate;
  const padded=Buffer.alloc(length);
  bytes.copy(padded);
  padded[bytes.length]^=0x01;
  padded[length-1]^=0x80;
  const a=Array(25).fill(0n);
  for(let offset=0;offset<length;offset+=rate){
    for(let i=0;i<rate;i++)
      a[Math.floor(i/8)]^=BigInt(padded[offset+i])<<BigInt((i%8)*8);
    permutation(a);
  }
  const result=Buffer.alloc(32);
  for(let i=0;i<32;i++)
    result[i]=Number((a[Math.floor(i/8)]>>BigInt((i%8)*8))&255n);
  return result;
}
const keccakHex=bytes=>"0x"+keccak256Bytes(bytes).toString("hex");
const ADDRESS=/^0x[a-fA-F0-9]{40}$/u;
const HASH=/^0x[a-fA-F0-9]{64}$/u;
const HEX=/^0x(?:0|[1-9a-f][a-f0-9]*)$/u;
const RPC_LOCAL=/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/u;
const TYPE=/^[A-Za-z0-9_-]+$/u;
function plain(x){return x&&typeof x==="object"&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;}
function decodePart(raw,limit){
  if(typeof raw!=="string"||raw.length>limit||!TYPE.test(raw))deny("invalid JWT base64url");
  const decoded=Buffer.from(raw,"base64url");
  if(decoded.toString("base64url")!==raw)deny("noncanonical JWT base64url");
  return decoded;
}
function verifyPublicJwt(token,issuerDid,publicJwk,credentialId){
  if(typeof token!=="string"||token.length<20||token.length>1024*1024)
    deny("bounded exact public JWT required");
  const parts=token.split(".");
  if(parts.length!==3)deny("compact JWT required");
  const [head,payload,signature]=parts;
  let header,document;
  try{
    header=JSON.parse(decodePart(head,4096).toString("utf8"));
    document=JSON.parse(decodePart(payload,1024*1024).toString("utf8"));
  }catch{deny("malformed public JWT");}
  if(!plain(header)||header.alg!=="EdDSA"||header.typ!=="vc+jwt"||
     !plain(document)||!plain(publicJwk)||
     Object.keys(publicJwk).sort().join(",")!=="crv,kty,x"||
     publicJwk.kty!=="OKP"||publicJwk.crv!=="Ed25519")
    deny("only out-of-band Ed25519 W3C Status List JWT is accepted");
  const sig=decodePart(signature,128);
  if(sig.length!==64)deny("invalid Ed25519 signature length");
  try{
    const pub=createPublicKey({key:publicJwk,format:"jwk"});
    if(pub.asymmetricKeyType!=="ed25519"||
       !verify(null,Buffer.from(head+"."+payload),pub,sig))
      deny("Status List JWT signature not authenticated");
  }catch{deny("Status List JWT signature cannot be verified");}
  const embedded=typeof document.issuer==="string"?
    document.issuer:document.issuer?.id;
  const types=document.type;
  const sub=document.credentialSubject;
  if(embedded!==issuerDid||document.id!==credentialId||
     !(Array.isArray(types)?types.includes("BitstringStatusListCredential"):
       types==="BitstringStatusListCredential")||
     !plain(sub)||sub.type!=="BitstringStatusList"||
     !(Array.isArray(sub.statusPurpose)?
       sub.statusPurpose.includes("revocation"):sub.statusPurpose==="revocation")||
     typeof sub.encodedList!=="string"||
     !sub.encodedList.startsWith("u"))
    deny("signed Status List payload differs from pinned issuer/list/purpose");
  if(sub.statusSize!==undefined&&sub.statusSize!==1)
    deny("non-default statusSize unsupported");
  return document;
}
function revokedBit(document,index){
  if(!Number.isSafeInteger(index)||index<0||index>=262144)
    deny("bounded status index required");
  const raw=document.credentialSubject.encodedList.slice(1);
  const zipped=decodePart(raw,512*1024);
  let bitstring;
  try{bitstring=gunzipSync(zipped,{maxOutputLength:32768});}
  catch{deny("malformed or oversized compressed status list");}
  if(bitstring.length<16384||index>=bitstring.length*8)
    deny("Status List too short for W3C profile or index");
  return (bitstring[index>>3]&(128>>(index%8)))!==0;
}
function readAnchor(result){
  if(typeof result!=="string"||
     !/^0x[0-9a-fA-F]{320}$/u.test(result))
    deny("invalid EVM getStatusList ABI tuple");
  const words=Array.from({length:5},(_,i)=>
    result.slice(2+i*64,2+(i+1)*64).toLowerCase());
  const purpose=BigInt("0x"+words[0]);
  const version=BigInt("0x"+words[2]);
  const exists=BigInt("0x"+words[4]);
  if(purpose!==1n||version<1n||version>BigInt(Number.MAX_SAFE_INTEGER)||
     exists!==1n||!HASH.test("0x"+words[1]))
    deny("Status List EVM anchor absent or not a revocation list");
  return {artifact_hash:"0x"+words[1],anchor_version:Number(version)};
}
async function rpc(fetchFn,url,method,params){
  let raw,body;
  try{
    const response=await fetchFn(url,{
      method:"POST",redirect:"error",
      headers:{accept:"application/json","content-type":"application/json"},
      body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),
      signal:AbortSignal.timeout(5000)
    });
    if(!response?.ok||response.status!==200)deny("read-only Ethereum RPC unavailable");
    raw=await response.text();
  }catch{deny("read-only Ethereum RPC unavailable");}
  if(typeof raw!=="string"||Buffer.byteLength(raw)>10000)
    deny("oversize RPC response");
  try{body=JSON.parse(raw);}catch{deny("malformed Ethereum RPC response");}
  if(!plain(body)||body.id!==1||body.jsonrpc!=="2.0"||
     Object.hasOwn(body,"error")||typeof body.result!=="string"&&
     !(method==="eth_getBlockByNumber"&&plain(body.result)))
    deny("Ethereum RPC did not return requested result");
  return body.result;
}
/**
 * This is one pinned-block independently recomputed snapshot, not an
 * independent finality proof. The caller can additionally compare
 * anchor_version with the Adapter's reported anchor_version.
 */
export async function observeR5IndependentEvmStatus({
  rpcUrl,expectedChainId,registryAddress,issuerAddress,issuerDid,
  statusListCredential,statusListIndex,signedStatusJwt,
  issuerPublicJwk,fetchFn=fetch,
  expectedBlockNumber,expectedBlockHash
}={}){
  const match=typeof rpcUrl==="string"?RPC_LOCAL.exec(rpcUrl):null;
  const didParts=typeof issuerDid==="string"&&
    issuerDid.startsWith("did:ethr:")?
    issuerDid.slice("did:ethr:".length).split(":"):[];
  let didChain;
  try{
    if(didParts.length===2&&
       /^(?:0x[a-fA-F0-9]+|[0-9]+)$/u.test(didParts[0]))
      didChain=BigInt(didParts[0]);
  }catch{/* invalid DID chain */}
  if(!match||Number(match[1])>65535||
     !HEX.test(expectedChainId??"")||
     !ADDRESS.test(registryAddress??"")||!ADDRESS.test(issuerAddress??"")||
     didParts.length!==2||didChain!==BigInt(expectedChainId)||
     didParts[1]?.toLowerCase()!==issuerAddress.toLowerCase()||
     typeof statusListCredential!=="string"||
     !/^https:\/\//u.test(statusListCredential)||
     statusListCredential.length>512||
     !Number.isSafeInteger(statusListIndex)||statusListIndex<0||
     typeof fetchFn!=="function"||
     (expectedBlockNumber!==undefined&&
       (!HEX.test(expectedBlockNumber)||BigInt(expectedBlockNumber)<1n))||
     (expectedBlockHash!==undefined&&!HASH.test(expectedBlockHash)))
    deny("out-of-band EVM trust pins are missing");
  const doc=verifyPublicJwt(signedStatusJwt,issuerDid,issuerPublicJwk,
    statusListCredential);
  if(!revokedBit(doc,statusListIndex))
    deny("signed public Status List bit is NOT revoked");
  const chain=await rpc(fetchFn,rpcUrl,"eth_chainId",[]);
  if(chain!==expectedChainId)deny("untrusted Ethereum chain identity");
  // For a DAG-wide audit, lock every subsequent read to the SAME
  // initially observed block rather than mixing later chain heads.
  const block=expectedBlockNumber??await rpc(fetchFn,rpcUrl,"eth_blockNumber",[]);
  if(!HEX.test(block)||BigInt(block)<1n)
    deny("Ethereum block snapshot unavailable");
  const observedBlock=await rpc(fetchFn,rpcUrl,"eth_getBlockByNumber",
    [block,false]);
  if(!plain(observedBlock)||!HASH.test(observedBlock.hash??"")||
     (expectedBlockHash!==undefined&&
       observedBlock.hash.toLowerCase()!==expectedBlockHash.toLowerCase()))
    deny("Ethereum block identity unavailable");
  const selector=keccakHex(Buffer.from("getStatusList(address,bytes32)")).slice(2,10);
  const listId=keccakHex(Buffer.from(statusListCredential,"utf8")).slice(2);
  const data="0x"+selector+issuerAddress.slice(2).toLowerCase().padStart(64,"0")+listId;
  const output=await rpc(fetchFn,rpcUrl,"eth_call",[
    {to:registryAddress,data},block
  ]);
  const anchor=readAnchor(output);
  if(anchor.artifact_hash!==keccakHex(Buffer.from(signedStatusJwt,"utf8")))
    deny("public JWT bytes do not match independent EVM anchor");
  const after=await rpc(fetchFn,rpcUrl,"eth_getBlockByNumber",[block,false]);
  if(!plain(after)||after.hash!==observedBlock.hash)
    deny("chain reorganized during independent Status List snapshot");
  return Object.freeze({
    status:"public_jwt_signature_evm_anchor_and_revoked_bit_verified",
    anchor_version:anchor.anchor_version,
    chain_id:chain,block_number:block,block_hash:observedBlock.hash,
    adapter_status_endpoint_used:false,
    gateway_bearer_used:false,
    independent_chain_finality_verified:false,
    complete_issuance_inventory_verified:false,
    external_r5_go:false
  });
}
