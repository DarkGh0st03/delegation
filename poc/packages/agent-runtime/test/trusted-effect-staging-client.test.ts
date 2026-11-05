import test from 'node:test';
import assert from 'node:assert/strict';
import {GatewayControlledToolClient} from '../src/gateway-tool-client.ts';
function client(fail=false){
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
   calls.push('execute');return Response.json({decision:'allow',execution:{ok:true}});
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
