/** Native Backend bootstrap for one discovery Child. Private ports are
 * host configuration; never expose them through A2A or model tools. */
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {TrustedBackendDiscoveryChildPresenter} from "./trusted-backend-discovery-presenter.ts";
import {TrustedBackendDiscoveryTaskSlot} from "./trusted-backend-discovery-task-slot.ts";
import {createTrustedBackendDiscoveryTaskBindingServer} from "./trusted-backend-discovery-task-binding-ipc.ts";
import {createTrustedBackendDiscoveryVpSignerServer} from "./trusted-backend-discovery-vp-private-ipc.ts";

type SlotConfig=ConstructorParameters<typeof TrustedBackendDiscoveryTaskSlot>[0];
type PresenterConfig=ConstructorParameters<typeof TrustedBackendDiscoveryChildPresenter>[0];
export async function startTrustedBackendDiscoveryHost(config:
 Omit<SlotConfig,"holder"> & Pick<PresenterConfig,
 "adapterBaseUrl"|"backendToken"|"isTaskActive"|"fetchFn"|"timeoutMs">
){
 const holder=new TrustedBackendDiscoveryChildPresenter(config);
 const slot=new TrustedBackendDiscoveryTaskSlot({...config,holder});
 const directory=await mkdtemp(join(tmpdir(),"backend-discovery-"));
 const ownerBinding=Object.freeze({socketPath:join(directory,"owner.sock"),
  secretFile:join(directory,"owner.hex")});
 const gatewaySigner=Object.freeze({socketPath:join(directory,"signer.sock"),
  secretFile:join(directory,"signer.hex")});
 let binding:Awaited<ReturnType<typeof createTrustedBackendDiscoveryTaskBindingServer>>|undefined;
 let signer:Awaited<ReturnType<typeof createTrustedBackendDiscoveryVpSignerServer>>|undefined;
 let closing:Promise<void>|undefined;
 const close=()=>closing??= (async()=>{
  // Fence synchronously before awaiting any socket shutdown.
  slot.retireAll();holder.fence();signer?.fence();
  const results=await Promise.allSettled([binding?.close(),signer?.close()]);
  const failure=results.find(r=>r.status==="rejected");
  // Retain the private directory on shutdown uncertainty for reconciliation.
  if(failure?.status==="rejected")throw failure.reason;
  await rm(directory,{recursive:true,force:true});
 })();
 try{
  await writeFile(ownerBinding.secretFile,randomBytes(32).toString("hex")+"\n",{mode:0o600,flag:"wx"});
  await writeFile(gatewaySigner.secretFile,randomBytes(32).toString("hex")+"\n",{mode:0o600,flag:"wx"});
  binding=await createTrustedBackendDiscoveryTaskBindingServer({...ownerBinding,slot});
  signer=await createTrustedBackendDiscoveryVpSignerServer({...gatewaySigner,
   presenter:holder,childCredentialId:config.childCredentialId,
   resource:config.resource,audience:config.audience,isTaskActive:config.isTaskActive});
  await binding.start();
  await signer.start();
  return Object.freeze({slot,ownerBinding,gatewaySigner,close});
 }catch(error){
  await close();
  throw error;
 }
}
