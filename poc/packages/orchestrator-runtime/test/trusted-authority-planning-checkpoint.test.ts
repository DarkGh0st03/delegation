import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,rm,chmod,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compileAuthorityOnlyPlanningProposal} from '../src/authority-only-planning-proposal.ts';
import {signAuthorityPlanningCheckpoint as signTicket,verifyAuthorityPlanningCheckpoint as verifyTicket,AuthorityPlanningCheckpointStore as Store} from '../src/trusted-authority-planning-checkpoint.ts';
import {TrustedActiveAuthorityPlanning} from '../src/trusted-active-authority-planning.ts';
import {TrustedAdkReadOnlyPlanner} from '../src/trusted-adk-planner.ts';
import {TrustedExecutionCoordinator} from '../src/trusted-execution-coordinator.ts';
import {TrustedPlanningGatewayReadPort} from '../src/trusted-planning-gateway-port.ts';
import {selectAuthorityOnlyGrant} from '../../plan-contracts/src/authority-only-approval.mjs';
import {RUST_OPERATIONS} from '../../../apps/gateway/src/operation-catalog.ts';
const snapshot={session_id:'authority-review',repository:{authority:'gitea.local',owner:'thesis',repository:'iam-console-poc'},base_revision:'a'.repeat(40),directories:['','apps'],files:['apps/user.ts']};
const proposal={...compileAuthorityOnlyPlanningProposal({requested_permissions:[{operation:'update_file',resource_type:'directory',path:'apps'}],assumptions:[],uncertainties:[]},{snapshot,requirement:'Suspend accounts',workBranch:'feature/account-suspension'}),verified_source_reads:1};
const keys=generateKeyPairSync('ed25519');
const privatePem=keys.privateKey.export({format:'pem',type:'pkcs8'}).toString();
const publicPem=keys.publicKey.export({format:'pem',type:'spki'}).toString();
const trust={trustedKeys:{backend:{public_key_pem:publicPem}},expectedSessionId:snapshot.session_id,expectedRepository:snapshot.repository,expectedBaseRevision:snapshot.base_revision,expectedWorkBranch:proposal.proposal.branch,expectedRequirement:proposal.proposal.requirement};
function ticket(){const now=Date.now();return signTicket({snapshot,proposal,keyId:'backend',privateKeyPem:privatePem,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString()});}
test('backend checkpoint binds permission proposal and supports separate Engineer selection',()=>{
 const v=verifyTicket(ticket(),trust);
 const grant=selectAuthorityOnlyGrant(v.proposal,v.proposal.requested_permissions,{allowedOperations:new Set(RUST_OPERATIONS)});
 assert.deepEqual(grant.permissions,v.proposal.requested_permissions);
 assert.equal(Object.hasOwn(v.proposal,'tasks'),false);
 assert.equal(Object.hasOwn(v,'engineer_did'),false);
});
for(const field of ['expectedSessionId','expectedBaseRevision','expectedWorkBranch','expectedRequirement'] as const){
 test(`independent ${field} pin cannot be copied from untrusted checkpoint`,()=>{
  assert.throws(()=>verifyTicket(ticket(),{...trust,[field]:'foreign'}));
 });
}
test('signature, extra Task fields, missing reads and expiration are rejected',()=>{
 const v=ticket();const changed=structuredClone(v);changed.proposal.requested_permissions[0].operation='read_file';
 assert.throws(()=>verifyTicket(changed,trust),/signature/);
 assert.throws(()=>verifyTicket({...v,tasks:[]},trust),/fields/);
 assert.throws(()=>verifyTicket({...v,verified_source_reads:0},trust));
 assert.throws(()=>verifyTicket(v,trust,Date.parse(v.expires_at)));
 assert.throws(()=>verifyTicket(v,{...trust,trustedKeys:{}}));
});
async function disk(run:(dir:string,store:Store)=>Promise<void>){
 const dir=await mkdtemp(join(tmpdir(),'authority-checkpoint-'));
 try{await chmod(dir,0o700);await run(dir,new Store({directory:dir,trust}));}
 finally{await rm(dir,{recursive:true,force:true});}
}
test('private file persists verified checkpoint and refuses overwrite',async()=>disk(async(dir,s)=>{
 await s.persistVerified(ticket());assert.deepEqual((await s.load()).proposal,proposal.proposal);
 await assert.rejects(s.persistVerified(ticket()),/EEXIST/);
 const file=join(dir,snapshot.session_id+'.authority-planning.json');
 await chmod(file,0o644);await assert.rejects(s.load(),/unsafe/);
}));
test('storage rejects public directory and wrong signer before persistence',async()=>disk(async(dir,s)=>{
 const wrong=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}).toString();
 assert.throws(()=>s.assertSigner('backend',wrong),/pinned backend/);
 assert.throws(()=>s.assertContext(snapshot,proposal.proposal.branch,'foreign requirement'),/context mismatch/);
 await chmod(dir,0o755);await assert.rejects(s.persistVerified(ticket()),/unsafe/);
 assert.deepEqual(await readdir(dir),[]);
}));
// Lifecycle doubles isolate trusted boundary ordering; native Root/VP/provider
// behavior is covered separately by the native E2E, not claimed by this test.
function active(store:Store,afterProposal?:()=>void){
 let phase='planning',calls=0;
 const coordinator=Object.create(TrustedExecutionCoordinator.prototype);
 Object.defineProperty(coordinator,'phase',{get:()=>phase});
 const port=Object.create(TrustedPlanningGatewayReadPort.prototype);
 port.assertTrustedPlanningBinding=(c:unknown,s:unknown)=>{assert.equal(c,coordinator);assert.deepEqual(s,snapshot);};
 const planner=Object.create(TrustedAdkReadOnlyPlanner.prototype);
 planner.config={snapshot,workBranch:proposal.proposal.branch,requirement:proposal.proposal.requirement,readPort:port};
 planner.proposeAuthority=async()=>{calls++;afterProposal?.();return structuredClone(proposal);};
 const host=new TrustedActiveAuthorityPlanning({coordinator,planner,store,backendKeyId:'backend',backendPrivateKeyPem:privatePem});
 return {host,retire:()=>{phase='revoked';},calls:()=>calls};
}
test('active bridge calls permission-only Planner once and reloads authenticated checkpoint',async()=>disk(async(_dir,s)=>{
 const f=active(s);const saved=await f.host.proposeAndPersist();
 assert.equal(saved.verified_source_reads,1);assert.equal(f.calls(),1);
 await assert.rejects(f.host.proposeAndPersist(),/already attempted/);
}));
test('retired preliminary authority cannot invoke Planner or persist',async()=>disk(async(dir,s)=>{
 const f=active(s);f.retire();await assert.rejects(f.host.proposeAndPersist(),/retired/);
 assert.equal(f.calls(),0);assert.deepEqual(await readdir(dir),[]);
}));
test('authority retired during model call cannot sign or persist late proposal',async()=>disk(async(dir,s)=>{
 let retire=()=>{};const f=active(s,()=>retire());retire=f.retire;
 await assert.rejects(f.host.proposeAndPersist(),/retired/);
 assert.deepEqual(await readdir(dir),[]);
}));
