import test from 'node:test';
import assert from 'node:assert/strict';
import {InMemoryRequestStore} from '../src/prepare.ts';
import {TrustedAuthorityOnlyGatewayAdmissions as Admissions} from '../src/trusted-authority-only-admissions.ts';
import {TrustedAuthorityOnlyGiteaMutationPreflight as Mutation} from '../src/trusted-authority-only-mutation-preflight.ts';
import {TrustedAuthorityOnlyRunnerPreflight as Runner} from '../src/trusted-authority-only-runner-preflight.ts';
import {TrustedAuthorityOnlyEffectStager as Stager} from '../src/trusted-authority-only-effect-stager.ts';

// Isolated ordering tests: native credential/provider checks belong to the
// real preflights and R315 E2E. These doubles do not attest authorization.
function fixture(tool:'update_file'|'run_tests'='update_file') {
 const calls:string[]=[];
 const store=new InMemoryRequestStore();
 const record:any={request_id:'request',task_id:'task',request:{tool},
  expires_at_ms:Date.now()+60_000,consumed:false};
 store.put(record);
 const admissions=Object.assign(Object.create(Admissions.prototype),{
  async stageTrustedTaskFlight(actual:unknown){assert.equal(actual,record);calls.push('flight');}
 });
 const mutation=Object.assign(Object.create(Mutation.prototype),{
  isForAdmissions:(a:unknown)=>a===admissions,
  async stageUpdate(actual:unknown,head:string){
   assert.equal(actual,record);assert.equal(head,'a'.repeat(40));
   calls.push('mutation');return {provider_write_authorized:false};
  }
 });
 const runner=Object.assign(Object.create(Runner.prototype),{
  isForAdmissions:(a:unknown)=>a===admissions,
  async stageRunner(actual:unknown,head:string){
   assert.equal(actual,record);assert.equal(head,'a'.repeat(40));
   calls.push('runner');return {runner_execution_authorized:false};
  }
 });
 const opts={store,admissions,mutation,runner,runtimeTaskId:'task',tool,expectedHeadSha:'a'.repeat(40)};
 return {calls,record,opts,stager:new Stager(opts)};
}
for(const tool of ['update_file','run_tests'] as const) {
 test(`stages exact ${tool} record before flight and refuses replay`,async()=>{
  const f=fixture(tool);await f.stager.stage('request');
  assert.deepEqual(f.calls,[tool==='update_file'?'mutation':'runner','flight']);
  await assert.rejects(f.stager.stage('request'),/already attempted/);
  assert.equal(f.calls.length,2);
 });
}
for(const patch of [{task_id:'foreign'},{request:{tool:'read_file'}},
 {expires_at_ms:0},{expires_at_ms:NaN},{consumed:true}]) {
 test(`rejects mismatched or unusable record ${JSON.stringify(patch)}`,async()=>{
  const f=fixture();Object.assign(f.record,patch);
  await assert.rejects(f.stager.stage('request'),/pins or expired/);
  assert.deepEqual(f.calls,[]);
 });
}
test('unknown request cannot reserve an intent',async()=>{
 const f=fixture();await assert.rejects(f.stager.stage('missing'),/pins or expired/);
 assert.deepEqual(f.calls,[]);
});
test('ambiguous reservation failure is terminal and never stages flight',async()=>{
 const f=fixture();f.opts.mutation.stageUpdate=async()=>{f.calls.push('attempt');throw Error('uncertain');};
 await assert.rejects(f.stager.stage('request'),/uncertain/);
 await assert.rejects(f.stager.stage('request'),/already attempted/);
 assert.deepEqual(f.calls,['attempt']);
});
test('concurrent call is rejected while reservation awaits',async()=>{
 const f=fixture();let release!:()=>void;
 f.opts.mutation.stageUpdate=()=>new Promise<void>(resolve=>{release=resolve;});
 const first=f.stager.stage('request');
 await assert.rejects(f.stager.stage('request'),/already attempted/);
 release();await first;assert.deepEqual(f.calls,['flight']);
});
test('stager read-only Task identity proof is bound to original Gateway/Task/operation',()=>{
 const f=fixture();
 assert.equal(f.stager.isForOwnerTask(f.opts.admissions,'task','update_file'),true);
 assert.equal(f.stager.isForOwnerTask(f.opts.admissions,'dispatch_foreign','update_file'),false);
 assert.equal(f.stager.isForOwnerTask(f.opts.admissions,'task','run_tests'),false);
 assert.equal(f.stager.isForOwnerTask(Object.create(Admissions.prototype),'task','update_file'),false);
});
test('owner mismatch and unpinned HEAD fail during construction',()=>{
 const f=fixture();
 assert.throws(()=>new Stager({...f.opts,expectedHeadSha:'main'}),/trusted owner/);
 assert.throws(()=>new Stager({...f.opts,admissions:Object.create(Admissions.prototype)}),/trusted owner/);
});
