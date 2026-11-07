/** R384.6: offline one-way retirement of obsolete potentially-billed paths.
 * No model inference, GitHub dispatch, secret loading or provider I/O. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {startProtectedGeminiOwnerSession}
 from '../src/run-trusted-gemini-owner.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const path=(relative)=>join(repo,relative);

test('R384.6 old Gemini Signed DAG owner API is retired even in historical mode',async()=>{
 const before=process.env.DELEGATION_GATEWAY_ARCHITECTURE;
 try{
  process.env.DELEGATION_GATEWAY_ARCHITECTURE='legacy-signed-dag';
  await assert.rejects(startProtectedGeminiOwnerSession({
   configPath:'/no-such-private-manifest',inputFile:'/no-such-api-key',
   expectedSourceSha:'a'.repeat(40),
   chargeAuthorization:'I AUTHORIZE GEMINI API CHARGES'
  }),/Protected Gemini owner input denied/u);
 }finally{
  if(before===undefined)delete process.env.DELEGATION_GATEWAY_ARCHITECTURE;
  else process.env.DELEGATION_GATEWAY_ARCHITECTURE=before;
 }
});

test('R384.6 executable cannot select paid legacy mode even when requested explicitly',()=>{
 const executable=path('poc/apps/orchestrator/src/run-trusted-gemini-owner.mjs');
 const result=spawnSync(process.execPath,['--experimental-strip-types',executable],{
  env:{PATH:process.env.PATH,
   DELEGATION_GATEWAY_ARCHITECTURE:'legacy-signed-dag',
   DELEGATION_GEMINI_CHARGE_CONFIRMATION:'I AUTHORIZE GEMINI API CHARGES'},
  timeout:12000,encoding:'utf8'
 });
 assert.equal(result.status,1);
 assert.equal(result.stdout,'');
 assert.match(result.stderr,/Gemini owner startup denied/u);
 assert.doesNotMatch(result.stderr,/PRIVATE KEY|Bearer|API key/u);
});

test('R384.6 both historical billed GitHub Actions jobs are unconditionally skipped',()=>{
 const workflow=readFileSync(
  path('.github/workflows/gemini-paid-shared-mcp-final.yml'),'utf8');
 assert.match(workflow,/^name: RETIRED - Historical Gemini Signed DAG Pilot \(Disabled\)$/mu);
 for(const name of ['account-suspension','f1-real-gitea-planning']){
  const offset=workflow.indexOf('  '+name+':\n');
  assert.ok(offset>=0,'historical job must remain visible for migration audit');
  const opening=workflow.slice(offset,offset+300);
  assert.match(opening,/^    if: \$\{\{ false \}\}$/mu,
   'historical job must never reach a potentially-billed step');
 }
});

test('R384.6 canonical production entrypoints never import historical reviewed DAG',()=>{
 for(const file of [
  'poc/apps/orchestrator/src/canonical-owner-deployment.mjs',
  'poc/apps/orchestrator/src/trusted-authority-only-review-host.mjs',
  'poc/packages/orchestrator-runtime/src/trusted-authority-only-adaptive-work-loop.mjs'
 ]){
  const body=readFileSync(path(file),'utf8');
  assert.doesNotMatch(body,/(?:import|from)\s*['"][^'"]*(?:trusted-reviewed-approved-dag|trusted-repair-dag-controller)/u);
 }
});
