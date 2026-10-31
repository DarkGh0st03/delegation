import test from "node:test";
import assert from "node:assert/strict";
import {BaseLlm} from "@google/adk";
import {selectTrustedD1AgentModelActivation as select}
 from "./trusted-d1-agent-model-activation.mjs";
class Scripted extends BaseLlm {
 constructor(){super({model:"offline-repair-script"});}
 async *generateContentAsync(){throw Error("No model calls allowed");}
 connect(){return Promise.reject(Error("Disabled"));}
}
class Generative extends BaseLlm {
 constructor(){super({model:"generative-provider-test-double"});}
 async *generateContentAsync(){throw Error("No model calls allowed");}
 connect(){return Promise.reject(Error("Disabled"));}
}
test("R151.11 offline owner selects a one-use script without inference",()=>{
 const mode=select({role:"backend",taskId:"new-signed-fix-71",
  model:new Scripted(),scriptedModelClass:Scripted});
 assert.deepEqual(mode,{mode:"offline_scripted",role:"backend",
  task_id:"new-signed-fix-71",needs_scripted_arming:true});
 assert.equal(Object.isFrozen(mode),true);
});
test("R151.11 explicit generative binding never calls or arms the model",()=>{
 const model=new Generative();
 const mode=select({role:"test",taskId:"new-signed-test-29",model,
  scriptedModelClass:Scripted,allowGenerative:true});
 assert.deepEqual(mode,{mode:"generative",role:"test",
  task_id:"new-signed-test-29",needs_scripted_arming:false});
});
test("R151.11 disallows models crossing offline/generative boundary",()=>{
 const base={role:"backend",taskId:"signed-repair-71",
  scriptedModelClass:Scripted};
 for(const x of [
  {...base,model:new Generative()},
  {...base,model:new Scripted(),allowGenerative:true},
  {...base,model:{model:"provider",generateContentAsync(){}}},
  {...base,model:new Generative(),allowGenerative:"true"},
  {...base,model:new Generative(),role:"orchestrator",allowGenerative:true},
  {...base,model:new Generative(),taskId:"../traversal",allowGenerative:true},
  {...base,model:new Generative(),taskId:"",allowGenerative:true}
 ]){
  assert.throws(()=>select(x),/R151.11 signed D1 model activation NO-GO/);
 }
});
