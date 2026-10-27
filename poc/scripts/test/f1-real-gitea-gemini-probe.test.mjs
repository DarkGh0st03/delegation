import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {URL as NodeURL} from "node:url";
import {CONSENT} from "../run-gemini-planner-fixture.mjs";
import {assertF1RealGeminiOperatorConsent,runF1RealGiteaGeminiResearch}
  from "../f1-real-gitea-gemini-probe.mjs";

const SHA="405748b1e77992b6bd8630a3ab6f990658d32f6b";
const required={
  flag:"--execute",consent:CONSENT,apiKey:"test-not-a-real-gemini-key",
  modelName:"gemini-3.8-flash",
  outputDir:"/tmp/new-private-F1-result",
  githubActions:undefined
};
test("F1 real Gemini requires independently supplied paid consent, model, key and new private path",()=>{
  assert.equal(assertF1RealGeminiOperatorConsent(required).modelName,
    "gemini-3.8-flash");
  for(const mutation of [
    {flag:"--dry-run"},{consent:"yes"},
    {apiKey:""},{modelName:"model-chosen-by-LLM"},
    {outputDir:"relative/results"},{githubActions:"true"}
  ]){
    assert.throws(()=>assertF1RealGeminiOperatorConsent({
      ...required,...mutation
    }),/refused/);
  }
});
test("F1 execution cannot reach Gitea or Gemini without consent",async()=>{
  let invoked=0;
  const base={flag:"--execute",baseUrl:"http://127.0.0.1:38511",
    readToken:"read-only-local-fixture-token",expectedMainSha:SHA,
    apiKey:"test-not-a-real-gemini-key",
    modelName:"gemini-3.8-flash",
    outputDir:"/tmp/a-fresh-f1-research",
    consent:"not approved",
    githubActions:undefined,
    fetchFn:async()=>{invoked++;throw Error("MUST NOT CONTACT");}
  };
  await assert.rejects(runF1RealGiteaGeminiResearch(base),/refused/);
  assert.equal(invoked,0);
  await assert.rejects(runF1RealGiteaGeminiResearch({
    ...base,consent:CONSENT,githubActions:"true"
  }),/refused/);
  assert.equal(invoked,0);
});
test("F1 --dry-run requires an existing genuine Gitea rather than silently replacing real source with a golden fixture",async()=>{
  let called=0;
  await assert.rejects(runF1RealGiteaGeminiResearch({
    flag:"--dry-run",baseUrl:"http://127.0.0.1:38511",
    readToken:"read-only-local-fixture-token",expectedMainSha:SHA,
    sessionId:"not-relevant",githubActions:"true",
    fetchFn:async(url,opts)=>{
      called++;
      const parsed=new NodeURL(url);
      assert.equal(opts.method,"GET");
      assert.ok(parsed.pathname.startsWith("/api/v1/repos/thesis/iam-console-poc"));
      return {ok:false,status:503,text:async()=>"{}"};
    }
  }));
  assert.equal(called,1);
});
test("F1 CLI never reaches Gemini on CI or exposes supplied secrets in errors",()=>{
  const path=new NodeURL("../f1-real-gitea-gemini-probe.mjs",import.meta.url);
  const child=spawnSync(process.execPath,[
    "--experimental-strip-types",path.pathname,"--execute"
  ],{encoding:"utf8",timeout:15000,env:{
    PATH:process.env.PATH??"",
    GITHUB_ACTIONS:"true",
    GEMINI_API_KEY:"must-not-leak-test-key",
    DELEGATION_F1_GITEA_URL:"http://127.0.0.1:38511",
    DELEGATION_F1_GITEA_READ_TOKEN:"must-not-leak-test-token",
    DELEGATION_F1_EXPECTED_SOURCE_SHA:SHA,
    DELEGATION_F1_BILLING_CONSENT:CONSENT,
    DELEGATION_F1_GEMINI_MODEL:"gemini-3.8-flash"
  }});
  assert.equal(child.status,1);
  assert.equal(child.stdout,"");
  assert.match(child.stderr,/F1 real Gemini Planning preflight\/probe NO-GO/);
  assert.doesNotMatch(child.stderr,/must-not-leak/);
});
