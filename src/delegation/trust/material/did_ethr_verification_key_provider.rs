use crate::delegation::trust::material::public_material_provider_traits::VerificationKeyProvider;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use josekit::jwk::Jwk;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;
use std::path::PathBuf;
use std::process::Command;

/// Resolves Ed25519 assertion keys from a did:ethr DID Document by invoking the
/// official JavaScript `ethr-did-resolver` adapter shipped in `blockchain/did-client`.
///
/// This keeps ERC-1056 event reconstruction out of the Rust verifier while still
/// making the DID registry the source of truth for presentation/status signatures.
pub struct DidEthrVerificationKeyProvider {
    node_executable: String,
    resolver_script: PathBuf,
    rpc_url: String,
    registry_address: String,
    chain_id: u64,
}

impl DidEthrVerificationKeyProvider {
    pub fn new(
        resolver_script: impl Into<PathBuf>,
        rpc_url: impl Into<String>,
        registry_address: impl Into<String>,
        chain_id: u64,
    ) -> Self {
        Self {
            node_executable: String::from("node"),
            resolver_script: resolver_script.into(),
            rpc_url: rpc_url.into(),
            registry_address: registry_address.into(),
            chain_id,
        }
    }

    pub fn with_node_executable(mut self, node_executable: impl Into<String>) -> Self {
        self.node_executable = node_executable.into();
        self
    }

