//! Independently deployed, PUBLIC-ONLY native verifier for the Gateway.
//! No signing/issuance keys and no calls to the Delegation Adapter.
//! The only cryptographic authority is the existing Core Rust verifier.
//!
//! N-API's AsyncTask runs the synchronous Rust/EVM/DID resolvers outside
//! the Node event loop and creates per-call Rc state, so no Rc crosses
//! JavaScript threads or awaits. All errors are fail-closed and redacted.

use ark_bn254::Bn254;
use delegation::delegation::authorization::authorization_context::AuthorizationContext;
use delegation::delegation::local::file_public_artifact_store::FilePublicArtifactStore;
use delegation::delegation::status::evm::status_list_anchor_reader::StatusListAnchorReader;
use delegation::delegation::status::provider::jwt_status_list_provider::JwtAuthenticatedStatusListCredentialProvider;
use delegation::delegation::status::provider::status_list_credential_provider_trait::StatusListCredentialProviderRef;
use delegation::delegation::status::resolver::evm_anchored_status_list_resolver::EvmAnchoredStatusListResolver;
use delegation::delegation::status::resolver::status_list_resolver_trait::StatusListResolverRef;
use delegation::delegation::trust::evm::evm_registry_reader::EvmRegistryReader;
use delegation::delegation::trust::evm::trust_chain_reader::TrustChainReader;
use delegation::delegation::trust::material::accumulator_material_provider::AccumulatorMaterialProviderRef;
use delegation::delegation::trust::material::did_ethr_verification_key_provider::DidEthrVerificationKeyProvider;
use delegation::delegation::trust::material::verification_key_provider::VerificationKeyProviderRef;
use delegation::delegation::trust::resolver::evm_trust_resolver::EvmTrustResolver;
use delegation::delegation::trust::resolver::trust_resolver_trait::TrustResolverRef;
use delegation::delegation::verification::delegation_verifier::DelegationVerifier;
use delegation::delegation::verification::verifier_trait::Verifier;
use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;
use std::env;
use std::path::PathBuf;
use std::rc::Rc;

const MAX_CONTEXT_BYTES: usize = 64 * 1024;
const MAX_VP_BYTES: usize = 2_000_000;

struct Config {
    rpc_url: String,
    chain_id: u64,
    did_registry: String,
    enterprise_trust_registry: String,
    issuer_registry: String,
    artifact_dir: PathBuf,
    did_resolver_script: PathBuf,
}

impl Config {
    fn read() -> std::result::Result<Self, String> {
        let required = |name: &str| -> std::result::Result<String, String> {
            let value = env::var(name).map_err(|_| format!("Missing {name}"))?;
            if value.is_empty() || value.trim() != value {
                return Err(format!("Invalid {name}"));
            }
            Ok(value)
        };
        let rpc_url = required("CORE_RUST_RPC_URL")?;
        if !(rpc_url.starts_with("http://") || rpc_url.starts_with("https://")) {
            return Err(String::from("CORE_RUST_RPC_URL must use HTTP(S)"));
        }
        let chain_id = required("CORE_RUST_CHAIN_ID")?
            .parse::<u64>()
            .map_err(|_| String::from("Invalid CORE_RUST_CHAIN_ID"))?;
        if chain_id == 0 {
            return Err(String::from("CORE_RUST_CHAIN_ID cannot be zero"));
        }
        let did_resolver_script = PathBuf::from(required("CORE_RUST_DID_RESOLVER_SCRIPT")?);
        if !did_resolver_script.is_file() {
            return Err(String::from("Missing trusted DID resolver script"));
        }
        Ok(Self {
            rpc_url,
            chain_id,
            did_registry: required("CORE_RUST_DID_REGISTRY_ADDRESS")?,
            enterprise_trust_registry: required("CORE_RUST_ENTERPRISE_REGISTRY_ADDRESS")?,
            issuer_registry: required("CORE_RUST_ISSUER_REGISTRY_ADDRESS")?,
            artifact_dir: PathBuf::from(required("CORE_RUST_PUBLIC_ARTIFACT_DIR")?),
            did_resolver_script,
        })
    }

