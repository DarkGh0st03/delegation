import test from "node:test";
import assert from "node:assert/strict";
import {isActionableRepairFailure as eligible} from "../src/repair-failure-eligibility.ts";

test("Only classified non-timeout acceptance checks or real TS codes are repair diagnostics",()=>{
 const summary={failed_checks:["ui_pending_actions"],timed_out:false,unclassified_failure:false};
 assert.equal(eligible("researcher_acceptance",[],summary),true);
 assert.equal(eligible("typecheck",["TS2820"],undefined),true);
 for(const [phase,codes,acceptance] of [
  ["dependency_install",[],summary],["researcher_acceptance",["TS2820"],summary],
  ["researcher_acceptance",[],{...summary,timed_out:true}],
  ["researcher_acceptance",[],{...summary,unclassified_failure:true}],
  ["researcher_acceptance",[],{...summary,failed_checks:[]}],
  ["researcher_acceptance",[],{...summary,failed_checks:["invented"]}],
  ["researcher_acceptance",[],undefined],["typecheck",[],undefined],
  ["typecheck",["TS2820;PRIVATE"],undefined]
 ])assert.equal(eligible(phase,codes,acceptance),false);
});
