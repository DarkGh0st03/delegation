/** Backend provenance for a permission-only proposal. This signature is not
 * Engineer approval, does not issue a root and never authorizes Execution. */
import {createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {constants} from 'node:fs';
import {open,lstat} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {validateAuthorityProposal} from '../../plan-contracts/src/authority-only-approval.mjs';
import {RUST_OPERATIONS} from '../../../apps/gateway/src/operation-catalog.ts';
import {preliminaryReadPermissions,type TrustedPlanningSnapshot} from './trusted-engineer-authority.ts';
import type {UnapprovedAuthorityProposal} from './authority-only-planning-proposal.ts';
const DOMAIN='delegation.trusted.authority-planning-checkpoint.v1';
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const OPS=new Set(RUST_OPERATIONS);
function deny(reason:string):never{throw Error('Authority Planning checkpoint: '+reason);}
function exact(v:unknown,fields:string[]):void{
 if(!v||typeof v!=='object'||Array.isArray(v)||
  Object.keys(v).sort().join(',')!==[...fields].sort().join(','))deny('invalid fields');
}
function canonical(v:any):any{
 if(Array.isArray(v))return v.map(canonical);
 if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
 return v;
}
function message(v:Omit<AuthorityPlanningCheckpoint,'signature'>):Buffer{
 return Buffer.from(JSON.stringify(canonical({domain:DOMAIN,...v})));
}
export interface AuthorityPlanningCheckpoint{
 version:1;key_id:string;issued_at:string;expires_at:string;
 snapshot:TrustedPlanningSnapshot;
 proposal:UnapprovedAuthorityProposal['proposal'];verified_source_reads:number;
 signature:string;
}
export interface AuthorityPlanningCheckpointTrust{
 trustedKeys:Readonly<Record<string,{public_key_pem:string}>>;
 expectedSessionId:string;expectedRepository:TrustedPlanningSnapshot['repository'];
 expectedBaseRevision:string;expectedWorkBranch:string;expectedRequirement:string;
}
function validate(v:AuthorityPlanningCheckpoint,now:number):void{
 exact(v,['version','key_id','issued_at','expires_at','snapshot','proposal','verified_source_reads','signature']);
 const utc=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u;
 if(v.version!==1||typeof v.key_id!=='string'||!ID.test(v.key_id)||
  typeof v.issued_at!=='string'||!utc.test(v.issued_at)||
  typeof v.expires_at!=='string'||!utc.test(v.expires_at)||
  !Number.isFinite(now)||!Number.isFinite(Date.parse(v.issued_at))||
  !Number.isFinite(Date.parse(v.expires_at))||
  Date.parse(v.issued_at)>now+60000||Date.parse(v.expires_at)<=now||
  Date.parse(v.expires_at)<=Date.parse(v.issued_at)||
  Date.parse(v.expires_at)-Date.parse(v.issued_at)>3600000||
  !Number.isSafeInteger(v.verified_source_reads)||v.verified_source_reads<1||
  v.verified_source_reads>64||typeof v.signature!=='string'||
  !/^[A-Za-z0-9_-]{86}$/.test(v.signature))deny('invalid time, grounding or signature');
 preliminaryReadPermissions(v.snapshot);
 validateAuthorityProposal(v.proposal,{allowedOperations:OPS});
 if(v.proposal.session_id!==v.snapshot.session_id||
  v.proposal.base_revision!==v.snapshot.base_revision||
  !isDeepStrictEqual(v.proposal.repository,v.snapshot.repository))deny('snapshot mismatch');
}
export function signAuthorityPlanningCheckpoint(input:{snapshot:TrustedPlanningSnapshot;
 proposal:UnapprovedAuthorityProposal;keyId:string;privateKeyPem:string;
 issuedAt:string;expiresAt:string}):AuthorityPlanningCheckpoint{
 if(input.proposal?.status!=='unapproved_authority_proposal')deny('wrong proposal protocol');
 const v:AuthorityPlanningCheckpoint={version:1,key_id:input.keyId,
  issued_at:input.issuedAt,expires_at:input.expiresAt,
  snapshot:structuredClone(input.snapshot),proposal:structuredClone(input.proposal.proposal),
  verified_source_reads:input.proposal.verified_source_reads,signature:'A'.repeat(86)};
 validate(v,Date.parse(v.issued_at));
 const key=createPrivateKey(input.privateKeyPem);
 if(key.asymmetricKeyType!=='ed25519')deny('Ed25519 backend key required');
 const {signature,...payload}=v;
 v.signature=sign(null,message(payload),key).toString('base64url');
 return v;
}
export function verifyAuthorityPlanningCheckpoint(raw:unknown,trust:AuthorityPlanningCheckpointTrust,
 now=Date.now()):AuthorityPlanningCheckpoint{
 const v=raw as AuthorityPlanningCheckpoint;validate(v,now);
 if(v.proposal.session_id!==trust.expectedSessionId||
  v.proposal.base_revision!==trust.expectedBaseRevision||
  v.proposal.branch!==trust.expectedWorkBranch||
  v.proposal.requirement!==trust.expectedRequirement||
  !isDeepStrictEqual(v.proposal.repository,trust.expectedRepository))deny('independent context mismatch');
 const pem=trust.trustedKeys[v.key_id]?.public_key_pem;
 if(!pem)deny('untrusted backend key');
 const key=createPublicKey(pem),{signature,...payload}=v;
 if(key.asymmetricKeyType!=='ed25519'||
  !verify(null,message(payload),key,Buffer.from(signature,'base64url')))deny('invalid provenance signature');
 return structuredClone(v);
}
function privateMeta(s:any,dir:boolean):void{
 if((dir?!s.isDirectory():!s.isFile())||s.isSymbolicLink()||
  (s.mode&0o777)!==(dir?0o700:0o600)||
  (typeof process.getuid==='function'&&s.uid!==process.getuid())||
  (!dir&&s.nlink!==1))deny('unsafe checkpoint storage');
}
export class AuthorityPlanningCheckpointStore{
 readonly #dir:string;readonly #trust:AuthorityPlanningCheckpointTrust;
 constructor(opts:{directory:string;trust:AuthorityPlanningCheckpointTrust}){
  if(!opts||!isAbsolute(opts.directory)||resolve(opts.directory)!==opts.directory||
   !ID.test(opts.trust.expectedSessionId))deny('private directory and pinned session required');
  this.#dir=opts.directory;this.#trust=structuredClone(opts.trust);
 }
 assertContext(snapshot:TrustedPlanningSnapshot,branch:string,requirement:string):void{
  if(snapshot.session_id!==this.#trust.expectedSessionId||
   snapshot.base_revision!==this.#trust.expectedBaseRevision||
   !isDeepStrictEqual(snapshot.repository,this.#trust.expectedRepository)||
   branch!==this.#trust.expectedWorkBranch||requirement!==this.#trust.expectedRequirement)
   deny('independent context mismatch');
 }
 assertSigner(keyId:string,privatePem:string):void{
  const privateKey=createPrivateKey(privatePem);
  const pinned=this.#trust.trustedKeys[keyId]?.public_key_pem;
  if(privateKey.asymmetricKeyType!=='ed25519'||!pinned||
   createPublicKey(privateKey).export({type:'spki',format:'pem'})!==
   createPublicKey(pinned).export({type:'spki',format:'pem'}))deny('signer differs from pinned backend');
 }
 async persistVerified(v:AuthorityPlanningCheckpoint):Promise<void>{
  verifyAuthorityPlanningCheckpoint(v,this.#trust);
  const encoded=JSON.stringify(v)+'\n';
  if(Buffer.byteLength(encoded)>262144)deny('checkpoint exceeds bound');
  privateMeta(await lstat(this.#dir),true);
  const file=await open(join(this.#dir,this.#trust.expectedSessionId+'.authority-planning.json'),
   constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{privateMeta(await file.stat(),false);await file.writeFile(encoded);await file.sync();}
  finally{await file.close();}
  const dir=await open(this.#dir,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await dir.sync();}finally{await dir.close();}
 }
 async load():Promise<AuthorityPlanningCheckpoint>{
  privateMeta(await lstat(this.#dir),true);
  const fd=await open(join(this.#dir,this.#trust.expectedSessionId+'.authority-planning.json'),
   constants.O_RDONLY|constants.O_NOFOLLOW);
  let text:string;
  try{const s=await fd.stat();privateMeta(s,false);
   if(s.size<1||s.size>262144)deny('checkpoint exceeds bound');
   text=await fd.readFile('utf8');}finally{await fd.close();}
  if(Buffer.byteLength(text)>262144)deny('checkpoint exceeds bound');
  return verifyAuthorityPlanningCheckpoint(JSON.parse(text),this.#trust);
 }
}
