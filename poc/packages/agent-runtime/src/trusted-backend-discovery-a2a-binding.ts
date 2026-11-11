/**
 * R151.36: private owner-only A2A binding of a discovery Child to one
 * Gateway Task and one canonical Gitea read. It adds no Gateway authority.
 * Models, A2A peers and MCP tools never choose the presenter.
 */
import {canonicalFileUri} from "../../../apps/gateway/src/canonical.ts";
import type {AgentTaskContext} from "./contracts.ts";
import {TrustedBackendDiscoveryCryptoPresentation} from
 "./trusted-backend-discovery-crypto-presentation.ts";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const deny=(s:string):never=>{throw Error("Trusted Backend discovery A2A NO-GO: "+s);};
export interface TrustedBackendDiscoveryA2ABinding {
 readonly planTaskId:string;
 readonly runtimeTaskId:string;
 readonly childCredentialId:string;
 readonly presenterId:string;
 readonly repository:Readonly<{authority:string;owner:string;repository:string}>;
 readonly branch:string;
 readonly path:string;
 readonly resource:string;
 readonly audience:"cloud-access-gateway";
 readonly presentation:TrustedBackendDiscoveryCryptoPresentation;
}
export function validateTrustedBackendDiscoveryA2ABinding(
 b:TrustedBackendDiscoveryA2ABinding
):void{
 if(!b||!ID.test(b.planTaskId)||!ID.test(b.runtimeTaskId)||
    !ID.test(b.childCredentialId)||typeof b.presenterId!=="string"||
    !/^did:[A-Za-z0-9:._-]{6,240}$/u.test(b.presenterId)||
    typeof b.branch!=="string"||
    !/^feature\/[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$/u.test(b.branch)||
    b.branch.includes("..")||b.branch.includes("//")||
    typeof b.path!=="string"||b.path.length>240||
    b.path.startsWith("/")||b.path.includes("\\")||
    b.path.includes("//")||/[\x00-\x1f\x7f]/u.test(b.path)||
    b.path.split("/").some(x=>!x||x==="."||x==="..")||
    typeof b.resource!=="string"||b.resource.length>2048||
    b.audience!=="cloud-access-gateway"||
    !(b.presentation instanceof TrustedBackendDiscoveryCryptoPresentation)||
    !b.presentation.matchesPins({
     childCredentialId:b.childCredentialId,resource:b.resource,audience:b.audience
    }))
  deny("private holder, signed Task and exact read_file scope required");
 let canonical:string;
 try{canonical=canonicalFileUri(b.repository,b.branch,b.path);}
 catch{deny("invalid trusted repository");}
 if(canonical!==b.resource)deny("noncanonical Gitea file resource");
}
export function selectTrustedBackendDiscoveryA2A(
 b:TrustedBackendDiscoveryA2ABinding|undefined,c:AgentTaskContext
):TrustedBackendDiscoveryCryptoPresentation|undefined{
 if(!b)return undefined;
 const related=c.trusted_gateway_task_id===b.runtimeTaskId||
  c.subtask?.subtask_id===b.planTaskId||
  c.delegation_evidence?.credential_id===b.childCredentialId;
 if(!related)return undefined;
 const rows=c.subtask?.approved_file_permissions;
 if(c.role!=="backend"||c.trusted_gateway_task_id!==b.runtimeTaskId||
    c.subtask.subtask_id!==b.planTaskId||
    c.subtask.branch!==b.branch||
    c.delegation_evidence.credential_id!==b.childCredentialId||
    c.delegation_evidence.presenter_id!==b.presenterId||
    c.subtask.approved_run_tests===true||
    !Array.isArray(rows)||rows.length!==1||
    rows[0]?.operation!=="read_file"||rows[0]?.path!==b.path||
    !Array.isArray(c.subtask.relevant_paths)||
    c.subtask.relevant_paths.length!==1||
    c.subtask.relevant_paths[0]!==b.path)
  deny("A2A identity/permissions differ from authorized Backend discovery");
 return b.presentation;
}
