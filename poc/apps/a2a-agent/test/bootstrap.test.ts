import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const executable=fileURLToPath(new URL("../src/main.ts",import.meta.url));
function start(env:Record<string,string>){
  return spawnSync(process.execPath,["--experimental-strip-types",executable],{
    env:{...process.env,
      AGENT_PORT:"43487",AGENT_ROLE:"backend",
      OPENAI_API_KEY:"",GEMINI_API_KEY:"",...env},
    timeout:10000,encoding:"utf8"
  });
}
test("ADK process refuses to start without provider key",()=>{
  const result=start({AGENT_RUNTIME_ENGINE:"adk"});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/OPENAI_API_KEY is required/u);
});
test("ADK process rejects unknown agent engine instead of silently degrading",()=>{
  const result=start({AGENT_RUNTIME_ENGINE:"unsafe-custom"});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/AGENT_RUNTIME_ENGINE must be deterministic or adk/u);
});

test("ADK Gemini server fails closed without its own Gemini API key",()=>{
  const result=start({AGENT_RUNTIME_ENGINE:"adk",ADK_MODEL_PROVIDER:"gemini"});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/GEMINI_API_KEY is required/u);
});
test("ADK refuses unknown provider selections",()=>{
  const result=start({AGENT_RUNTIME_ENGINE:"adk",ADK_MODEL_PROVIDER:"unexpected"});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/ADK_MODEL_PROVIDER must be openai or gemini/u);
});
