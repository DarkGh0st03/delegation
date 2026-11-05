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
 readonly #tool:'update_file'|'run_tests';
 readonly #head:string;
 #attempted=false;
 constructor(opts:{store:InMemoryRequestStore;
  admissions:TrustedAuthorityOnlyGatewayAdmissions;
  mutation:TrustedAuthorityOnlyGiteaMutationPreflight;
  runner:TrustedAuthorityOnlyRunnerPreflight;
  runtimeTaskId:string;tool:'update_file'|'run_tests';expectedHeadSha:string}) {
  if(!(opts?.store instanceof InMemoryRequestStore)||
   !(opts.admissions instanceof TrustedAuthorityOnlyGatewayAdmissions)||
   !(opts.mutation instanceof TrustedAuthorityOnlyGiteaMutationPreflight)||
   !(opts.runner instanceof TrustedAuthorityOnlyRunnerPreflight)||
   !opts.mutation.isForAdmissions(opts.admissions)||
   !opts.runner.isForAdmissions(opts.admissions)||
   typeof opts.runtimeTaskId!=='string'||!opts.runtimeTaskId||
   !['update_file','run_tests'].includes(opts.tool)||
   !/^[a-f0-9]{40}$/.test(opts.expectedHeadSha))
   throw Error('Effect staging requires matching trusted owner and exact HEAD');
  this.#store=opts.store;this.#gate=opts.admissions;
  this.#mutation=opts.mutation;this.#runner=opts.runner;
  this.#task=opts.runtimeTaskId;this.#tool=opts.tool;this.#head=opts.expectedHeadSha;
 }
 async stage(requestId:string) {
  if(this.#attempted)throw Error('Effect staging already attempted');
  const record=this.#store.get(requestId);
  if(!record||record.task_id!==this.#task||record.request.tool!==this.#tool||
   record.expires_at_ms<=Date.now())
   throw Error('Effect staging request differs from owner pins or expired');
  // Consume before asynchronous durable reservations; ambiguous outcomes
  // cannot be retried through this instance. Journals protect reconstruction.
  this.#attempted=true;
  const reserved=this.#tool==='update_file'
   ?await this.#mutation.stageUpdate(record,this.#head)
   :await this.#runner.stageRunner(record,this.#head);
  await this.#gate.stageTrustedTaskFlight(record);
  return reserved;
 }
}
