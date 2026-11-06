/** Private Engineer review adapter. Uses backend provenance as input and
 * a distinct Engineer key for the selected permission-only decision. */
import {AuthorityPlanningCheckpointStore} from '../../../packages/orchestrator-runtime/src/trusted-authority-planning-checkpoint.ts';
import {selectAuthorityOnlyGrant,authorityOnlyDigest,signAuthorityOnlyGrant,
 verifyAuthorityOnlyGrant} from '../../../packages/plan-contracts/src/authority-only-approval.mjs';
import {RUST_OPERATIONS} from '../../gateway/src/operation-catalog.ts';
const OPS=new Set(RUST_OPERATIONS);
function deny(reason){const e=Error('Authority-only Engineer review: '+reason);e.status=409;throw e;}
export async function createAuthorityOnlyEngineerReview(config){
 if(!(config.authorityCheckpointStore instanceof AuthorityPlanningCheckpointStore)||
  typeof config.planningIsActive!=='function'||
  typeof config.expectedWorkBranch!=='string'||typeof config.expectedRequirement!=='string'||
  config.trustedPlanFile!==undefined||config.planningCheckpointStore!==undefined)
  deny('verified authority checkpoint and live Planning required; legacy inputs forbidden');
 const store=config.authorityCheckpointStore;
 const live=()=>{if(config.planningIsActive()!==true)deny('Planning retired');};
 store.assertContext({session_id:config.expectedSessionId,repository:config.repository,
  base_revision:config.expectedBaseRevision},config.expectedWorkBranch,config.expectedRequirement);
 const digest=p=>authorityOnlyDigest(selectAuthorityOnlyGrant(p,p.requested_permissions,
  {allowedOperations:OPS}),{allowedOperations:OPS});
 live();const initial=(await store.load()).proposal;live();
 const pinnedDigest=digest(initial);
 async function loadVerified(){
  live();const p=(await store.load()).proposal;live();
  if(digest(p)!==pinnedDigest)deny('proposal changed');
  return p;
 }
 return Object.freeze({initial:structuredClone(initial),digest:pinnedDigest,
  permissions:p=>p.requested_permissions.map((row,i)=>({id:'permission-'+(i+1),...row})),
  loadVerified,
  async signSelected(ids,privateKeyPem,now=new Date()){
   const p=await loadVerified();
   if(!Array.isArray(ids))deny('selection outside verified proposal');
   const selected=new Set(ids);
   const rows=p.requested_permissions.map((row,i)=>({id:'permission-'+(i+1),row}));
   if(!ids.length||selected.size!==ids.length||
    ids.some(id=>typeof id!=='string'||!rows.some(row=>row.id===id)))
    deny('selection outside verified proposal');
   const authorization=selectAuthorityOnlyGrant(p,rows.filter(r=>selected.has(r.id)).map(r=>r.row),
    {allowedOperations:OPS});
   live();
   const signed=signAuthorityOnlyGrant({authorization,engineerDid:config.engineerDid,
    keyId:config.keyId,privateKeyPem,issuedAt:now.toISOString(),
    expiresAt:new Date(now.getTime()+30*60*1000).toISOString(),allowedOperations:OPS});
   verifyAuthorityOnlyGrant(signed,{expectedEngineerDid:config.engineerDid,
    allowedOperations:OPS,trustedKeys:{[config.keyId]:{
     engineer_did:config.engineerDid,public_key_pem:config.publicKeyPem}}});
   live();return signed;
  }
 });
}
