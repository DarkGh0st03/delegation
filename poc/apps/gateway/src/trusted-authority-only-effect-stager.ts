/** Owner-private prepare-to-execute bridge. Never expose this object as an
 * HTTP/MCP tool: Task, operation and HEAD are pinned by the trusted owner. */
import {InMemoryRequestStore} from './prepare.ts';
import {TrustedAuthorityOnlyGatewayAdmissions} from './trusted-authority-only-admissions.ts';
import {TrustedAuthorityOnlyGiteaMutationPreflight} from './trusted-authority-only-mutation-preflight.ts';
import {TrustedAuthorityOnlyRunnerPreflight} from './trusted-authority-only-runner-preflight.ts';

export class TrustedAuthorityOnlyEffectStager {
 readonly #store:InMemoryRequestStore;
 readonly #gate:TrustedAuthorityOnlyGatewayAdmissions;
 readonly #mutation:TrustedAuthorityOnlyGiteaMutationPreflight;
 readonly #runner:TrustedAuthorityOnlyRunnerPreflight;
 readonly #task:string;
 readonly #tool:'read_file'|'update_file'|'run_tests';
 readonly #head:string;
 #attempted=false;
 constructor(opts:{store:InMemoryRequestStore;
  admissions:TrustedAuthorityOnlyGatewayAdmissions;
  mutation:TrustedAuthorityOnlyGiteaMutationPreflight;
  runner:TrustedAuthorityOnlyRunnerPreflight;
  runtimeTaskId:string;tool:'read_file'|'update_file'|'run_tests';expectedHeadSha:string}) {
  if(!(opts?.store instanceof InMemoryRequestStore)||
   !(opts.admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
   !(opts.mutation instanceof TrustedAuthorityOnlyGiteaMutationPreflight)||
   !(opts.runner instanceof TrustedAuthorityOnlyRunnerPreflight)||
   !opts.mutation.isForAdmissions(opts.admissions)||
   !opts.runner.isForAdmissions(opts.admissions)||
   typeof opts.runtimeTaskId!=='string'||!opts.runtimeTaskId||
   !['read_file','update_file','run_tests'].includes(opts.tool)||
   !/^[a-f0-9]{40}$/.test(opts.expectedHeadSha))
   throw Error('Effect staging requires matching trusted owner and exact HEAD');
  this.#store=opts.store;this.#gate=opts.admissions;
  this.#mutation=opts.mutation;this.#runner=opts.runner;
  this.#task=opts.runtimeTaskId;this.#tool=opts.tool;this.#head=opts.expectedHeadSha;
 }
 /** Exact same native Gateway and original owner-pinned Task/effect.
   * A foreign session's stager must never be accepted by an A2A Owner. */
 isForOwnerTask(admissions:TrustedAuthorityOnlyGatewayAdmissions,
  runtimeTaskId:string,tool:'read_file'|'update_file'|'run_tests'):boolean{
  return this.#gate===admissions&&this.#task===runtimeTaskId&&
    this.#tool===tool;
 }
 async stage(requestId:string) {
  if(this.#attempted)throw Error('Effect staging already attempted');
  const record=this.#store.get(requestId);
  if(!record||record.task_id!==this.#task||record.request.tool!==this.#tool||
   record.consumed||!Number.isFinite(record.expires_at_ms)||
   record.expires_at_ms<=Date.now())
   throw Error('Effect staging request differs from owner pins or expired');
  // Consume before asynchronous durable reservations; ambiguous outcomes
  // cannot be retried through this instance. Journals protect reconstruction.
  this.#attempted=true;
  if(this.#tool==='read_file'){
   // A read-only Task has no mutation intent, but must still reserve
   // exactly one durable flight before native VP/OPA/provider execution.
   if(record.pinned_revision!==this.#head)
    throw Error('Read flight differs from owner-pinned Gitea HEAD');
   return this.#gate.stageTrustedTaskFlight(record);
  }
  const reserved=this.#tool==='update_file'
   ?await this.#mutation.stageUpdate(record,this.#head)
   :await this.#runner.stageRunner(record,this.#head);
  await this.#gate.stageTrustedTaskFlight(record);
  return reserved;
 }
}
