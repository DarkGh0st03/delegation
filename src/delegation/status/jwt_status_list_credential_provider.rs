use crate::delegation::status::status_list_credential_provider::{
    StatusListCredentialArtifact, StatusListCredentialProvider, StatusListCredentialProviderRef,
};
use crate::delegation::trust::public_material_provider::VerificationKeyProviderRef;
use josekit::jwk::Jwk;
use josekit::jws::{EdDSA, JwsHeader};
use josekit::jwt::{self, JwtPayload};
use serde_json::Value;

/// Signs a Status List Credential JSON object as an EdDSA compact JWT.
///
/// The compact JWT bytes are what the PoC anchors in `IssuerRegistry`. The
/// decoded payload remains a W3C Bitstring Status List Credential document.
pub fn sign_status_list_credential_jwt(
    document_json: &str,
    private_key: &Jwk,
) -> Result<String, String> {
    let value: Value = serde_json::from_str(document_json)
        .map_err(|err| format!("Could not parse Status List Credential JSON [{err}]"))?;
    let map = value
        .as_object()
        .cloned()
        .ok_or_else(|| String::from("Status List Credential must be a JSON object"))?;

    let payload =
        JwtPayload::from_map(map).map_err(|err| format!("Could not build JWT payload [{err}]"))?;
    let mut header = JwsHeader::new();
    header.set_algorithm("EdDSA");
    header.set_token_type("vc+jwt");

    let signer = EdDSA
        .signer_from_jwk(private_key)
        .map_err(|err| format!("Could not create Status List EdDSA signer [{err}]"))?;

    jwt::encode_with_signer(&payload, &header, &signer)
        .map_err(|err| format!("Could not sign Status List Credential JWT [{err}]"))
}

/// Authenticates a fetched compact Status List JWT against the current Ed25519
/// assertion key resolved for the expected issuer DID.
pub struct JwtAuthenticatedStatusListCredentialProvider {
    source: StatusListCredentialProviderRef,
    verification_keys: VerificationKeyProviderRef,
}

impl JwtAuthenticatedStatusListCredentialProvider {
    pub fn new(
        source: StatusListCredentialProviderRef,
        verification_keys: VerificationKeyProviderRef,
    ) -> Self {
        Self {
            source,
            verification_keys,
        }
    }

    fn issuer_from_claims(claims: &serde_json::Map<String, Value>) -> Option<String> {
        match claims.get("issuer") {
            Some(Value::String(issuer)) => Some(issuer.clone()),
            Some(Value::Object(object)) => object
                .get("id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            _ => None,
        }
    }
}

impl StatusListCredentialProvider for JwtAuthenticatedStatusListCredentialProvider {
    fn get_status_list_credential(&self, _url: &str) -> Result<String, String> {
        Err(String::from(
            "JWT-authenticated Status List retrieval requires the expected issuer",
        ))
    }

