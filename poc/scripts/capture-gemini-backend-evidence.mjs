import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKEND_LIVE_PROBE_PATHS } from "../packages/agent-runtime/src/adk-backend-live-probe.ts";

// Read-only post-execution audit; never calls a model or changes repository state.
const SHA = /^[0-9a-f]{40}$/u;
const BRANCH = "feature/account-suspension";
const PATHS = [...BACKEND_LIVE_PROBE_PATHS];
const MAX_FILE_BYTES = 512 * 1024;
const blobSha = b => createHash("sha1").update("blob " + b.length + "\0").update(b).digest("hex");
const safeError = e => e?.code === "missing" ? "missing_resource" : "capture_unavailable";
function assertNoCredential(bytes, secrets) {
  const s = bytes.toString("utf8");
  for (const key of secrets) {
    if (typeof key === "string" && key.length >= 12 && s.includes(key)) {
      throw new Error("Generated source contains a private credential");
    }
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{24,}|AIza[0-9A-Za-z_-]{32,}/u.test(s)) {
    throw new Error("Generated source looks like credential material");
  }
}
export async function captureBackendEvidence({
  baseUrl, owner, repository, readToken, outputDir, expectedBaselineSha,
  fetchFn = fetch, runId = null, protectedValues = [], captureMode = null
}) {
  if (!baseUrl || !owner || !repository || !readToken || !outputDir || !SHA.test(expectedBaselineSha)) {
    throw new Error("Missing or malformed read-only evidence configuration");
  }
  const root = resolve(outputDir);
  if (root === "/" || root === resolve(".")) throw new Error("Unsafe evidence directory");
  await mkdir(root, {recursive:true,mode:0o700});
  const manifest = {
    schema_version:1, source:"temporary_gitea_read_only_audit",
    capture_mode:captureMode||"unspecified",
    github_run_id:runId, expected_baseline_sha:expectedBaselineSha,
    main_sha:null, feature_sha:null, feature_branch:BRANCH,
    capture_status:"unavailable", inspected_paths:PATHS,
    changed_paths:[], files:[], semantic_validation:"see_audit-result.json"
  };
  const base = baseUrl.replace(/\/+$/u,"") + "/api/v1/repos/" +
    encodeURIComponent(owner) + "/" + encodeURIComponent(repository);
  async function getJson(suffix) {
    const response = await fetchFn(base + suffix,{
      method:"GET",headers:{authorization:"token "+readToken,accept:"application/json"}
    });
    if (!response.ok) {
      const error = new Error("Read-only Gitea operation failed");
      error.code = response.status === 404 ? "missing" : "unavailable";
      throw error;
    }
    return await response.json();
  }
  async function getContents(path,ref) {
    const endpoint="/contents/"+path.split("/").map(encodeURIComponent).join("/")+
      "?ref="+encodeURIComponent(ref);
    const item=await getJson(endpoint);
    if(item.type!=="file" || item.encoding!=="base64" ||
       typeof item.content!=="string" || !SHA.test(item.sha)) {
      throw new Error("Invalid Gitea file metadata");
    }
    const b64=item.content.replace(/\s/gu,"");
    if(!/^[A-Za-z0-9+/]*={0,2}$/u.test(b64)) throw new Error("Invalid base64 encoding");
    const bytes=Buffer.from(b64,"base64");
    if(bytes.length>MAX_FILE_BYTES || blobSha(bytes)!==item.sha) {
      throw new Error("Gitea blob-integrity or file-size check failed");
    }
    return {bytes,sha:item.sha};
  }
  try {
    const main=await getJson("/branches/main");
    if(main.commit?.id!==expectedBaselineSha) {
      manifest.capture_status="baseline_mismatch";
      return manifest;
    }
    manifest.main_sha=main.commit.id;
    let feature;
    try { feature=await getJson("/branches/"+encodeURIComponent(BRANCH)); }
    catch(error) {
      manifest.capture_status=safeError(error)==="missing_resource"
        ?"feature_branch_missing":"unavailable";
      return manifest;
    }
    if(!SHA.test(feature.commit?.id) || feature.commit.id===manifest.main_sha) {
      manifest.capture_status="no_new_feature_revision";
      return manifest;
    }
    manifest.feature_sha=feature.commit.id;
    const patches=[];
    for(const path of PATHS) {
      try {
        // Fetch immutable revisions so no concurrent branch movement changes evidence.
        const before=await getContents(path,manifest.main_sha);
        const after=await getContents(path,manifest.feature_sha);
        assertNoCredential(after.bytes,[readToken,...protectedValues]);
        const beforePath=join("baseline",path);
        const afterPath=join("generated",path);
        await mkdir(dirname(join(root,beforePath)),{recursive:true});
        await mkdir(dirname(join(root,afterPath)),{recursive:true});
        await writeFile(join(root,beforePath),before.bytes,{mode:0o600});
        await writeFile(join(root,afterPath),after.bytes,{mode:0o600});
        const changed=!before.bytes.equals(after.bytes);
        if(changed)manifest.changed_paths.push(path);
        manifest.files.push({
          path, baseline_blob_sha:before.sha, generated_blob_sha:after.sha,
          generated_bytes:after.bytes.length, changed
        });
        if(changed) {
          const diff=spawnSync("git",["diff","--no-index","--",beforePath,afterPath],{
            cwd:root,encoding:"utf8",maxBuffer:3*1024*1024
          });
          if(diff.status!==1 || diff.error)throw new Error("Cannot generate diff");
          patches.push(diff.stdout.split("a/baseline/"+path).join("a/"+path)
            .split("b/generated/"+path).join("b/"+path));
        }
      } catch(error) {
        manifest.files.push({path,status:safeError(error)});
      }
    }
    await writeFile(join(root,"changes.patch"),patches.join("\n"),{mode:0o600});
    manifest.capture_status=manifest.changed_paths.length===PATHS.length &&
      manifest.files.length===PATHS.length && manifest.files.every(f=>f.changed===true)
      ? "complete":"partial";
  } catch(error) {
    manifest.capture_status=safeError(error);
  } finally {
    await writeFile(join(root,"manifest.json"),JSON.stringify(manifest,null,2)+"\n",{mode:0o600});
    await writeFile(join(root,"README.txt"),
      "Gemini Backend audit snapshot from the temporary Gitea instance.\n"+
      "generated/: model-written files, fetched by pinned feature commit SHA.\n"+
      "baseline/: original files, fetched by pinned main commit SHA.\n"+
      "changes.patch: diff between baseline and generated code.\n"+
      "manifest.json: expected paths, Git blob hashes and verified revisions.\n"+
      "These files alone do NOT establish semantic correctness.\n",
      {mode:0o600});
  }
  return manifest;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const manifest=await captureBackendEvidence({
    baseUrl:process.env.GITEA_RUNNER_BASE_URL,
    owner:process.env.GITEA_OWNER,
    repository:process.env.GITEA_REPOSITORY,
    readToken:process.env.GITEA_RUNNER_TOKEN,
    outputDir:process.env.GEMINI_EVIDENCE_DIR||"/tmp/gemini-backend-evidence",
    expectedBaselineSha:process.env.EXPECTED_GITEA_REVISION,
    runId:process.env.GITHUB_RUN_ID||null,
    captureMode:process.env.GEMINI_EVIDENCE_MODE||null,
    protectedValues:[
      process.env.GEMINI_API_KEY,process.env.OPENAI_API_KEY,
      process.env.GITEA_GATEWAY_TOKEN,process.env.ADAPTER_CALLER_BACKEND
    ]
  });
  console.log(JSON.stringify({
    event:"gemini_backend_evidence_capture",
    status:manifest.capture_status,
    changed_files:manifest.changed_paths.length,
    main_sha:manifest.main_sha,feature_sha:manifest.feature_sha
  }));
  if(manifest.capture_status!=="complete")process.exitCode=1;
}