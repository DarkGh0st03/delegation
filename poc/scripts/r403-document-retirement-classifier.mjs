/**
 * R403 historical milestone-document classifier. READ-ONLY.
 * A missing internal reference is not proof of external irrelevance.
 * Never infer authority to delete source, tests, workflows or documentation.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {gitTrackedFiles} from "./r6-legacy-references.mjs";

const ROOT=fileURLToPath(new URL("../../",import.meta.url));
const MILESTONE=/^docs\/R(?:35\d|36\d|37[0-5])(?:_|\.|-)[A-Za-z0-9_.-]+\.md$/u;
const TEXT=/\.(?:md|txt|json|[cm]?js|jsx|tsx?|rs|toml|ya?ml|sh|html|css|svg|xml|sql|py|c|cpp|h|hpp)$/u;
export const R403_ARCHITECTURE_ANCHORS=Object.freeze([
 "docs/R351_0_ADK_DYNAMIC_TASK_DECISION.md",
 "docs/R355_ADAPTIVE_OWNER_WORK_LOOP.md",
 "docs/R370_CANONICAL_ORIGINAL_REVIEW_HOST_LAUNCHER.md",
 "docs/R375_ORIGINAL_PROTECTED_MAIN_FUNCTIONAL_PASS_AND_DRAFT_PR.md"
]);
export const R403_PROTECTED_DOCUMENTS=Object.freeze([
 ...R403_ARCHITECTURE_ANCHORS,
 "README.md","docs/ACTIVE_AUTHORITY_ONLY_ROADMAP.md",
 "docs/ARCHITECTURE_DECISIONS.md","docs/IMPLEMENTATION_STATE.md",
 "docs/REPRODUCIBILITY.md","docs/human-approved-gitea-merge.md",
 "docs/R401_PLANNER_CARD_AND_PROJECT_TEST_PROFILES.md",
 "docs/R402_REACHABILITY_COVERAGE_INVENTORY.md"
]);
function isHistorical(path){return MILESTONE.test(path);}
function classifySource(source,candidateSet){
 if(candidateSet.has(source))return "historical-batch-peer";
 if(source.startsWith(".github/workflows/"))return "workflow";
 if(/\.(?:rs|[cm]?js|tsx?|jsx|py|sh)$/u.test(source))
  return "source-or-test";
 if(source.endsWith(".md"))return "documentation";
 return "configuration-or-asset";
}
/** Injected byte provider makes every classification independently testable. */
export function classifyR403({tracked,read,requireProtected=false}){
 if(!Array.isArray(tracked)||typeof read!=="function")
  throw Error("R403 requires tracked manifest and read-only file provider");
 const unique=[...new Set(tracked)].sort(),present=new Set(unique);
 const candidatePaths=unique.filter(isHistorical),candidateSet=new Set(candidatePaths);
 const omitted=unique.filter(path=>!TEXT.test(path));
 const unreadable=[],refs=new Map(candidatePaths.map(x=>[x,[]]));
 const terms=new Map(candidatePaths.map(path=>{
  const leaf=path.split("/").at(-1),stem=leaf.slice(0,-3);
  return [path,[path.toLowerCase(),leaf.toLowerCase(),stem.toLowerCase()]];
 }));
 for(const source of unique.filter(path=>TEXT.test(path))){
  let bytes;
  try{bytes=read(source);}
  catch{unreadable.push(source);continue}
  if(typeof bytes!=="string"){unreadable.push(source);continue}
  const lowered=bytes.toLowerCase();
  for(const [candidate,tokens] of terms){
   if(candidate===source)continue;
   if(tokens.some(token=>lowered.includes(token)))
    refs.get(candidate).push({source,kind:classifySource(source,candidateSet)});
  }
 }
 const records=candidatePaths.map(path=>{
  const incoming=refs.get(path).sort((a,b)=>a.source.localeCompare(b.source));
  const outside=incoming.filter(x=>x.kind!=="historical-batch-peer");
  // The whitelist is a REVIEW shortlist only: no path gets deletion approval.
  const classification=R403_ARCHITECTURE_ANCHORS.includes(path)?
   "KEEP_ARCHITECTURE_EVIDENCE":outside.length?"BLOCKED_EXTERNAL_TRACKED_REFERENCE":
   incoming.length?"REVIEW_HISTORICAL_INTERLINK":"UNREFERENCED_INTERNAL_REVIEW";
  return {
   path,classification,
   incoming,externalReferences:outside.length,internalPeerReferences:incoming.length-outside.length,
   originalContentPreservedInGitHistory:true,externalConsumersVerified:false,
   deletionAuthorized:false
  };
 });
 const protectedMissing=R403_PROTECTED_DOCUMENTS.filter(path=>!present.has(path));
 const summary={
  tracked:unique.length,historicalMilestoneDocs:records.length,
  unreferencedReview:records.filter(x=>x.classification==="UNREFERENCED_INTERNAL_REVIEW").length,
  historicalInterlinked:records.filter(x=>x.classification==="REVIEW_HISTORICAL_INTERLINK").length,
  retainedArchitectureAnchors:records.filter(x=>x.classification==="KEEP_ARCHITECTURE_EVIDENCE").length,
  blockedReferenced:records.filter(x=>x.classification==="BLOCKED_EXTERNAL_TRACKED_REFERENCE").length,
  omittedNonText:omitted.length,unreadableTextFiles:unreadable.length,
  missingProtectedDocuments:protectedMissing
 };
 if(requireProtected&&(protectedMissing.length||unreadable.length))
  throw Error("R403 source provenance incomplete: missing protected docs or unreadable tracked text");
 return {
  schema:"r403-historical-doc-classification-v1",
  methodology:"Case-insensitive tracked-text path/basename/stem references. Read-only and conservative; not a link parser, runtime graph or external-user inventory",
  summary,records,protectedDocuments:R403_PROTECTED_DOCUMENTS,
  skippedNonText:omitted,unreadable,
  sourceDeletionAuthorized:false,documentationDeletionAuthorized:false,
  externallyPublishedLinksVerified:false,paidInferenceCalls:0
 };
}
export function inspectR403(root=ROOT){
 return classifyR403({tracked:gitTrackedFiles(root),
  read:path=>readFileSync(resolve(root,path),"utf8"),requireProtected:true});
}
function main(){
 const report=inspectR403();
 const index=process.argv.indexOf("--out");
 if(index>=0){
  if(!process.argv[index+1])throw Error("R403 --out requires file path");
  writeFileSync(resolve(process.argv[index+1]),JSON.stringify(report,null,2)+"\n");
 }
 console.log(JSON.stringify({event:"R403_HISTORICAL_DOC_CLASSIFICATION",...report.summary,
  candidatePreview:report.records.filter(x=>x.classification==="UNREFERENCED_INTERNAL_REVIEW")
   .slice(0,60).map(x=>x.path),
  deletion_authorized:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main();
