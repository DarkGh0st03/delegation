import test from "node:test";
import assert from "node:assert/strict";
import {trustedEngineerRunStatus}
  from "../src/trusted-engineer-run-status.mjs";

const runId="40198765432";
const live={hostClosed:false,selectedRunId:runId,queriedRunId:runId,
  coordinatorPhase:"execution",handoffStatus:"active",
  verifiedOutcome:"pending"};

test("R5 paid and scripted runner status requires selected run AND fully closed verified native authority",()=>{
  assert.equal(trustedEngineerRunStatus(live),"execution_active");
  assert.equal(trustedEngineerRunStatus({
    ...live,coordinatorPhase:"closed",handoffStatus:"closing"
  }),"execution_active"); // Rust revocation may complete before A2A drain
  assert.equal(trustedEngineerRunStatus({
    ...live,coordinatorPhase:"closed",handoffStatus:"closed",
    verifiedOutcome:"verified_complete"
  }),"completed_verified");
  for(const phase of ["planning","execution","failed_closed",undefined]){
    assert.equal(trustedEngineerRunStatus({
      ...live,coordinatorPhase:phase,handoffStatus:"closed",
      verifiedOutcome:"verified_complete"
    }),"terminated",`unconfirmed root closure: ${phase}`);
  }
  for(const status of ["idle","starting","active","closing","failed"]){
    assert.equal(trustedEngineerRunStatus({
      ...live,coordinatorPhase:"closed",handoffStatus:status,
      verifiedOutcome:"verified_complete"
    }),"terminated",`unconfirmed handoff closure: ${status}`);
  }
  assert.equal(trustedEngineerRunStatus({
    ...live,queriedRunId:"999999999",
    coordinatorPhase:"closed",handoffStatus:"closed",
    verifiedOutcome:"verified_complete"
  }),"terminated");
  assert.equal(trustedEngineerRunStatus({
    ...live,hostClosed:true,coordinatorPhase:"closed",
    handoffStatus:"closed",verifiedOutcome:"verified_complete"
  }),"terminated");
});

test("R5 cold Engineer host and canceled paid or scripted sessions NEVER strand GitHub worker",()=>{
  const pending={...live,selectedRunId:undefined,
    coordinatorPhase:"planning",handoffStatus:"idle"};
  assert.equal(trustedEngineerRunStatus(pending),"waiting_for_owner");
  for(const phase of [undefined,"idle","execution","closed","failed_closed"]){
    assert.equal(trustedEngineerRunStatus({
      ...pending,coordinatorPhase:phase
    }),"terminated",`cold or canceled host phase: ${phase}`);
  }
  for(const lifecycle of [undefined,"starting","active","closing","failed","closed"]){
    assert.equal(trustedEngineerRunStatus({
      ...pending,handoffStatus:lifecycle
    }),"terminated",`pending runner with lifecycle: ${lifecycle}`);
  }
  for(const terminal of ["failed","closed"]){
    assert.equal(trustedEngineerRunStatus({
      ...live,handoffStatus:terminal
    }),"terminated");
  }
  assert.equal(trustedEngineerRunStatus({
    ...live,verifiedOutcome:"failed"
  }),"terminated");
  assert.equal(trustedEngineerRunStatus({
    ...live,selectedRunId:undefined,verifiedOutcome:"verified_complete",
    coordinatorPhase:"closed",handoffStatus:"closed"
  }),"terminated");
  assert.equal(trustedEngineerRunStatus(undefined),"terminated");
  assert.equal(trustedEngineerRunStatus({}),"terminated");
});