    fn get_status_list_credential_for_issuer(
        &self,
        issuer_id: &str,
        url: &str,
    ) -> Result<StatusListCredentialArtifact, String> {
        let compact_jwt = self.source.get_status_list_credential(url)?;
        let verification_key = self.verification_keys.get_verification_key(issuer_id)?;
        let verifier = EdDSA
            .verifier_from_jwk(&verification_key)
            .map_err(|err| format!("Could not create Status List EdDSA verifier [{err}]"))?;

        let (payload, _) = jwt::decode_with_verifier(&compact_jwt, &verifier).map_err(|err| {
            format!(
                "Status List Credential JWT signature verification failed for issuer {issuer_id} [{err}]"
            )
        })?;

        let claims = payload.claims_set().clone();
        let embedded_issuer = Self::issuer_from_claims(&claims).ok_or_else(|| {
            String::from("Authenticated Status List Credential has no issuer claim")
        })?;

        if embedded_issuer != issuer_id {
            return Err(format!(
                "Authenticated Status List issuer {embedded_issuer} does not match expected issuer {issuer_id}"
            ));
        }

        let document = serde_json::to_string(&Value::Object(claims))
            .map_err(|err| format!("Could not serialize authenticated Status List payload [{err}]"))?;

        Ok(StatusListCredentialArtifact {
            document,
            commitment_bytes: compact_jwt.into_bytes(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delegation::status::in_memory_status_list_credential_provider::InMemoryStatusListCredentialProvider;
    use crate::delegation::trust::public_material_provider::InMemoryVerificationKeyProvider;
    use base64::Engine;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use ed25519_dalek::SigningKey;
    use std::rc::Rc;

    const ISSUER: &str = "did:ethr:0x7a69:0x0000000000000000000000000000000000000001";
    const URL: &str = "https://status.example/lists/1";

    fn keys(seed: u8) -> Result<(Jwk, Jwk), String> {
        let signing = SigningKey::from_bytes(&[seed; 32]);
        let x = URL_SAFE_NO_PAD.encode(signing.verifying_key().to_bytes());
        let d = URL_SAFE_NO_PAD.encode(signing.to_bytes());

        let mut private = Jwk::new("OKP");
        private
            .set_parameter("crv", Some(Value::String(String::from("Ed25519"))))
            .map_err(|err| err.to_string())?;
        private
            .set_parameter("x", Some(Value::String(x.clone())))
            .map_err(|err| err.to_string())?;
        private
            .set_parameter("d", Some(Value::String(d)))
            .map_err(|err| err.to_string())?;

        let mut public = Jwk::new("OKP");
        public
            .set_parameter("crv", Some(Value::String(String::from("Ed25519"))))
            .map_err(|err| err.to_string())?;
        public
            .set_parameter("x", Some(Value::String(x)))
            .map_err(|err| err.to_string())?;

        Ok((private, public))
    }

    fn document() -> String {
        serde_json::json!({
            "@context": ["https://www.w3.org/ns/credentials/v2"],
            "id": URL,
            "type": ["VerifiableCredential", "BitstringStatusListCredential"],
            "issuer": ISSUER,
            "validFrom": "2026-01-01T00:00:00Z",
            "credentialSubject": {
                "id": format!("{URL}#list"),
                "type": "BitstringStatusList",
                "statusPurpose": "revocation",
                "encodedList": "uH4sIAAAAAAAA_-3BMQEAAADCoPVPbQwfoAAAAAAAAAAAAAAAAAAAAAAAfg0wAAAB"
            }
        })
        .to_string()
    }

    #[test]
    fn authenticates_status_list_jwt_and_preserves_envelope_for_commitment() -> Result<(), String> {
        let (private, public) = keys(7)?;
        let token = sign_status_list_credential_jwt(&document(), &private)?;

        let source = Rc::new(InMemoryStatusListCredentialProvider::new());
        source.insert(String::from(URL), token.clone());

        let keys = Rc::new(InMemoryVerificationKeyProvider::new());
        keys.insert(String::from(ISSUER), public)?;

        let provider = JwtAuthenticatedStatusListCredentialProvider::new(source, keys);
        let artifact = provider.get_status_list_credential_for_issuer(ISSUER, URL)?;

        assert_eq!(artifact.commitment_bytes, token.as_bytes());
        let value: Value =
            serde_json::from_str(&artifact.document).map_err(|err| err.to_string())?;
        assert_eq!(value["issuer"], ISSUER);
        Ok(())
    }

    #[test]
    fn rejects_status_list_jwt_signed_by_wrong_key() -> Result<(), String> {
        let (private, _) = keys(7)?;
        let (_, wrong_public) = keys(9)?;
        let token = sign_status_list_credential_jwt(&document(), &private)?;

        let source = Rc::new(InMemoryStatusListCredentialProvider::new());
        source.insert(String::from(URL), token);

        let keys = Rc::new(InMemoryVerificationKeyProvider::new());
        keys.insert(String::from(ISSUER), wrong_public)?;

        let provider = JwtAuthenticatedStatusListCredentialProvider::new(source, keys);
        assert!(
            provider
                .get_status_list_credential_for_issuer(ISSUER, URL)
                .is_err()
        );
        Ok(())
    }
}
