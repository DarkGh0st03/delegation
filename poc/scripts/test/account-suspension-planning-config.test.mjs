import test from 'node:test';
import assert from 'node:assert/strict';
import {accountSuspensionPlanningConfig} from '../account-suspension-planning-config.mjs';
import {SIGNED_GEMINI_PILOT} from '../signed-gemini-pilot-consent.mjs';
test('real planning-only profile is identical to pilot and frozen',()=>{
 const pilot=accountSuspensionPlanningConfig('pilot');
 assert.deepEqual(accountSuspensionPlanningConfig('real-planning-only'),pilot);
 assert.equal(pilot.maxModelTurns,SIGNED_GEMINI_PILOT.maxTurnsPerTask.planner);
 assert.ok(Object.isFrozen(pilot));
 assert.throws(()=>{pilot.maxModelTurns=100;},TypeError);
});
test('legacy fixture keeps its existing consented limits',()=>{
 assert.deepEqual(accountSuspensionPlanningConfig('fixture'),{
  maxModelTurns:20,maxProposalRevisions:2,maxModelCallMs:120000,
  maxPlanningMs:180000,maxOutputTokens:12000,thinkingLevel:'LOW'
 });
 assert.notDeepEqual(accountSuspensionPlanningConfig('fixture'),accountSuspensionPlanningConfig('pilot'));
});
test('unknown experiment modes fail closed',()=>{
 for(const mode of [undefined,null,'','paid','other',{}])
  assert.throws(()=>accountSuspensionPlanningConfig(mode),/Unknown trusted/);
});
