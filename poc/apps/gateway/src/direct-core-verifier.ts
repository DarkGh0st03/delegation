/**
 * Gateway-side adapter for an IN-PROCESS native Rust DelegationVerifier.
 *
 * Important: this is an integration contract, not a cryptographic verifier.
 * Implementations MUST call the actual Core Rust verifier (including trust,
 * accumulator and live status-list resolvers). No TypeScript signature,
 * credential, trust or status verification is implemented here.
 *
 * A native binding cannot safely use the issuance Adapter's private in-memory
 * public-material cache: the future native build must use a shared, verified,
 * read-only public-material/status source, anchored to the real EVM registry.
 */
import {
  VerificationRejectedError,
  VerificationUnavailableError
} from "./errors.ts";
import type {
  AgentRole, MultipleVerificationRequest, Permission,
  VerificationRequest, VerifiedDelegation, VerifierPort
} from "./types.ts";

export type CoreRustIdentityMap = Readonly<Record<AgentRole, string>>;

/** Method signature mirrors Rust Verifier::verify_verifiable_presentation. */
export interface CoreRustBinding {
  verify_verifiable_presentation(
    authorization_context_json: string,
    signed_vp: string
  ): string | Promise<string>;
}

const ROLES: readonly AgentRole[] = [
  "orchestrator","backend","frontend","test"
];

function validIdentity(id:unknown): id is string {
  return typeof id==="string" && id.trim()===id &&
    id.length>4 && id.length<=1024 && id.startsWith("did:");
}
function permission(value:unknown): Permission {
  if (value===null || typeof value!=="object" || Array.isArray(value)) {
    throw new Error("Malformed Rust VerifiedDelegation permission");
  }
  const p=value as Record<string,unknown>;
  if (typeof p.resource!=="string" || !p.resource ||
      typeof p.operation!=="string" || !p.operation) {
    throw new Error("Malformed Rust VerifiedDelegation permission fields");
  }
  return {resource:p.resource,operation:p.operation as Permission["operation"]};
}
function samePermission(a:Permission,b:Permission):boolean {
  return a.resource===b.resource && a.operation===b.operation;
}
function validateRustResult(
  raw:unknown, expectedPresenter:string, required:readonly Permission[]
):VerifiedDelegation {
  const value=typeof raw==="string" ? JSON.parse(raw) as unknown : raw;
  if(value===null || typeof value!=="object" || Array.isArray(value)) {
    throw new Error("Malformed Rust VerifiedDelegation result");
  }
  const v=value as Record<string,unknown>;
  if(v.presenter_id!==expectedPresenter ||
     typeof v.credential_id!=="string" || !v.credential_id ||
     typeof v.issuer_id!=="string" || !v.issuer_id ||
     !Array.isArray(v.permissions) || v.permissions.length===0 ||
     !Number.isSafeInteger(v.hierarchy_depth) || (v.hierarchy_depth as number)<0 ||
     !(typeof v.expiration==="string" || typeof v.expiration==="number")) {
    throw new Error("Invalid native Rust verifier response or presenter mismatch");
  }
  const verified=v.permissions.map(permission);
  if(!required.every(p=>verified.some(actual=>samePermission(actual,p)))) {
    throw new Error("Native Rust verifier response omits an authorized permission");
  }
  return {
    presenter_id:v.presenter_id,
    credential_id:v.credential_id,
    issuer_id:v.issuer_id,
    permissions:verified,
    hierarchy_depth:v.hierarchy_depth as number,
    expiration:v.expiration
  };
}

export class DirectCoreRustVerifier implements VerifierPort {
  readonly #binding: CoreRustBinding;
  readonly #identities:CoreRustIdentityMap;

  constructor(binding:CoreRustBinding, identities:CoreRustIdentityMap) {
    if(!binding || typeof binding.verify_verifiable_presentation!=="function") {
      throw new Error("A loaded native Rust Core verifier binding is required");
    }
    for(const role of ROLES) {
      if(!validIdentity(identities?.[role])) {
        throw new Error("Trusted DID identity missing for Rust Core role: "+role);
      }
    }
    if(new Set(ROLES.map(role=>identities[role])).size!==ROLES.length){
      throw new Error("Rust Core role identities must be distinct");
    }
    this.#binding=binding;
    this.#identities=Object.freeze({...identities});
  }

  async verify(request:VerificationRequest):Promise<VerifiedDelegation> {
    return this.#verify(
      request.presenter,request.audience,request.challenge,
      [request.required_permission],request.signed_vp
    );
  }

  async verifyMultiple(request:MultipleVerificationRequest):Promise<VerifiedDelegation>{
    return this.#verify(
      request.presenter,request.audience,request.challenge,
      request.required_permissions,request.signed_vp
    );
  }

  async #verify(
    role:AgentRole,audience:string,challenge:string,
    required:readonly Permission[],signedVp:string
  ):Promise<VerifiedDelegation>{
    const presenterId=this.#identities[role];
    if(!validIdentity(presenterId) ||
       typeof audience!=="string" || !audience.trim() ||
       typeof challenge!=="string" || !challenge.trim() ||
       !Array.isArray(required) || required.length===0 || required.length>128 ||
       typeof signedVp!=="string" || !signedVp.trim() ||
       signedVp.length>2_000_000 ||
       required.some(p=>p===null || typeof p!=="object" ||
         typeof p.resource!=="string" || !p.resource ||
         typeof p.operation!=="string" || !p.operation) ||
       new Set(required.map(p=>JSON.stringify([p.resource,p.operation]))).size!==required.length) {
      throw new VerificationRejectedError("Invalid Rust Core authorization context");
    }
    // This exact shape is deserialized by Core Rust AuthorizationContext:
    // singleton remains wire-compatible, composite uses its plural field.
    const context={
      presenter_id:presenterId,audience,challenge,
      ...(required.length===1
        ? {required_permission:required[0]}
        : {required_permissions:required})
    };
    let nativeResult:unknown;
    try {
      nativeResult=await this.#binding.verify_verifiable_presentation(
        JSON.stringify(context),signedVp
      );
    }catch{
      // A native error is not evidence of a successful verification. Do not
      // leak internal resolver, key, RPC or signed-VP information to callers.
      throw new VerificationRejectedError("Rust Core rejected the signed VP or trust context");
    }
    try {
      return validateRustResult(nativeResult,presenterId,required);
    }catch{
      throw new VerificationUnavailableError(
        "Native Rust Core returned an inconsistent verification result"
      );
    }
  }
}
