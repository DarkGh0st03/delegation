import test from 'node:test';
import assert from 'node:assert/strict';
import {BaseLlm} from '@google/adk';
import {TrustedAuthorityOnlyAdkDecisionProposer}
 from '../src/trusted-authority-only-adk-decision-proposer.mjs';
import {createTrustedProjectTestSourceProfile,IAM_CONSOLE_PROJECT_TEST_PROFILE}
 from '../../plan-contracts/src/gitea-permission-containment.mjs';

class NeverCalledModel extends BaseLlm {
 constructor(){super({model:'r401-offline-only'});}
 async *generateContentAsync(){throw Error('Never call inference in constructor test');}
 connect(){throw Error('Streaming disabled');}
}
const root='gitea://gitea.local/thesis/iam-console-poc/branches/feature%2Faccount-suspension';
const props=()=>({
 model:new NeverCalledModel(),requirement:'Verify one regression',
 branch:'feature/account-suspension',
 rootPermissions:[{resource:root+'/files/tests/backend/one.test.ts',operation:'read_file'}],
 agents:{test:{capabilities:['read_file']}},previousTasks:[],nextEpoch:1,
 decisionKind:'agent'
});
test('R401.1 ADK owner accepts only a provisioned repository test profile',()=>{
 const alt=createTrustedProjectTestSourceProfile({
  roots:['src/__tests__'],suffixes:['.spec.ts']
 });
 assert.doesNotThrow(()=>new TrustedAuthorityOnlyAdkDecisionProposer({
  ...props(),projectTestSourceProfile:alt
 }));
 assert.doesNotThrow(()=>new TrustedAuthorityOnlyAdkDecisionProposer({
  ...props(),projectTestSourceProfile:IAM_CONSOLE_PROJECT_TEST_PROFILE
 }));
 assert.throws(()=>new TrustedAuthorityOnlyAdkDecisionProposer({
  ...props(),projectTestSourceProfile:{
   roots:['src/__tests__'],suffixes:['.spec.ts']
  }
 }),/R351 authority-only model Task choice denied/u);
});
