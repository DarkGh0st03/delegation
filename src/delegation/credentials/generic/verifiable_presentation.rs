use crate::delegation::credentials::generic::credential_trait::Credential;
use crate::delegation::credentials::generic::verifiable_credential::VerifiableCredential;
use josekit::jwk::Jwk;
use josekit::jws::{EdDSA, JwsHeader};
use josekit::jwt;
use josekit::jwt::JwtPayload;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt::Display;

/// W3C VC Data Model 2.0 presentation envelope for one or more VCs.
/// The thesis authorization profile intentionally presents exactly ONE derived VC;
/// issuance/verification reject ambiguous multi-credential submissions.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerifiablePresentation<C: Credential> {
    #[serde(rename = "@context")]
    context: Vec<String>,
    #[serde(rename = "type")]
    presentation_type: Vec<String>,
    #[serde(rename = "holder")]
    holder: String,
    // Private thesis request-binding profile, not W3C core properties.
    #[serde(rename = "audience")]
    audience: String,
    #[serde(rename = "challenge")]
    challenge: String,
    #[serde(rename = "verifiableCredential")]
    verifiable_credentials: Vec<VerifiableCredential<C>>,
}

impl<C: Credential> VerifiablePresentation<C> {
    /// Wraps a real VC (rather than placing its credentialSubject directly in a VP).
    pub fn new(
        context: Vec<String>,
        holder: String,
        audience: String,
        challenge: String,
        credential: VerifiableCredential<C>,
    ) -> Self {
        Self {
            context,
            presentation_type: vec![String::from("VerifiablePresentation")],
            holder,
            audience,
            challenge,
            verifiable_credentials: vec![credential],
        }
    }

    pub fn holder(&self) -> &String {
        &self.holder
    }

    pub fn audience(&self) -> &String {
        &self.audience
    }

    pub fn challenge(&self) -> &String {
        &self.challenge
    }

    /// Fail closed on a malformed or ambiguous W3C presentation envelope.
    /// The current authorization profile uses exactly one Delegation Credential.
    pub fn verifiable_credential(&self) -> Result<&VerifiableCredential<C>, String> {
        const BASE_CONTEXT: &str = "https://www.w3.org/ns/credentials/v2";
        if self.context.first().map(String::as_str) != Some(BASE_CONTEXT)
            || !self
                .presentation_type
                .iter()
                .any(|kind| kind == "VerifiablePresentation")
        {
            return Err(String::from(
                "Invalid W3C Verifiable Presentation context/type",
            ));
        }
        if self.verifiable_credentials.len() != 1 {
            return Err(String::from(
                "Expected exactly one presented Verifiable Credential",
            ));
        }
        let vc = &self.verifiable_credentials[0];
        if vc.context().first().map(String::as_str) != Some(BASE_CONTEXT)
            || !vc
                .credential_type()
                .iter()
                .any(|kind| kind == "VerifiableCredential")
            || !vc
                .credential_type()
                .iter()
                .any(|kind| kind == vc.credential().credential_type())
        {
            return Err(String::from(
                "Invalid W3C Verifiable Credential context/type",
            ));
        }
        Ok(vc)
    }

    /// Derives a selectively disclosed Delegation Credential within a W3C VC
    /// and wraps that VC in the presentation, preserving issuer/status/id metadata.
    pub fn from_verifiable_credential(
        mut vc: VerifiableCredential<C>,
        claims_to_keep: Vec<C::Claim>,
        holder: String,
        audience: String,
        challenge: String,
    ) -> Result<Self, String> {
        if holder.trim().is_empty() {
            return Err(String::from(
                "VerifiablePresentation holder cannot be empty",
            ));
        }
        if audience.trim().is_empty() {
            return Err(String::from(
                "VerifiablePresentation audience cannot be empty",
            ));
        }
        if challenge.trim().is_empty() {
            return Err(String::from(
                "VerifiablePresentation challenge cannot be empty",
            ));
        }

        let _removed_indices = vc.credential_mut().retain_only(claims_to_keep)?;
        if vc.credential().is_empty() {
            return Err(String::from("VerifiablePresentation is empty"));
        }

        let presentation = Self::new(vc.context().clone(), holder, audience, challenge, vc);
        presentation.verifiable_credential()?;
        Ok(presentation)
    }

