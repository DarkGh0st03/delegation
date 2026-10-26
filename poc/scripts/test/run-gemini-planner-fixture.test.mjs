import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";
import {makeIsolatedPlanningFixture,assertBillableFixtureOptIn,
  FIXTURE_SCENARIOS,CONSENT} from "../run-gemini-planner-fixture.mjs";

const script=resolve(dirname(fileURLToPath(import.meta.url)),
  "../run-gemini-planner-fixture.mjs");

test("a non-billable dry run reports unsolved fixture scope with zero inference",()=>{
  for(const scenario of Object.keys(FIXTURE_SCENARIOS)){
    const text=execFileSync(process.execPath,[script,"--dry-run",scenario],
      {encoding:"utf8",timeout:10000,env:{PATH:process.env.PATH}});
    const report=JSON.parse(text);
    assert.equal(report.status,"no_model_or_network_called");
    assert.equal(report.gemini_inference_calls,0);
    assert.equal(report.can_write,false);
    assert.equal(report.can_approve,false);
    assert.match(report.fingerprint_not_git_sha,/^[a-f0-9]{40}$/);
    assert.ok(report.files>=5);
  }
});

test("read-only isolated fixture delivers bounded Gitea-shaped files and no writes",async()=>{
  for(const scenario of Object.keys(FIXTURE_SCENARIOS)){
    const fixture=makeIsolatedPlanningFixture(scenario);
    assert.equal(fixture.snapshot.repository.repository,"iam-console-poc");
    const metadata=await fixture.readPort.invoke("read_repository",{});
    assert.equal(metadata.revision,fixture.snapshot.base_revision);
    assert.equal(metadata.full_name,"thesis/iam-console-poc");
    const directory=await fixture.readPort.invoke("list_directory",{branch:"main",path:""});
    assert.ok(directory.entries.length>0);
    const target=fixture.snapshot.files[0];
    const source=await fixture.readPort.invoke("read_file",{branch:"main",path:target});
    assert.ok(source.content.length>0);
    assert.equal(source.revision,fixture.snapshot.base_revision);
    await assert.rejects(
      fixture.readPort.invoke("read_file",{branch:"feature/attack",path:target}),
      /outside approved scope/);
    await assert.rejects(
      fixture.readPort.invoke("update_file",{branch:"main",path:target}),
      /outside approved scope/);
    assert.equal(fixture.invokedReads.filter(x=>x.tool==="read_file").length,2);
  }
});

test("no paid execute action without exact operator phrase and fresh evidence location",()=>{
  for(const input of [
    {flag:"--dry-run",consent:CONSENT,apiKey:"dummy",outputDir:"/tmp/fixture-output"},
    {flag:"--execute",consent:"sure",apiKey:"dummy",outputDir:"/tmp/fixture-output"},
    {flag:"--execute",consent:CONSENT,apiKey:"",outputDir:"/tmp/fixture-output"},
    {flag:"--execute",consent:CONSENT,apiKey:"dummy",outputDir:"relative"},
    {flag:"--execute",consent:CONSENT,apiKey:"dummy",outputDir:"/tmp/../secret"}
  ])assert.throws(()=>assertBillableFixtureOptIn(input));
  assert.equal(assertBillableFixtureOptIn({
    flag:"--execute",consent:CONSENT,apiKey:"dummy",
    outputDir:"/tmp/never-created-evidence-dir"
  }),"/tmp/never-created-evidence-dir");
});

test("unknown or satisfied scenario cannot be silently substituted",()=>{
  assert.throws(()=>makeIsolatedPlanningFixture("account-suspension"),/unsupported/);
  assert.throws(()=>makeIsolatedPlanningFixture("__proto__"),/unsupported/);
});
