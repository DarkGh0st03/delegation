import test from 'node:test';
import assert from 'node:assert/strict';
import {GatewayControlledToolClient} from '../src/gateway-tool-client.ts';
function client(fail=false, executeBody:unknown={request_id:'req',decision:'allow',execution:{ok:true}}){
 const calls:string[]=[];
 const gateway=new GatewayControlledToolClient({gatewayBaseUrl:'http://gateway.local',
  agentRole:'backend',taskId:'task',evidenceHandler:{} as any,
  trustedEffectStager:{async stage(id){assert.equal(id,'req');calls.push('stage');
   if(fail)throw Error('private-provider-secret');}},
  cryptoPresentation:{async createSignedPresentation(){calls.push('vp');return 'signed';}},
  fetchFn:async(url)=>{
   if(String(url).endsWith('/prepare')){calls.push('prepare');return Response.json({
    request_id:'req',audience:'gateway',challenge:'nonce',expires_at:'2099-01-01T00:00:00Z',
    required_permission:{resource:'file',operation:'update_file'}},{status:201});}
   calls.push('execute');return Response.json(executeBody);
  }});
 return {gateway,calls};
}
test('private staging completes before VP and execute',async()=>{
 const f=client();await f.gateway.invoke('update_file',{});
 assert.deepEqual(f.calls,['prepare','stage','vp','execute']);
});
test('staging failure stops VP and execute and hides owner error',async()=>{
 const f=client(true);
 await assert.rejects(f.gateway.invoke('update_file',{}),e=>{
  assert.equal((e as Error).message,'Trusted effect staging failed');return true;
 });
 assert.deepEqual(f.calls,['prepare','stage']);
});

test('read_file uses Gateway VP without reserving a mutation intent',async()=>{
 const f=client();
 await f.gateway.invoke('read_file',{branch:'feature/account-suspension',path:'README.md'});
 assert.deepEqual(f.calls,['prepare','vp','execute']);
});
test('run_tests reserves owner intent before VP and execute',async()=>{
 const f=client();
 await f.gateway.invoke('run_tests',{branch:'feature/account-suspension',profile:'poc-default'});
 assert.deepEqual(f.calls,['prepare','stage','vp','execute']);
});
test('create_file in authority-only mode is denied without legacy fallback',async()=>{
 const f=client();
 await assert.rejects(f.gateway.invoke('create_file',{
  branch:'feature/account-suspension',path:'new.ts',content:'x'
 }),error=>{
  assert.equal((error as Error).message,
   'Authority-only create_file has no trusted owner effect executor');
  return true;
 });
 assert.deepEqual(f.calls,[]);
});

test('owner-staged client rejects an HTTP 200 tied to a different or absent request',async()=>{
 for(const response of [
  {request_id:'other',decision:'allow',execution:{ok:true}},
  {decision:'allow',execution:{ok:true}},
  {request_id:'req',decision:'deny',execution:{ok:true}},
  {request_id:'req',execution:{ok:true}}
 ]){
  const f=client(false,response);
  await assert.rejects(f.gateway.invoke('update_file',{}),e=>{
   assert.equal((e as Error).message,
    'Authority-only Gateway execute response lacks exact request decision');
   assert.equal((e as {reason?:string}).reason,'gateway_execute_unclassified');
   return true;
  });
  assert.deepEqual(f.calls,['prepare','stage','vp','execute']);
 }
});
