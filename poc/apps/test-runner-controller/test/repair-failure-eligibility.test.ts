import test from "node:test";
import assert from "node:assert/strict";
import {isActionableRepairFailure as eligible} from "../src/repair-failure-eligibility.ts";

test("Unclassified failures still cannot authorize repair diagnostics",()=>{
 const summary={failed_checks:["ui_pending_actions"],timed_out:false,unclassified_failure:false};
 assert.equal(eligible("researcher_acceptance",[],summary),true);
 assert.equal(eligible("typecheck",["TS2820"],undefined),true);
 for(const [phase,codes,acceptance] of [
  ["backend_tests",[],summary],["frontend_tests",[],summary],
  ["dependency_install",[],summary],["researcher_acceptance",["TS2820"],summary],
  ["researcher_acceptance",[],{...summary,timed_out:true}],
  ["researcher_acceptance",[],{...summary,unclassified_failure:true}],
  ["researcher_acceptance",[],{...summary,failed_checks:[]}],
  ["researcher_acceptance",[],{...summary,failed_checks:["invented"]}],
  ["researcher_acceptance",[],undefined],["typecheck",[],undefined],
  ["typecheck",["TS2820;PRIVATE"],undefined]
 ])assert.equal(eligible(phase,codes,acceptance),false);
});

 test("Only bounded Backend test metadata enters the newly supported repair phase",()=>{
 const summary={phase:"backend_tests",failed_test_file_count:2};
 assert.equal(eligible("backend_tests",[],undefined,summary),true);
 for(const bad of [undefined,{...summary,failed_test_file_count:0},
  {...summary,failed_test_file_count:9},{...summary,source:"PRIVATE"},
  {...summary,phase:"frontend_tests"}])
   assert.equal(eligible("backend_tests",[],undefined,bad),false);
 assert.equal(eligible("frontend_tests",[],undefined,{...summary,phase:"frontend_tests"}),false);
 assert.equal(eligible("backend_tests",["TS2339"],undefined,summary),false);
 assert.equal(eligible("backend_tests",[],{},summary),false);
 assert.equal(eligible("typecheck",["TS2339"],undefined,summary),false);
 });
