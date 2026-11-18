/**
 * Shape of a maximum delegation scope (repository, work branch, base SHA and
 * canonical resource/operation pairs). Used by the authority-only proposal
 * and Engineer grant validators; it grants nothing by itself.
 */

export const ENVELOPE_SCHEMA_VERSION="1.0.0";
const HOST=/^[a-z0-9][a-z0-9.-]*$/u;
const SEG=/^[A-Za-z0-9_@.-]+$/u;
const BRANCH=/^feature\/[a-z0-9][a-z0-9./_-]*$/u;
const OP=/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
function fail(msg){throw Error("Engineer resource envelope: "+msg);}
function exact(obj,fields){
 if(!obj||typeof obj!=="object"||Array.isArray(obj)||
   Object.keys(obj).length!==fields.length||
   fields.some(k=>!Object.hasOwn(obj,k)))fail("invalid fields");
}
function segment(x){return typeof x==="string"&&x.length>0&&x.length<=120&&
 SEG.test(x)&&x!=="."&&x!==".."&&!x.includes("..");}
function uriRoot(r){return "gitea://"+r.authority+"/"+encodeURIComponent(r.owner)+"/"+encodeURIComponent(r.repository);}
function canonicalResource(uri,r,branch){
 if(typeof uri!=="string"||uri.length>1024)return false;
 const root=uriRoot(r),prefix=root+"/branches/"+encodeURIComponent(branch);
 if(uri===root||uri===prefix||uri===prefix+"/directories")return true;
 let relative;
 if(uri.startsWith(prefix+"/files/"))relative=uri.slice((prefix+"/files/").length);
 else if(uri.startsWith(prefix+"/directories/"))relative=uri.slice((prefix+"/directories/").length);
 else return false;
 if(!relative)return false;
 return relative.split("/").every(part=>{
   try{const decoded=decodeURIComponent(part);
     return segment(decoded)&&encodeURIComponent(decoded)===part;
   }catch{return false;}
 });
}
function catalog(ops){if(!(ops instanceof Set)||!ops.size)fail("trusted operation catalog required");}
export function validateAuthorizationEnvelope(envelope,{allowedOperations}={}){
 catalog(allowedOperations);
 exact(envelope,["schema_version","repository","branch","permissions"]);
 if(envelope.schema_version!==ENVELOPE_SCHEMA_VERSION)fail("unsupported schema");
 const r=envelope.repository;
 exact(r,["authority","owner","repository"]);
 if(typeof r.authority!=="string"||r.authority!==r.authority.toLowerCase()||
  !HOST.test(r.authority)||!segment(r.owner)||!segment(r.repository))fail("invalid repository");
 const b=envelope.branch;
 if(typeof b!=="string"||b.length>120||!BRANCH.test(b)||b.includes("..")||
   b.includes("//")||b.endsWith("/")||b.endsWith(".")||
   b.endsWith(".lock")||b.includes("@{"))fail("invalid work branch");
 if(!Array.isArray(envelope.permissions)||envelope.permissions.length<1||
    envelope.permissions.length>256)fail("invalid permission count");
 const seen=new Set();
 for(const row of envelope.permissions){
  exact(row,["resource","operation"]);
  if(!canonicalResource(row.resource,r,b))fail("resource outside repository or branch");
  if(typeof row.operation!=="string"||!OP.test(row.operation)||
     !allowedOperations.has(row.operation))fail("operation not in trusted catalog");
  const key=JSON.stringify([row.resource,row.operation]);
  if(seen.has(key))fail("duplicate pair");seen.add(key);
 }
 return envelope;
}
