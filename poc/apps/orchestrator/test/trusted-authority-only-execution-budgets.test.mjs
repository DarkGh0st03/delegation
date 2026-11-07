import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveTrustedAuthorityOnlyExecutionBudgets as resolve}
 from '../src/trusted-authority-only-execution-budgets.mjs';
test('R384.5 default preserves existing owner limits',()=>{
 assert.deepEqual(resolve({childCount:16}),{maxDecisions:16,maxVerifiedFailures:2});
 assert.equal(Object.isFrozen(resolve({childCount:1})),true);
});
test('R384.5 trusted owner may select 24 decisions and 4 verified FAILs',()=>{
 assert.deepEqual(resolve({childCount:24,ownerBudget:{maxDecisions:24,maxVerifiedFailures:4}}),
  {maxDecisions:24,maxVerifiedFailures:4});
 assert.deepEqual(resolve({childCount:16,ownerBudget:{maxDecisions:8,maxVerifiedFailures:3}}),
  {maxDecisions:8,maxVerifiedFailures:3});
 assert.deepEqual(resolve({childCount:1,ownerBudget:{maxDecisions:1,maxVerifiedFailures:0}}),
  {maxDecisions:1,maxVerifiedFailures:0});
});
test('R384.5 owner budget rejects overrun, injection and malformed settings',()=>{
 const invalid=[
  {childCount:0},{childCount:25},{childCount:1.5},
  {childCount:1,ownerBudget:{maxDecisions:2,maxVerifiedFailures:1}},
  {childCount:16,ownerBudget:{maxDecisions:17,maxVerifiedFailures:2}},
  {childCount:24,ownerBudget:{maxDecisions:25,maxVerifiedFailures:2}},
  {childCount:24,ownerBudget:{maxDecisions:24,maxVerifiedFailures:5}},
  {childCount:24,ownerBudget:{maxDecisions:24,maxVerifiedFailures:-1}},
  {childCount:24,ownerBudget:{maxDecisions:2,maxVerifiedFailures:3}},
  {childCount:24,ownerBudget:{maxDecisions:'24',maxVerifiedFailures:3}},
  {childCount:24,ownerBudget:{maxDecisions:24,maxVerifiedFailures:2.5}},
  {childCount:24,ownerBudget:{maxDecisions:24,maxVerifiedFailures:2,permission:'create_file'}},
  {childCount:24,ownerBudget:{maxDecisions:24}},
  {childCount:24,ownerBudget:null},{childCount:24,ownerBudget:[]},
 ];
 for(const item of invalid)assert.throws(()=>resolve(item),
  /Protected canonical execution budget denied/);
});
