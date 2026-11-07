/** Bounded, source-derived Planning discovery. Neither a credential nor a
 * permission issuer. The original Engineer explicitly selects roots before
 * the provisional Root is signed; only pinned Gitea directory results may
 * extend this private ledger. Model output never registers a path. */
import type {TrustedPlanningSnapshot} from "./trusted-engineer-authority.ts";

const SEG=/^[A-Za-z0-9_@.-]+$/u;
const MAX_PATHS=4096;
const MAX_PER_LIST=200;
function canonicalPath(value:unknown,allowRoot=false):value is string {
  if(typeof value!=="string"||value.length>240||
     (!allowRoot&&value.length===0)||value.startsWith("/")||
     value.endsWith("/")||value.includes("\\")||
     value.split("/").some(part=>part===""?(allowRoot&&value===""):
       !SEG.test(part)||part==="."||part===".."||part.includes("..")||
       part.includes("%")))return false;
  return true;
}
function directChild(parent:string,path:string):boolean {
  if(!canonicalPath(path))return false;
  const prefix=parent===""?"":parent+"/";
  if(!path.startsWith(prefix))return false;
  const suffix=path.slice(prefix.length);
  return suffix.length>0&&!suffix.includes("/");
}
function isInsideRoot(path:string,root:string):boolean {
  return root===""||path===root||path.startsWith(root+"/");
}
export function validateDynamicPlanningRoots(snapshot:TrustedPlanningSnapshot):readonly string[] {
  const value=snapshot.dynamic_discovery_roots;
  if(value===undefined)return Object.freeze([]);
  if(snapshot.hierarchical_preliminary_read!==true||
     !Array.isArray(value)||value.length<1||value.length>8||
     new Set(value).size!==value.length||
     value.some(root=>!canonicalPath(root,true)||
       !snapshot.directories.includes(root)))
    throw Error("Invalid trusted Planning dynamic discovery roots");
  return Object.freeze([...value]);
}

export class TrustedPlanningDiscoveryLedger {
  readonly #roots:readonly string[];
  #files:Set<string>;
  #directories:Set<string>;
  constructor(snapshot:TrustedPlanningSnapshot){
    this.#roots=validateDynamicPlanningRoots(snapshot);
    this.#files=new Set(snapshot.files);
    this.#directories=new Set(snapshot.directories);
  }
  get enabled(){return this.#roots.length>0;}
  hasFile(path:string){return this.#files.has(path);}
  hasDirectory(path:string){return this.#directories.has(path);}
  files(){return [...this.#files];}
  directories(){return [...this.#directories];}

  /** Apply an entire returned batch only after validation; no partial
   * trust if the provider returns a malformed/misnested/oversized listing. */
  observeListings(listings:readonly {path:string;entries:unknown}[]):void {
    const nextFiles=new Set(this.#files),nextDirs=new Set(this.#directories);
    for(const listing of listings){
      if(!canonicalPath(listing.path,true)||!nextDirs.has(listing.path)||
         !Array.isArray(listing.entries)||listing.entries.length>MAX_PER_LIST)
        throw Error("Untrusted Planning directory listing");
      const seen=new Set<string>();
      for(const raw of listing.entries){
        if(!raw||typeof raw!=="object"||Array.isArray(raw))
          throw Error("Malformed Planning discovery entry");
        const entry=raw as Record<string,unknown>;
        if((entry.type!=="file"&&entry.type!=="dir")||
           !directChild(listing.path,entry.path as string)||
           seen.has(entry.path as string))
          throw Error("Out-of-scope Planning discovery entry");
        seen.add(entry.path as string);
        // A verified list outside selected dynamic roots is still useful
        // context, but MUST NOT expand the model's authorized file set.
        if(!this.#roots.some(root=>isInsideRoot(listing.path,root)))continue;
        if(entry.type==="file")nextFiles.add(entry.path as string);
        else nextDirs.add(entry.path as string);
      }
    }
    if(nextFiles.size>MAX_PATHS||nextDirs.size>MAX_PATHS)
      throw Error("Planning dynamic discovery budget exceeded");
    this.#files=nextFiles;
    this.#directories=nextDirs;
  }
}
