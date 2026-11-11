/** Owner-only live Planning -> signed permission-only checkpoint.
 * Uses the preliminary read coordinator/session and bound port, never legacy
 * operational signed-DAG activation. No uploaded proposal is accepted. */
import {isDeepStrictEqual} from 'node:util';
import {TrustedAdkReadOnlyPlanner} from './trusted-adk-planner.ts';
import {TrustedExecutionCoordinator} from './trusted-execution-coordinator.ts';
import {TrustedAuthorityOnlyEngineerSession} from './trusted-authority-only-engineer-session.ts';
import {TrustedPlanningGatewayReadPort} from './trusted-planning-gateway-port.ts';
import {AuthorityPlanningCheckpointStore,signAuthorityPlanningCheckpoint}
 from './trusted-authority-planning-checkpoint.ts';

export class TrustedActiveAuthorityPlanning {
 readonly #planner:TrustedAdkReadOnlyPlanner;
 readonly #coordinator:TrustedExecutionCoordinator|TrustedAuthorityOnlyEngineerSession;
 readonly #port:TrustedPlanningGatewayReadPort;
 readonly #store:AuthorityPlanningCheckpointStore;
 readonly #keyId:string;readonly #key:string;
 readonly #snapshot:TrustedAdkReadOnlyPlanner['config']['snapshot'];
 readonly #branch:string;readonly #requirement:string;readonly #ttl:number;
 #attempted=false;
 constructor(opts:{planner:TrustedAdkReadOnlyPlanner;
  coordinator:TrustedExecutionCoordinator|TrustedAuthorityOnlyEngineerSession;store:AuthorityPlanningCheckpointStore;
  backendKeyId:string;backendPrivateKeyPem:string;lifetimeMs?:number}){
  if(!(opts?.planner instanceof TrustedAdkReadOnlyPlanner)||
   (!(opts.coordinator instanceof TrustedExecutionCoordinator)&&
    !(opts.coordinator instanceof TrustedAuthorityOnlyEngineerSession))||
   !(opts.store instanceof AuthorityPlanningCheckpointStore)||
   !(opts.planner.config.readPort instanceof TrustedPlanningGatewayReadPort)||
   opts.planner.config.validateProposedPlan||opts.planner.config.pilotFullDag||
   !Number.isSafeInteger(opts.lifetimeMs??900000)||
   (opts.lifetimeMs??900000)<1000||(opts.lifetimeMs??900000)>3600000)
   throw Error('Active authority Planning requires original trusted dependencies');
  opts.store.assertSigner(opts.backendKeyId,opts.backendPrivateKeyPem);
  opts.store.assertContext(opts.planner.config.snapshot,
   opts.planner.config.workBranch,opts.planner.config.requirement);
  this.#planner=opts.planner;this.#coordinator=opts.coordinator;
  this.#port=opts.planner.config.readPort;this.#store=opts.store;
  this.#keyId=opts.backendKeyId;this.#key=opts.backendPrivateKeyPem;
  this.#snapshot=structuredClone(opts.planner.config.snapshot);
  this.#branch=opts.planner.config.workBranch;
  this.#requirement=opts.planner.config.requirement;this.#ttl=opts.lifetimeMs??900000;
  this.#active();
 }
 #active():void{
  if(this.#coordinator.phase!=='planning'||
   this.#planner.config.readPort!==this.#port||
   !isDeepStrictEqual(this.#planner.config.snapshot,this.#snapshot)||
   this.#planner.config.workBranch!==this.#branch||
   this.#planner.config.requirement!==this.#requirement)
   throw Error('Active authority Planning changed or retired');
  this.#port.assertTrustedPlanningBinding(this.#coordinator,this.#snapshot);
 }
 async proposeAndPersist(){
  if(this.#attempted)throw Error('Active authority Planning already attempted');
  this.#attempted=true;this.#active();
  const result=await this.#planner.proposeAuthority();
  this.#active();
  const now=Date.now();
  const ticket=signAuthorityPlanningCheckpoint({snapshot:this.#snapshot,
   proposal:result,keyId:this.#keyId,privateKeyPem:this.#key,
   issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+this.#ttl).toISOString()});
  await this.#store.persistVerified(ticket);
  this.#active();
  const stored=await this.#store.load();
  this.#active();
  return stored;
 }
}
