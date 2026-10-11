import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SPECIALIZED_AGENT_PROFILES } from "../packages/agent-runtime/src/specialized-agents.ts";

// Read-only audit of model outputs. Runs AFTER A2A task execution and before
// temporary Gitea is removed. It never controls agents or modifies Gitea.
const ROLES = ["backend","frontend","test"];
const BRANCH = "feature/account-suspension";
const SHA = /^[a-f0-9]{40}$/u;
const MAX_BYTES = 512*1024;
const writable = [...new Set(ROLES.flatMap(r=>SPECIALIZED_AGENT_PROFILES[r].writable_paths))];
const created = [...new Set(ROLES.flatMap(r=>SPECIALIZED_AGENT_PROFILES[r].creatable_paths))];
const allPaths = [...writable,...created];
const createdSet = new Set(created);
const shaBlob = b=>createHash("sha1").update("blob "+b.length+"\0").update(b).digest("hex");
function noSecrets(bytes,secrets) {
  const contents=bytes.toString("utf8");
  for(const secret of secrets) if(typeof secret==="string"&&secret.length>=12&&contents.includes(secret))
    throw new Error("Source contains private runtime credential");
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{24,}|AIza[0-9A-Za-z_-]{32,}/u.test(contents))
    throw new Error("Source contains a credential-shaped value");
}
export async function captureMultiAgentEvidence({
  baseUrl,owner,repository,readToken,outputDir,expectedBaselineSha,
  mode="unspecified",runId=null,secrets=[],fetchFn=fetch
}) {
  if(!baseUrl||!owner||!repository||!readToken||!outputDir||!SHA.test(expectedBaselineSha))
    throw new Error("Invalid multi-agent evidence inputs");
  const root=resolve(outputDir);
  if(root==="/"||root===resolve("."))throw new Error("Unsafe output root");
  await mkdir(root,{recursive:true,mode:0o700});
  const manifest={
    schema_version:1,kind:"multi_agent_a2a_gitea_evidence",mode,github_run_id:runId,
    baseline_sha:expectedBaselineSha,main_sha:null,feature_sha:null,
    branch:BRANCH, capture_status:"unavailable",
    inspected_paths:allPaths,created_paths:[],changed_paths:[],files:[],
    role_changes:{backend:[],frontend:[],test:[]}
  };
  const repoApi=baseUrl.replace(/\/+$/u,"")+"/api/v1/repos/"+
    encodeURIComponent(owner)+"/"+encodeURIComponent(repository);
  const get=async url=>{
    const res=await fetchFn(repoApi+url,{
      method:"GET",headers:{authorization:"token "+readToken,accept:"application/json"}
    });
    if(!res.ok)throw new Error("Gitea audit fetch unavailable");
    return res.json();
  };
  const getFile=async(path,sha)=>{
    const v=await get("/contents/"+path.split("/").map(encodeURIComponent).join("/")+
      "?ref="+encodeURIComponent(sha));
    if(v.type!=="file"||v.encoding!=="base64"||typeof v.content!=="string"||!SHA.test(v.sha))
      throw new Error("Invalid Gitea blob metadata");
    const encoded=v.content.replace(/\s/gu,"");
    if(!/^[a-zA-Z0-9+/]*={0,2}$/u.test(encoded))throw new Error("Malformed blob");
    const bytes=Buffer.from(encoded,"base64");
    if(bytes.length>MAX_BYTES||shaBlob(bytes)!==v.sha)throw new Error("Gitea blob mismatch");
    return {bytes,sha:v.sha};
  };
  try {
    const main=await get("/branches/main");
    if(main.commit?.id!==expectedBaselineSha){
      manifest.capture_status="baseline_mismatch";return manifest;
    }
    manifest.main_sha=main.commit.id;
    const feature=await get("/branches/"+encodeURIComponent(BRANCH));
    const head=feature.commit?.id;
    if(!SHA.test(head)||head===expectedBaselineSha){
      manifest.capture_status="missing_feature_revision";return manifest;
    }
    manifest.feature_sha=head;
    const patches=[];
    for(const path of allPaths) {
      try {
        const isNew=createdSet.has(path);
        const original=isNew?null:await getFile(path,expectedBaselineSha);
        const generated=await getFile(path,head);
        noSecrets(generated.bytes,[readToken,...secrets]);
        const generatedRelative=join("generated",path);
        await mkdir(dirname(join(root,generatedRelative)),{recursive:true});
        await writeFile(join(root,generatedRelative),generated.bytes,{mode:0o600});
        if(original) {
          const beforeRelative=join("baseline",path);
          await mkdir(dirname(join(root,beforeRelative)),{recursive:true});
          await writeFile(join(root,beforeRelative),original.bytes,{mode:0o600});
        }
        const changed=isNew||!original.bytes.equals(generated.bytes);
        manifest.files.push({
          path,created:isNew,changed,
          baseline_blob_sha:original?.sha??null,
          generated_blob_sha:generated.sha,bytes:generated.bytes.length
        });
        if(isNew)manifest.created_paths.push(path);
        if(changed)manifest.changed_paths.push(path);
        const role=ROLES.find(r=>
          SPECIALIZED_AGENT_PROFILES[r].writable_paths.includes(path)||
          SPECIALIZED_AGENT_PROFILES[r].creatable_paths.includes(path));
        if(changed && role)manifest.role_changes[role].push(path);
        if(changed) {
          const before=isNew?"/dev/null":join("baseline",path);
          const diff=spawnSync("git",["diff","--no-index","--",before,generatedRelative],{
            cwd:root,encoding:"utf8",maxBuffer:3*1024*1024
          });
          if(diff.error||diff.status!==1)throw new Error("Cannot create Git patch");
          patches.push(diff.stdout
            .split("a/baseline/"+path).join("a/"+path)
            .split("b/generated/"+path).join("b/"+path));
        }
      }catch {
        manifest.files.push({path,status:"file_capture_unavailable"});
      }
    }
    await writeFile(join(root,"changes.patch"),patches.join("\n"),{mode:0o600});
    // The Backend has four required outputs; other roles must independently
    // change source/tests. The new e2e test file is an explicit Test deliverable.
    const backendExpected=SPECIALIZED_AGENT_PROFILES.backend.writable_paths;
    const adequate=backendExpected.every(p=>manifest.role_changes.backend.includes(p)) &&
      manifest.role_changes.frontend.length>=2 &&
      manifest.role_changes.test.length>=1 &&
      created.every(p=>manifest.created_paths.includes(p));
    manifest.capture_status=manifest.files.length===allPaths.length &&
      manifest.files.every(f=>f.status===undefined)&&adequate?"complete":"partial";
  }catch {
    manifest.capture_status="unavailable";
  }finally {
    await writeFile(join(root,"manifest.json"),JSON.stringify(manifest,null,2)+"\n",{mode:0o600});
    await writeFile(join(root,"README.txt"),
      "Temporary Gitea evidence for the complete Backend -> Frontend -> Test workflow.\n"+
      "generated/: exact content at pinned feature commit SHA.\n"+
      "baseline/: original existing files at pinned main SHA.\n"+
      "changes.patch: unified diff, including newly created E2E test.\n"+
      "manifest.json: immutable commit and Git blob SHA evidence, plus role-specific changes.\n"+
      "Mode and agent IDs in workflow-result.json distinguish scripted from live roles.\n"+
      "Artifact capture is read-only and does not authorize or execute code changes.\n",
      {mode:0o600});
  }
  return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const m=await captureMultiAgentEvidence({
    baseUrl:process.env.GITEA_RUNNER_BASE_URL,
    owner:process.env.GITEA_OWNER,repository:process.env.GITEA_REPOSITORY,
    readToken:process.env.GITEA_RUNNER_TOKEN,
    outputDir:process.env.MULTI_AGENT_EVIDENCE_DIR||"/tmp/multi-agent-evidence",
    expectedBaselineSha:process.env.EXPECTED_GITEA_REVISION,
    mode:process.env.PHASE10B_REAL_GEMINI_ROLES||"scripted_regression",
    runId:process.env.GITHUB_RUN_ID||null,
    secrets:[process.env.GEMINI_API_KEY,process.env.OPENAI_API_KEY,
      process.env.GITEA_GATEWAY_TOKEN,process.env.ADAPTER_CALLER_FRONTEND,
      process.env.ADAPTER_CALLER_TEST,process.env.ADAPTER_CALLER_BACKEND]
  });
  console.log(JSON.stringify({event:"multi_agent_evidence_capture",status:m.capture_status,
    changes:Object.fromEntries(Object.entries(m.role_changes).map(([k,v])=>[k,v.length])),
    main_sha:m.main_sha,feature_sha:m.feature_sha}));
  if(m.capture_status!=="complete")process.exitCode=1;
}