    fn resolve_document(&self, identity_id: &str) -> Result<DidDocument, String> {
        let output = Command::new(&self.node_executable)
            .arg(&self.resolver_script)
            .env("RPC_URL", &self.rpc_url)
            .env("REGISTRY_ADDRESS", &self.registry_address)
            .env("CHAIN_ID", self.chain_id.to_string())
            .env("DID", identity_id)
            .output()
            .map_err(|err| {
                format!(
                    "Could not launch did:ethr resolver {} [{err}]",
                    self.resolver_script.display()
                )
            })?;

        if !output.status.success() {
            return Err(format!(
                "did:ethr resolver failed for {identity_id}: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }

        serde_json::from_slice::<DidDocument>(&output.stdout).map_err(|err| {
            format!(
                "Could not parse DID Document returned for {identity_id} [{err}]. stdout={}",
                String::from_utf8_lossy(&output.stdout).trim()
            )
        })
    }

    fn jwk_from_method(method: &VerificationMethod) -> Result<Jwk, String> {
        if let Some(public_jwk) = &method.public_key_jwk {
            let kty = public_jwk
                .get("kty")
                .and_then(Value::as_str)
                .ok_or_else(|| String::from("DID publicKeyJwk has no kty"))?;
            let crv = public_jwk
                .get("crv")
                .and_then(Value::as_str)
                .ok_or_else(|| String::from("DID publicKeyJwk has no crv"))?;
            let x = public_jwk
                .get("x")
                .and_then(Value::as_str)
                .ok_or_else(|| String::from("DID publicKeyJwk has no x"))?;

            if kty != "OKP" || crv != "Ed25519" {
                return Err(format!(
                    "Unsupported DID verification key type {kty}/{crv}; expected OKP/Ed25519"
                ));
            }

            return build_public_ed25519_jwk(x);
        }

        let multibase_key = method.public_key_multibase.as_ref().ok_or_else(|| {
            String::from(
                "Ed25519 DID verification method has neither publicKeyJwk nor publicKeyMultibase",
            )
        })?;

        let (_, decoded) = multibase::decode(multibase_key).map_err(|err| {
            format!("Could not decode DID publicKeyMultibase {multibase_key} [{err}]")
        })?;

        let raw_key: &[u8] = match decoded.as_slice() {
            // Ed25519 multicodec prefix 0xed 0x01.
            [0xed, 0x01, rest @ ..] if rest.len() == 32 => rest,
            bytes if bytes.len() == 32 => bytes,
            bytes => {
                return Err(format!(
                    "Resolved Ed25519 key has unexpected decoded length {}",
                    bytes.len()
                ));
            }
        };

        build_public_ed25519_jwk(&URL_SAFE_NO_PAD.encode(raw_key))
    }

    fn is_ed25519_method(method: &VerificationMethod) -> bool {
        if method.method_type == "Ed25519VerificationKey2020" {
            return true;
        }

        if method.method_type != "JsonWebKey2020" {
            return false;
        }

        method
            .public_key_jwk
            .as_ref()
            .and_then(Value::as_object)
            .is_some_and(|jwk| {
                jwk.get("kty").and_then(Value::as_str) == Some("OKP")
                    && jwk.get("crv").and_then(Value::as_str) == Some("Ed25519")
            })
    }

    fn select_assertion_key(document: &DidDocument) -> Result<Jwk, String> {
        let mut assertion_ids = HashSet::new();
        let mut candidates = Vec::new();

        for assertion in &document.assertion_method {
            match assertion {
                AssertionMethod::Reference(id) => {
                    assertion_ids.insert(id.clone());
                }
                AssertionMethod::Embedded(method) if Self::is_ed25519_method(method) => {
                    candidates.push(Self::jwk_from_method(method)?);
                }
                AssertionMethod::Embedded(_) => {}
            }
        }

        for method in &document.verification_method {
            if !assertion_ids.contains(&method.id) {
                continue;
            }
            if Self::is_ed25519_method(method) {
                candidates.push(Self::jwk_from_method(method)?);
            }
        }

        match candidates.len() {
            1 => Ok(candidates.remove(0)),
            0 => Err(format!(
                "DID Document {} has no Ed25519 assertionMethod",
                document.id
            )),
            count => Err(format!(
                "DID Document {} has {count} active Ed25519 assertion methods; the PoC profile requires exactly one",
                document.id
            )),
        }
    }
}

impl VerificationKeyProvider for DidEthrVerificationKeyProvider {
    fn get_verification_key(&self, identity_id: &str) -> Result<Jwk, String> {
        // Resolve on every authorization path so ERC-1056 key rotation/revocation
        // takes effect immediately instead of being hidden by a long-lived cache.
        let document = self.resolve_document(identity_id)?;
        if document.id != identity_id {
            return Err(format!(
                "Resolved DID Document id {} does not match requested identity {identity_id}",
                document.id
            ));
        }

        Self::select_assertion_key(&document)
    }
}

fn build_public_ed25519_jwk(x: &str) -> Result<Jwk, String> {
    let mut jwk = Jwk::new("OKP");
    jwk.set_parameter("crv", Some(Value::String(String::from("Ed25519"))))
        .map_err(|err| format!("Could not set Ed25519 JWK crv [{err}]"))?;
    jwk.set_parameter("x", Some(Value::String(x.to_string())))
        .map_err(|err| format!("Could not set Ed25519 JWK x [{err}]"))?;
    Ok(jwk)
}

#[derive(Debug, Deserialize)]
struct DidDocument {
    id: String,
    #[serde(rename = "verificationMethod", default)]
    verification_method: Vec<VerificationMethod>,
    #[serde(rename = "assertionMethod", default)]
    assertion_method: Vec<AssertionMethod>,
}

#[derive(Debug, Deserialize)]
struct VerificationMethod {
    id: String,
    #[serde(rename = "type")]
    method_type: String,
    #[serde(rename = "publicKeyMultibase")]
    public_key_multibase: Option<String>,
    #[serde(rename = "publicKeyJwk")]
    public_key_jwk: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum AssertionMethod {
    Reference(String),
    Embedded(VerificationMethod),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_authorized_ed25519_multibase_key() -> Result<(), String> {
        let raw = [7u8; 32];
        let multibase_key = multibase::encode(multibase::Base::Base58Btc, raw);
        let document: DidDocument = serde_json::from_value(serde_json::json!({
            "id": "did:ethr:0x7a69:0x0000000000000000000000000000000000000001",
            "verificationMethod": [{
                "id": "did:ethr:0x7a69:0x0000000000000000000000000000000000000001#delegate-1",
                "type": "Ed25519VerificationKey2020",
                "controller": "did:ethr:0x7a69:0x0000000000000000000000000000000000000001",
                "publicKeyMultibase": multibase_key
            }],
            "assertionMethod": [
                "did:ethr:0x7a69:0x0000000000000000000000000000000000000001#delegate-1"
            ]
        }))
        .map_err(|err| err.to_string())?;

        let jwk = DidEthrVerificationKeyProvider::select_assertion_key(&document)?;
        let value = serde_json::to_value(jwk).map_err(|err| err.to_string())?;
        assert_eq!(value["kty"], "OKP");
        assert_eq!(value["crv"], "Ed25519");
        assert_eq!(value["x"], URL_SAFE_NO_PAD.encode(raw));
        Ok(())
    }

    #[test]
    fn ignores_ed25519_key_not_authorized_for_assertion() -> Result<(), String> {
        let raw = [9u8; 32];
        let document: DidDocument = serde_json::from_value(serde_json::json!({
            "id": "did:example:1",
            "verificationMethod": [{
                "id": "did:example:1#delegate-1",
                "type": "Ed25519VerificationKey2020",
                "controller": "did:example:1",
                "publicKeyMultibase": multibase::encode(multibase::Base::Base58Btc, raw)
            }],
            "assertionMethod": []
        }))
        .map_err(|err| err.to_string())?;

        assert!(DidEthrVerificationKeyProvider::select_assertion_key(&document).is_err());
        Ok(())
    }
}
