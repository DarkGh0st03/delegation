/**
 * Experimental private-host composition ONLY: restore the ORIGINAL Backend
 * checkpoint signer required by the ORIGINAL authority-only Review Host.
 *
 * The trusted manifest pins the backend public Ed25519 identity and the
 * original AuthorityPlanningCheckpointStore. The same private key already
 * provisioned by the operator is verified before being installed in the
 * original checkpoint input. Never generate a signer or forge a checkpoint.
 *
 * No model inference, Engineer approval, Root/Child issuance, Gateway I/O,
 * A2A start, Git provider request or paid action occurs in this module.
 */
import {createPrivateKey,createPublicKey,timingSafeEqual} from "node:crypto";
import {dirname,isAbsolute,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {readProtectedCanonicalOwnerFile}
 from "./trusted-authority-only-owner-bootstrap.mjs";

const SOURCE_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../../../..");
const deny=()=>{throw Error("Disposable original backend checkpoint signer NO-GO");};
function protectedPath(path){
 return typeof path==="string"&&isAbsolute(path)&&resolve(path)===path&&
  path!==SOURCE_ROOT&&!path.startsWith(SOURCE_ROOT+sep);
}

/**
 * This is called ONLY after a separately verified, one-use GitHub OIDC/HMAC
 * receipt and active-job corroboration. It must not accept an alternative
 * checkpoint store or public-key pin from a workflow or model.
 */
export async function bindOriginalBackendCheckpointSigner({
 authority,loaded,backendPrivateKeyFile,forbiddenFiles=[]
}={}){
 if(!authority||typeof authority!=="object"||
    !authority.checkpoint||typeof authority.checkpoint!=="object"||
    Object.hasOwn(authority.checkpoint,"backendPrivateKeyPem")||
    typeof authority.checkpoint.backendKeyId!=="string"||
    !authority.checkpoint.backendKeyId.trim()||
    typeof authority.checkpoint.store?.assertSigner!=="function"||
    typeof loaded?.backendPublicKeyPem!=="string"||
    !protectedPath(backendPrivateKeyFile)||
    !Array.isArray(forbiddenFiles)||
    forbiddenFiles.some(path=>typeof path!=="string"||
      path===backendPrivateKeyFile))
  deny();
 let privateKeyPem;
 try{
  // Existing 0600 owner file reader rejects nonowner files, untrusted
  // directories, symlink/hardlink replacements and unbounded content.
  privateKeyPem=await readProtectedCanonicalOwnerFile(
   backendPrivateKeyFile,8192);
  const privateKey=createPrivateKey(privateKeyPem);
  const actual=createPublicKey(privateKey);
  const expected=createPublicKey(loaded.backendPublicKeyPem);
  if(privateKey.asymmetricKeyType!=="ed25519"||
     expected.asymmetricKeyType!=="ed25519"||
     actual.asymmetricKeyType!=="ed25519")deny();
  const a=actual.export({format:"der",type:"spki"});
  const b=expected.export({format:"der",type:"spki"});
  if(a.length!==b.length||!timingSafeEqual(a,b))deny();
  // Do not trust the manifest public key alone: require the ORIGINAL
  // typed checkpoint store to recognize the same existing signer.
  authority.checkpoint.store.assertSigner(
   authority.checkpoint.backendKeyId,privateKeyPem);
 }catch{deny();}
 // Never replace the already-constructed trusted store or Key ID. The
 // original Review Host independently calls store.assertSigner() again
 // when it opens the Planning session.
 return Object.freeze({...authority,checkpoint:Object.freeze({
  ...authority.checkpoint,backendPrivateKeyPem:privateKeyPem
 })});
}