    fn open_readers(
        &self,
    ) -> std::result::Result<
        (
            Rc<EvmRegistryReader>,
            Rc<FilePublicArtifactStore<Bn254>>,
            Rc<DidEthrVerificationKeyProvider>,
        ),
        String,
    > {
        // Never auto-create files/directories in the verifier process.
        // The writer mounts a separate operator-provisioned volume.
        let public_artifacts =
            Rc::new(FilePublicArtifactStore::<Bn254>::open_read_only(&self.artifact_dir)?);
        let chain = Rc::new(EvmRegistryReader::connect(
            &self.rpc_url,
            &self.did_registry,
            &self.enterprise_trust_registry,
            &self.issuer_registry,
            self.chain_id,
        )?);
        let did_keys = Rc::new(DidEthrVerificationKeyProvider::new(
            &self.did_resolver_script,
            &self.rpc_url,
            &self.did_registry,
            self.chain_id,
        ));
        Ok((chain, public_artifacts, did_keys))
    }
}

fn verify_real(
    context_json: &str,
    signed_vp: &str,
) -> std::result::Result<String, String> {
    if context_json.is_empty() || context_json.len() > MAX_CONTEXT_BYTES ||
       signed_vp.is_empty() || signed_vp.len() > MAX_VP_BYTES {
        return Err(String::from("Invalid verification input length"));
    }
    let context: AuthorizationContext = serde_json::from_str(context_json)
        .map_err(|_| String::from("Invalid AuthorizationContext JSON"))?;

    let config = Config::read()?;
    let (chain, public_artifacts, did_keys) = config.open_readers()?;

    let trust_chain: Rc<dyn TrustChainReader> = chain.clone();
    let accumulator: AccumulatorMaterialProviderRef<Bn254> = public_artifacts.clone();
    let keys: VerificationKeyProviderRef = did_keys.clone();
    let trust: TrustResolverRef<Bn254> =
        Rc::new(EvmTrustResolver::new(trust_chain, accumulator, keys.clone()));

    let source: StatusListCredentialProviderRef = public_artifacts;
    let authenticated: StatusListCredentialProviderRef =
        Rc::new(JwtAuthenticatedStatusListCredentialProvider::new(source, keys));
    let status_chain: Rc<dyn StatusListAnchorReader> = chain;
    let status: StatusListResolverRef =
        Rc::new(EvmAnchoredStatusListResolver::new(authenticated, status_chain));

    let verifier = DelegationVerifier::<Bn254>::new(trust, status)?;
    let verified = verifier.verify_verifiable_presentation(context, signed_vp.to_owned())?;

    // Return expiration in decimal string form to preserve the u128 value
    // across the JavaScript Number precision boundary.
    let mut output = serde_json::to_value(&verified)
        .map_err(|_| String::from("Cannot serialize VerifiedDelegation"))?;
    output["expiration"] = serde_json::Value::String(verified.expiration().to_string());
    serde_json::to_string(&output)
        .map_err(|_| String::from("Cannot encode VerifiedDelegation"))
}

struct VerifyTask {
    context_json: String,
    signed_vp: String,
}

impl Task for VerifyTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<Self::Output> {
        verify_real(&self.context_json, &self.signed_vp)
            .map_err(|_| Error::new(Status::GenericFailure, "Core Rust verification rejected".to_owned()))
    }

    fn resolve(&mut self, _env: Env, value: Self::Output) -> Result<Self::JsValue> {
        Ok(value)
    }
}

/// Called once at Gateway startup. Fail immediately if independent
/// artifact access or expected chain ID is not available.
#[napi(js_name = "assert_verification_ready")]
pub fn assert_verification_ready() -> Result<()> {
    let cfg = Config::read()
        .map_err(|_| Error::new(Status::GenericFailure, "Core Rust verification config incomplete".to_owned()))?;
    cfg.open_readers()
        .map_err(|_| Error::new(Status::GenericFailure, "Core Rust public sources unavailable".to_owned()))?;
    Ok(())
}

/// The only exposed verifier operation. Executes real Rust Core logic
/// on libuv's worker pool and resolves a Promise<String> in Node.
#[napi(js_name = "verify_verifiable_presentation")]
pub fn verify_verifiable_presentation(
    authorization_context_json: String,
    signed_vp: String,
) -> AsyncTask<VerifyTask> {
    AsyncTask::new(VerifyTask {
        context_json: authorization_context_json,
        signed_vp,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_native_never_treats_random_jwt_or_context_as_verified() {
        assert!(verify_real("{}", "header.payload.signature").is_err());
        assert!(verify_real("", "header.payload.signature").is_err());
        assert!(verify_real(&"a".repeat(MAX_CONTEXT_BYTES + 1), "a.b.c").is_err());
    }
}