    /// Generates a VerifiablePresentation<C> from a JWT (useful for verifiers).
    ///
    /// # Arguments
    /// * `jwt` - the JWT string containing the signed VP.
    /// * `public_key` - public key of the JWT issuer.
    ///
    /// # Returns
    /// A result containing either an instance of VerifiablePresentation or an error as a string in case of failure.
    pub fn from_signed_jwt<CC: Credential + DeserializeOwned>(
        jwt: String,
        public_key: &Jwk,
    ) -> Result<VerifiablePresentation<CC>, String> {
        let verifier = match EdDSA.verifier_from_jwk(public_key) {
            Ok(verifier) => verifier,
            Err(err) => return Err(format!("Could not create verifier [{}]", err.to_string())),
        };

        let (payload, _) = match jwt::decode_with_verifier(jwt, &verifier) {
            Ok((payload, header)) => (payload, header),
            Err(err) => {
                return Err(format!(
                    "Failed to decode and verify jwt [{}]",
                    err.to_string()
                ));
            }
        };

        let vp_map = Value::Object(payload.claims_set().clone());

        let vp: VerifiablePresentation<CC> = serde_json::from_value(vp_map)
            .map_err(|err| format!("Could not deserialize VerifiablePresentation [{err}]"))?;
        vp.verifiable_credential()?;
        Ok(vp)
    }

    /// Generates a JWT from a VerifiablePresentation<C> (useful for issuers).
    ///
    /// # Arguments
    /// * `private_key` - private key of the JWT issuer.
    ///
    /// # Returns
    /// A result containing either the signed JWT or an error as a string in case of failure.
    pub fn to_signed_jwt(&self, private_key: &Jwk) -> Result<String, String> {
        let map_value = match serde_json::to_value(self) {
            Ok(map_value) => map_value,
            Err(err) => {
                return Err(format!(
                    "Failed to encode VerifiablePresentation to a value {err}"
                ));
            }
        };

        let map = match map_value {
            Value::Object(map) => map,
            _ => {
                return Err(String::from("VerifiablePresentation is not an object"));
            }
        };

        let mut header: JwsHeader = JwsHeader::new();
        header.set_algorithm("EdDSA");
        header.set_token_type("vp+jwt");

        let payload: JwtPayload = match JwtPayload::from_map(map) {
            Ok(payload) => payload,
            Err(err) => {
                return Err(format!("Failed to encode payload from map: [{err}]"));
            }
        };

        let signer = match EdDSA.signer_from_jwk(private_key) {
            Ok(signer) => signer,
            Err(err) => {
                return Err(format!("Failed to create signer: [{err}]"));
            }
        };

        let jwt = match jwt::encode_with_signer(&payload, &header, &signer) {
            Ok(jwt) => jwt,
            Err(err) => {
                return Err(format!("Failed to encode and sign jwt: [{err}]"));
            }
        };

        Ok(jwt)
    }
}

impl<C: Credential> Display for VerifiablePresentation<C> {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match serde_json::to_string(self) {
            Ok(result) => write!(f, "{}", result),
            Err(e) => {
                eprintln!("Verifiable Presentation serialization failed: {}", e);
                Err(std::fmt::Error)
            }
        }
    }
}

#[cfg(test)]
mod w3c_envelope_tests {
    use super::VerifiablePresentation;
    use crate::delegation::authorization::operation::Operation;
    use crate::delegation::authorization::permission::Permission;
    use crate::delegation::credentials::delegation::delegation_credential::DelegationCredential;
    use crate::delegation::credentials::generic::verifiable_credential::VerifiableCredential;
    use crate::delegation::status::model::bitstring_status_list_entry::BitstringStatusListEntry;
    use serde_json::{json, Value};

