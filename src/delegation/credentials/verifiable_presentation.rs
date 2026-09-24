use crate::delegation::credentials::verifiable_credential::VerifiableCredential;
use crate::delegation::traits::credential::Credential;
use josekit::jwk::Jwk;
use josekit::jws::{EdDSA, JwsHeader};
use josekit::jwt;
use josekit::jwt::JwtPayload;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt::Display;

#[derive(Clone, Serialize, Deserialize)]
pub struct VerifiablePresentation<C: Credential> {
    #[serde(rename = "@context")]
    context: Vec<String>,
    #[serde(rename = "type")]
    credential_type: Vec<String>,
    #[serde(rename = "id")]
    id: String,
    #[serde(rename = "issuer")]
    issuer: String,
    #[serde(rename = "holder")]
    holder: String,
    #[serde(rename = "audience")]
    audience: String,
    #[serde(rename = "challenge")]
    challenge: String,
    #[serde(rename = "validFrom")]
    valid_from: String,
    #[serde(rename = "credentialSubject")]
    credential: C,
}

impl<C: Credential> VerifiablePresentation<C> {
    /// Creates a new VerifiablePresentation instance for a given Credential (C) type.
    ///
    /// # Arguments
    /// * `context` - a vector of string containing the context of the VC.
    /// * `id` - a string containing the VC's identifier.
    /// * `issuer` - a string containing the VC issuer.
    /// * `valid_from` - a string containing the validity of the VC.
    /// * `credential` - the Credential containing claims.
    ///
    /// # Returns
    /// An instance of VerifiablePresentation.
    pub fn new(
        context: Vec<String>,
        credential_type: Vec<String>,
        id: String,
        issuer: String,
        holder: String,
        audience: String,
        challenge: String,
        valid_from: String,
        credential: C,
    ) -> Self {
        VerifiablePresentation {
            context,
            credential_type,
            id,
            issuer,
            holder,
            audience,
            challenge,
            valid_from,
            credential,
        }
    }

    /// Getter function that returns the context vector.
    pub fn context(&self) -> &Vec<String> {
        &self.context
    }
    /// Getter function that returns the type of the VC.
    pub fn credential_type(&self) -> &Vec<String> {
        &self.credential_type
    }
    /// Getter function that returns the credential's id.
    pub fn id(&self) -> &String {
        &self.id
    }
    /// Getter function that returns the variable containing the issuer of the VC.
    pub fn issuer(&self) -> &String {
        &self.issuer
    }
    /// Getter function that returns the VP holder.
    pub fn holder(&self) -> &String {
        &self.holder
    }
    /// Getter function that returns the request audience bound to this VP.
    pub fn audience(&self) -> &String {
        &self.audience
    }
    /// Getter function that returns the request challenge bound to this VP.
    pub fn challenge(&self) -> &String {
        &self.challenge
    }
    /// Getter function that returns the valid_from variable.
    pub fn valid_from(&self) -> &String {
        &self.valid_from
    }
    /// Getter function that returns the nested credential.
    pub fn credential(&self) -> &C {
        &self.credential
    }
    /// Getter function that returns a mutable reference of the nested credential (for Selective Disclosure)
    pub fn mut_credential(&mut self) -> &mut C {
        &mut self.credential
    }

    /// Generates a VerifiablePresentation<C> from a VerifiableCredential<C>, while also applying Selective Disclosure.
    ///
    /// # Arguments
    /// * `vc` - the instance of VerifiableCredential that will be used to create the VerifiablePresentation.
    /// * `claims_to_keep` - claims to be kept according to the concrete Credential claim type.
    ///
    /// # Returns
    /// A result containing either an instance of VerifiablePresentation or an error as a string in case of failure.
    pub fn from_verifiable_credential(
        vc: VerifiableCredential<C>,
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

        let mut vc = VerifiablePresentation::new(
            vc.context().clone(),
            vc.credential_type().clone(),
            vc.id().clone(),
            vc.issuer().clone(),
            holder,
            audience,
            challenge,
            vc.valid_from().clone(),
            vc.credential().clone(),
        );

        // Only keep the claims we want to disclose, remove the rest
        let _removed_indices = vc.credential.retain_only(claims_to_keep)?;

        // TODO: check for no removal using the result?

        match vc.credential.is_empty() {
            true => Err(String::from("VerifiablePresentation is empty")),
            false => Ok(vc),
        }
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

        match serde_json::from_value(vp_map) {
            Ok(vp) => Ok(vp),
            Err(err) => Err(format!(
                "Could not deserialize VerifiablePresentation [{}]",
                err.to_string()
            )),
        }
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
