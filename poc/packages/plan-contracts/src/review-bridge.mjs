/**
 * Narrow bridge from the UNTRUSTED offline review UI to the interactive
 * Engineer-controlled Ed25519 signing command.
 *
 * Never accept a browser-exported plan as the trusted source. The caller
 * supplies the independently obtained and validated plan; this function
 * permits only a subset of its already proposed permission IDs.
 * It does NOT authenticate a GUI login or create delegation authority.
 */
import {makeApproval,planDigest} from "./plan.mjs";

const REVIEW_FIELDS=[
  "kind","simulated","plan","plan_digest","approved_permission_ids",
  "excluded_permission_ids","changes_from_initial_proposal","notice"
];

function deny(reason){throw new Error("Untrusted review export: "+reason);}
function uniqueIds(value,label){
  if(!Array.isArray(value)||value.some(id=>typeof id!=="string"||!id)||
    new Set(value).size!==value.length)deny(label+" must be unique nonempty IDs");
  return value;
}

/**
 * Prepare a NEW decision using trusted identity and time, never browser fields.
 * The reviewer MUST still explicitly sign the exact digest and ID selection.
 */
export function makeApprovalFromMockReview({
  trustedPlan,review,engineerDid,allowedOperations,decisionId,approvedAt
}){
  if(!review||typeof review!=="object"||Array.isArray(review)||
     Object.keys(review).length!==REVIEW_FIELDS.length||
     REVIEW_FIELDS.some(field=>!Object.hasOwn(review,field))||
     review.kind!=="mock_authorization_review"||review.simulated!==true){
    deny("expected exact, explicitly simulated review envelope");
  }
  if(!Array.isArray(review.changes_from_initial_proposal)||
     review.changes_from_initial_proposal.some(x=>typeof x!=="string")||
     typeof review.notice!=="string"){
    deny("invalid review metadata");
  }
  const digest=planDigest(trustedPlan);
  if(review.plan_digest!==digest||planDigest(review.plan)!==digest){
    deny("review plan or SHA-256 differs from trusted plan; revalidate revisions through trusted backend");
  }
  const approved=uniqueIds(review.approved_permission_ids,"approved_permission_ids");
  const excluded=uniqueIds(review.excluded_permission_ids,"excluded_permission_ids");
  if(approved.length===0)deny("no permission selected");
  const all=trustedPlan.requested_permissions.map(p=>p.id);
  const valid=new Set(all), chosen=new Set(approved), left=new Set(excluded);
  if(approved.some(id=>!valid.has(id))||excluded.some(id=>!valid.has(id))||
     all.some(id=>chosen.has(id)===left.has(id))){
    deny("selected and excluded IDs must partition exactly the trusted plan");
  }
  return makeApproval(trustedPlan,{
    allowedOperations,decision_id:decisionId,approved_by:engineerDid,
    approved_at:approvedAt,approved_permission_ids:[...approved]
  });
}