    fn sample_credential() -> Result<VerifiableCredential<DelegationCredential>, String> {
        let permission = Permission::new(
            String::from("https://gitea.local/repos/project-a"),
            Operation::ReadFile,
        )?;
        let credential = DelegationCredential::new(
            String::from("did:example:backend"),
            String::from("example-accumulator"),
            String::from("0"),
            String::from("999999999999999999999999999999"),
            1,
            vec![permission],
            String::from("example-metadata-witness"),
            vec![String::from("example-permission-witness")],
            vec![],
        )?;
        let status = BitstringStatusListEntry::revocation(
            None,
            String::from("0"),
            String::from("https://status.example/lists/1"),
        )?;
        Ok(VerifiableCredential::new_with_status(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("urn:uuid:00000000-0000-4000-8000-000000000001"),
            String::from("did:example:orchestrator"),
            String::from("2026-10-18T00:00:00Z"),
            status,
            credential,
        ))
    }

    fn derived_presentation() -> Result<VerifiablePresentation<DelegationCredential>, String> {
        let vc = sample_credential()?;
        let disclosed = vc.credential().permissions().clone();
        VerifiablePresentation::from_verifiable_credential(
            vc,
            disclosed,
            String::from("did:example:backend"),
            String::from("urn:thesis:gateway"),
            String::from("unique-request-nonce"),
        )
    }

    #[test]
    fn presentation_serializes_the_vc_envelope_and_preserves_status() -> Result<(), String> {
        let presentation = derived_presentation()?;
        let value = serde_json::to_value(&presentation).map_err(|err| err.to_string())?;
        assert_eq!(value["type"], json!(["VerifiablePresentation"]));
        assert_eq!(value["holder"], "did:example:backend");
        assert_eq!(value["verifiableCredential"][0]["type"],
                   json!(["VerifiableCredential", "DelegationCredential"]));
        assert_eq!(value["verifiableCredential"][0]["credentialStatus"]["statusPurpose"],
                   "revocation");
        assert!(value.get("credentialSubject").is_none());
        assert!(value.get("issuer").is_none());
        assert!(value.get("credentialStatus").is_none());
        assert!(value["verifiableCredential"][0]["credentialSubject"]["per"].is_array());
        assert_eq!(value["verifiableCredential"][0]["credentialSubject"]["pw"][0],
                   "example-permission-witness");
        let parsed: VerifiablePresentation<DelegationCredential> =
            serde_json::from_value(value).map_err(|err| err.to_string())?;
        assert_eq!(parsed.verifiable_credential()?.issuer(), "did:example:orchestrator");
        Ok(())
    }

    #[test]
    fn malformed_or_ambiguous_presentations_fail_closed() -> Result<(), String> {
        let base = serde_json::to_value(derived_presentation()?)
            .map_err(|err| err.to_string())?;
        let mut variants: Vec<Value> = Vec::new();

        let mut missing_vp_type = base.clone();
        missing_vp_type["type"] = json!(["DelegationCredential"]);
        variants.push(missing_vp_type);

        let mut missing_vc_type = base.clone();
        missing_vc_type["verifiableCredential"][0]["type"] = json!(["DelegationCredential"]);
        variants.push(missing_vc_type);

        let mut wrong_custom_type = base.clone();
        wrong_custom_type["verifiableCredential"][0]["type"] =
            json!(["VerifiableCredential", "UnrelatedCredential"]);
        variants.push(wrong_custom_type);

        let mut no_vc = base.clone();
        no_vc["verifiableCredential"] = json!([]);
        variants.push(no_vc);

        let mut two_vcs = base.clone();
        let credential = base["verifiableCredential"][0].clone();
        two_vcs["verifiableCredential"] = json!([credential.clone(), credential]);
        variants.push(two_vcs);

        let mut flattened_legacy = base.clone();
        flattened_legacy
            .as_object_mut()
            .ok_or_else(|| String::from("Expected VP object"))?
            .remove("verifiableCredential");
        flattened_legacy["credentialSubject"] =
            base["verifiableCredential"][0]["credentialSubject"].clone();
        variants.push(flattened_legacy);

        for (index, value) in variants.into_iter().enumerate() {
            let decoded = serde_json::from_value::<VerifiablePresentation<DelegationCredential>>(
                value,
            );
            match decoded {
                Ok(vp) => assert!(
                    vp.verifiable_credential().is_err(),
                    "Malformed presentation {index} was accepted"
                ),
                Err(_) => {}
            }
        }
        Ok(())
    }
}
