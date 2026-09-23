use crate::delegation::credentials::pjv::pjv_delegation_credential::PJVDelegationCredential;
use crate::delegation::credentials::pjv::pjv_delegator::PJVDelegator;
use crate::delegation::credentials::pjv::pjv_signature::PJVSignature;
use crate::delegation::credentials::verifiable_credential::VerifiableCredential;
use crate::delegation::credentials::verifiable_presentation::VerifiablePresentation;
use crate::delegation::entities::dtl_sim::DLTSim;
use crate::delegation::entities::verifier::verify_timings;
use ark_std::rand::prelude::StdRng;
use ark_std::rand::{RngCore, SeedableRng};
use ed25519_dalek::{SecretKey, SigningKey};
use josekit::jwe::{ECDH_ES_A128KW, JweHeader};
use josekit::jwk::Jwk;
use josekit::jws::{EdDSA, JwsSigner, JwsVerifier};
use multibase::Base::Base64Url;
use serde_json::Value;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use x25519_dalek::{PublicKey as X25519PublicKey, StaticSecret};

pub struct PJVIssuerVerifier {
    id: String,
    decryption_jwk: Jwk,
    signature_jwk: Jwk,
    encryption_dlt: DLTSim<Jwk>,
    verification_dlt: DLTSim<Jwk>,
}

impl PJVIssuerVerifier {
    /// Create a PJVIssuerVerifier instance (in their paper the resource owner is also the verifier).
    ///
    /// # Arguments
    /// * `id` - the issuer's (and verifier's) unique id.
    /// * `accumulator_dlt` - a reference to the DLT Simulator (a hashmap containing public keys) for accumulators.
    /// * `verification_dlt` - a reference to the DLT Simulator (a hashmap containing public keys) for ECC signature schemes.
    ///
    /// # Returns
    /// A result containing either the PJVIssuerVerifier instance or an error as a string in case of failure.
    pub fn new(
        id: String,
        encryption_dlt: DLTSim<Jwk>,
        verification_dlt: DLTSim<Jwk>,
    ) -> Result<Self, String> {
        let mut rng: StdRng = StdRng::from_entropy();

        // let signing_algorithm = String::from("EdDSA");
        // let encryption_algorithm = String::from("ECDH-ES+A128KW");
        // let content_encryption_algorithm = String::from("A128GCM");

        // =====================================================
        // Ed25519 SIGNATURE - Public and Private Key generation
        // =====================================================
        let mut sk: SecretKey = [0u8; 32];
        rng.fill_bytes(&mut sk);
        let signing_key = SigningKey::from_bytes(&sk);
        let public_key_bytes = signing_key.verifying_key().to_bytes();
        let private_key_bytes = signing_key.to_bytes();

        let mut signature_jwk = Jwk::new("OKP");
        match signature_jwk.set_parameter("crv", Some(Value::String(String::from("Ed25519")))) {
            Ok(()) => {}
            Err(e) => {
                return Err(format!(
                    "Failed to set parameter crv for signing key [{}]",
                    e
                ));
            }
        };
        match signature_jwk
            .set_parameter("x", Some(Value::String(Base64Url.encode(public_key_bytes))))
        {
            Ok(()) => {}
            Err(e) => {
                return Err(format!("Failed to set parameter x for signing key [{}]", e));
            }
        };

        // Take the public key for verification and put it in the DLT
        let public_signature_jwk = signature_jwk.clone();
        verification_dlt
            .borrow_mut()
            .insert(id.clone(), public_signature_jwk);

        // Add the private parameter d to the jwk to enable the signing operation.
        match signature_jwk.set_parameter(
            "d",
            Some(Value::String(Base64Url.encode(private_key_bytes))),
        ) {
            Ok(()) => {}
            Err(e) => {
                return Err(format!("Failed to set parameter d for signing key [{}]", e));
            }
        };

        // =====================================================
        // X25519 SIGNATURE - Public and Private Key generation
        // =====================================================
        let mut seed: [u8; 32] = [0u8; 32];
        rng.fill_bytes(&mut seed);
        let encryption_secret = StaticSecret::from(seed);
        let x_public = X25519PublicKey::from(&encryption_secret);

        let mut decryption_jwk = Jwk::new("OKP");
        match decryption_jwk.set_parameter("crv", Some(Value::String(String::from("X25519")))) {
            Ok(_) => {}
            Err(e) => {
                return Err(format!("Failed to set parameter crv [{}]", e));
            }
        };
        match decryption_jwk.set_parameter(
            "x",
            Some(Value::String(Base64Url.encode(x_public.as_bytes()))),
        ) {
            Ok(_) => {}
            Err(e) => {
                return Err(format!("Failed to set parameter x [{}]", e));
            }
        };

        // Take the public key for encryption of data and put it in the DLT
        let encryption_jwk = decryption_jwk.clone();
        encryption_dlt
            .borrow_mut()
            .insert(id.clone(), encryption_jwk);

        // Add the private parameter d to the jwk to enable the decryption operation.
        match decryption_jwk.set_parameter(
            "d",
            Some(Value::String(
                Base64Url.encode(encryption_secret.as_bytes()),
            )),
        ) {
            Ok(_) => {}
            Err(e) => {
                return Err(format!("Failed to set parameter d [{}]", e));
            }
        }

        Ok(PJVIssuerVerifier {
            id,
            decryption_jwk,
            signature_jwk,
            encryption_dlt,
            verification_dlt,
        })
    }

    /// Private function to sign a delegator object
    fn sign_delegator(&self, delegator: &PJVDelegator) -> Result<PJVSignature, String> {
        let serialized_delegator = match serde_json::to_string(delegator) {
            Ok(serialized_delegator) => serialized_delegator,
            Err(err) => {
                return Err(format!("Failed to serialize delegator [{}]", err));
            }
        };

        // Convert the serialized delegator to an array of bytes
        let serialized_delegator_bytes = serialized_delegator.as_bytes();

        // Create a signer with the issuer's private key
        let signer = match EdDSA.signer_from_jwk(&self.signature_jwk) {
            Ok(signer) => signer,
            Err(e) => {
                return Err(format!("Failed to set signer for jwk {}", e));
            }
        };

        // Sign the delegator's array of bytes
        let vec_signature = match signer.sign(serialized_delegator_bytes) {
            Ok(vec_signature) => vec_signature,
            Err(e) => {
                return Err(format!("Failed to sign payload [{}]", e));
            }
        };

        // Generate a PJVSignature object as specified in the paper
        let signature = Base64Url.encode(&vec_signature);
        Ok(PJVSignature::new(signature))
    }

    /// Issues a VerifiableCredential containing a PJVDelegationCredential.
    ///
    /// # Arguments
    /// * `context` - array of strings containing the context for the VC.
    /// * `credential_id` - unique identifier of the VC.
    /// * `valid_from` - string containing the validity of the VC.
    /// * `delegatee_id` - string containing the subject of the credential (the delegatee).
    /// * `validity_period` - duration for which the credential can be used.
    /// * `owner` - owner of the resource.
    /// * `operations` - array of strings containing the operations (permissions) given to the delegatee.
    /// * `optional_issuer_vc` - if the issuer is a root delegator (i.e.: the owner of the resource), this might be set to None. Otherwise, if the issuer has received permissions on their own, they must prove that the permissions he delegates are in fact given by someone else by means of another DelegationCredential.
    ///
    /// # Returns
    /// A result containing either the VerifiableCredential or an error as a string in case of failure.
    pub fn issue_delegation_verifiable_credential(
        &self,
        context: Vec<String>,
        credential_id: String,
        valid_from: String,
        delegatee_id: String,
        validity_period: Duration,
        owner: String,
        resource_uri: String,
        operations: Vec<String>,
        optional_issuer_vc: Option<VerifiableCredential<PJVDelegationCredential>>,
    ) -> Result<VerifiableCredential<PJVDelegationCredential>, String> {
        let issuer = self.id.clone();

        if operations.is_empty() {
            return Err("Permissions array is empty".to_string());
        }

        let since_epoch: Duration = match SystemTime::now().duration_since(UNIX_EPOCH) {
            Ok(duration) => duration,
            Err(e) => return Err(format!("Failed to get issuance time [{e}]")),
        };

        let numeric_iat: u128 = since_epoch.as_nanos();
        let numeric_exp: u128 = numeric_iat + validity_period.as_nanos();
        let iat = numeric_iat.to_string();
        let exp = numeric_exp.to_string();

        let hierarchy: String;

        match optional_issuer_vc {
            // If the issued credential is from the root delegator, we simply set the hierarchy to an
            // empty string.
            None => {
                hierarchy = String::new();
            }

            // If not, we have to encrypt the previous credential with the owner's public key
            // so that they're able to decrypt the credential and rebuild the chain of trust backwards
            Some(issuer_vc) => {
                // Retrieve the owner's public key from the dlt
                let dlt = self.encryption_dlt.borrow();
                let owner_public_key = match dlt.get(&owner) {
                    Some(owner_public_key) => owner_public_key,
                    None => {
                        return Err(format!(
                            "Resource owner [{owner}] has not published its public key in the DLT"
                        ));
                    }
                };

                // Serialize the PJVDelegationCredential to a string
                let issuer_dc = issuer_vc.credential();
                let serialized_dc = match serde_json::to_string(&issuer_dc) {
                    Ok(serialized_dc) => serialized_dc,
                    Err(e) => {
                        return Err(format!(
                            "Failed to serialize issuer delegation credential [{}]",
                            e
                        ));
                    }
                };

                // Generate the encrypter from the retrieved owner's public key
                let encrypter = match ECDH_ES_A128KW.encrypter_from_jwk(owner_public_key) {
                    Ok(x) => x,
                    Err(e) => {
                        return Err(format!("Encrypter creation failed: {}", e));
                    }
                };

                // Since Curve 25519 does not support direct encryption, we have to wrap an ephemeral
                // AES-128-GCM symmetric key in the string so that the verifier is able to decrypt
                // the encrypted text.
                let mut header = JweHeader::new();
                header.set_algorithm("ECDH-ES+A128KW");
                header.set_content_encryption("A128GCM");

                // Convert the serialized dc string to an array of bytes
                let serialized_dc_bytes = serialized_dc.as_bytes();
                // Encrypt the array of bytes with the encrypter
                hierarchy =
                    match josekit::jwe::serialize_compact(serialized_dc_bytes, &header, &encrypter)
                    {
                        Ok(hierarchy) => hierarchy,
                        Err(e) => {
                            return Err(format!("Serialization failed: {}", e));
                        }
                    };
            }
        }

        // Insert the hierarchy in a new delegator object and serialize it
        let delegator = PJVDelegator::new(
            owner,
            issuer.clone(),
            delegatee_id,
            iat,
            exp,
            resource_uri,
            operations,
            hierarchy,
        );

        let pjv_signature = self.sign_delegator(&delegator)?;

        // Create a PJVDelegationCredential and a Verifiable Credential
        let dc = PJVDelegationCredential::new(delegator, pjv_signature)?;
        let vc = VerifiableCredential::new(context, credential_id, issuer, valid_from, dc);

        Ok(vc)
    }

    /// Given a VerifiableCredential and an array of permissions to disclose, issues a VerifiablePresentation.
    ///
    /// # Arguments
    /// * `vc` - VerifiableCredential to disclose permissions from.
    /// * `disclosed_permissions` - array of strings containing the permissions to disclose.
    ///
    /// # Returns
    /// A result containing either the VerifiablePresentation or an error as a string in case of failure.
    pub fn issue_delegation_verifiable_presentation(
        &self,
        vc: VerifiableCredential<PJVDelegationCredential>,
        disclosed_permissions: Vec<String>,
    ) -> Result<String, String> {
        let mut vp: VerifiablePresentation<PJVDelegationCredential> =
            VerifiablePresentation::from_verifiable_credential(vc, disclosed_permissions)?;

        let delegator: PJVDelegator = vp.credential().delegator().clone();
        let pjv_signature: PJVSignature = self.sign_delegator(&delegator)?;

        let signature = vp.mut_credential().mut_signature();
        signature.signature = pjv_signature.signature;

        vp.to_signed_jwt(&self.signature_jwk)
    }

    /// Private function useful to verify a PJVDelegator given a signature
    fn verify_signature(
        &self,
        delegator: &PJVDelegator,
        signature: &PJVSignature,
    ) -> Result<(), String> {
        let issuer = delegator.iss();
        let verification_dlt = self.verification_dlt.borrow();

        // Retrieve the issuer from the DLT
        let jwk = match verification_dlt.get(issuer) {
            Some(issuer_pk) => issuer_pk,
            None => {
                return Err(format!("Issuer {issuer} not found in the verification DLT"));
            }
        };

        // Generate a verifier with the issuer's public key
        let verifier = match EdDSA.verifier_from_jwk(jwk) {
            Ok(verifier) => verifier,
            Err(err) => {
                return Err(format!("Failed to set verifier for jwk [{}]", err));
            }
        };

        // Serialize the delegator into a String
        let serialized_delegator = match serde_json::to_string(&delegator) {
            Ok(serialized_delegator) => serialized_delegator,
            Err(err) => {
                return Err(format!("Failed to serialize delegator [{}]", err));
            }
        };

        // Decode the signature from base64url
        let decoded_signature = match Base64Url.decode(signature.signature()) {
            Ok(decoded_signature) => decoded_signature,
            Err(err) => {
                return Err(format!("Decoding of signature failed [{}]", err));
            }
        };

        // Using the arrays of bytes, verify the signature corresponding to the delegator
        match verifier.verify(
            serialized_delegator.as_bytes(),
            decoded_signature.as_slice(),
        ) {
            Ok(()) => Ok(()),
            Err(err) => Err(format!("Failed to verify delegator [{}]", err)),
        }
    }

    /// Private function useful to verify a PJWDelegationCredential
    fn verify_delegation_credential(
        &self,
        delegation_credential: &PJVDelegationCredential,
        now: u128,
    ) -> Result<PJVDelegator, String> {
        let delegator = delegation_credential.delegator();
        let signature = delegation_credential.signature();

        let self_id = self.id.clone();
        let owner = delegator.owner().clone();
        let issuer = delegator.iss().clone();

        // Verify that timings are correct
        verify_timings(now, delegator.iat(), delegator.exp())?;

        // Verify that the signature on the delegator is correct
        self.verify_signature(delegator, signature)?;

        // Check the hierarchy
        if *delegator.hierarchy() == String::new() {
            // If hierarchy is empty, the credential presented must be issued by the verifier, which
            // is also supposed to be the owner
            if self_id != owner || self_id != issuer {
                Err(format!(
                    "Hierarchy is empty but ({self_id} != {owner}) or ({self_id} != {issuer})"
                ))
            } else {
                Ok(delegator.clone())
            }
        } else {
            // If hierarchy is not empty, we must decrypt it, create a new PJVDelegationCredential
            // object, and check that object as well. We do that recursively.

            // Create a decrypter object using the issuer_verifier private key
            let decrypter = match ECDH_ES_A128KW.decrypter_from_jwk(&self.decryption_jwk) {
                Ok(x) => x,
                Err(e) => {
                    return Err(format!("Decrypter creation failed: {}", e));
                }
            };

            let hierarchy = delegator.hierarchy().clone();

            // Decrypt the string using the decrypter object
            let (payload, _header) =
                match josekit::jwe::deserialize_compact(hierarchy.as_str(), &decrypter) {
                    Ok((payload, header)) => (payload, header),
                    Err(e) => {
                        return Err(format!("Failed to deserialize jws compact payload {}", e));
                    }
                };

            // Convert the byte array into a String
            let dc_string = match String::from_utf8(payload) {
                Ok(string) => string,
                Err(e) => {
                    return Err(format!(
                        "Failed to convert jws compact string for payload {}",
                        e
                    ));
                }
            };

            // Deserialize the String and create a PJVDelegationCredential
            let parsed_delegation_credential =
                match serde_json::from_str::<PJVDelegationCredential>(&dc_string) {
                    Ok(parsed_delegation_credential) => parsed_delegation_credential,
                    Err(err) => {
                        return Err(format!(
                            "Failed to deserialize PJVDelegationCredential {err}"
                        ));
                    }
                };

            // Recursively call this same function until we get to a point in which hierarchy is empty.
            let decrypted_delegator =
                self.verify_delegation_credential(&parsed_delegation_credential, now)?;
            let decrypted_operations = decrypted_delegator.operations();

            for operation in delegator.operations() {
                if !decrypted_operations.contains(operation) {
                    return Err(format!(
                        "Operation {operation} not included in the decrypted delegation credential {decrypted_operations:?}"
                    ));
                }
            }

            if delegator.iss() != decrypted_delegator.sub() {
                return Err(format!(
                    "Mismatch found in delegation credential: decrypted credential's subject is different from the current issuer [{}] [{}]",
                    delegator.iss(),
                    decrypted_delegator.sub()
                ));
            }

            Ok(delegator.clone())
        }
    }

    /// Verifies a VerifiablePresentation containing a PJVDelegationCredential.
    ///
    /// # Arguments
    /// * `presenter_id` - the id of the VP presenter.
    /// * `signed_jwt` - the signed JWT presented (that includes the VP).
    ///
    /// # Returns
    /// A result containing an error as a string in case of failure.
    pub fn verify_verifiable_presentation(
        &self,
        presenter_id: String,
        signed_jwt: String,
    ) -> Result<(), String> {
        let ecc_pk = match self.verification_dlt.borrow().get(&presenter_id) {
            None => return Err(format!("Could not find presenter {presenter_id} in DLTSim")),
            Some(ecc_pk) => ecc_pk.clone(),
        };

        let vp: VerifiablePresentation<PJVDelegationCredential> =
            VerifiablePresentation::<PJVDelegationCredential>::from_signed_jwt(
                signed_jwt, &ecc_pk,
            )?;
        let dc = vp.credential();

        // Get now timestamp and convert it to nanoseconds
        let now: Duration = match SystemTime::now().duration_since(UNIX_EPOCH) {
            Ok(duration) => duration,
            Err(e) => return Err(format!("Error encountered in computing issuance time: {e}")),
        };
        let now_ns = now.as_nanos();

        self.verify_delegation_credential(dc, now_ns)?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::delegation::entities::dtl_sim::{DLTSim, new_dlt_sim};
    use crate::delegation::entities::pjv::pjv_issuer_verifier::PJVIssuerVerifier;
    use josekit::jwk::Jwk;
    use std::time::Duration;

    #[test]
    fn test_issuer() -> Result<(), String> {
        let encryption_dlt: DLTSim<Jwk> = new_dlt_sim();
        let signature_dlt: DLTSim<Jwk> = new_dlt_sim();

        let owner = String::from("https://vc.example/delegators/d0");
        let id = String::from("https://vc.example/delegators/d0");
        let previous_vc = None;
        let issuer_owner: PJVIssuerVerifier =
            PJVIssuerVerifier::new(id, encryption_dlt.clone(), signature_dlt.clone())?;
        let context: Vec<String> = vec![String::from("https://www.w3.org/ns/credentials/v2")];
        let credential_id = String::from("http://delegation.example/credentials/1337");
        let valid_from = String::from("2026-01-01T00:00:00Z");
        let delegatee_id = String::from("https://vc.example/delegators/d1");
        let validity_period: Duration = Duration::new(3600, 0);
        let resource_uri: String = String::from("https://vc.example/resources/r1");
        let permissions: Vec<String> =
            vec![String::from("p0"), String::from("p1"), String::from("p2")];
        let vc = issuer_owner.issue_delegation_verifiable_credential(
            context.clone(),
            credential_id,
            valid_from.clone(),
            delegatee_id.clone(),
            validity_period,
            owner.clone(),
            resource_uri.clone(),
            permissions,
            previous_vc,
        )?;

        let id = String::from("https://vc.example/delegators/d1");
        let previous_vc = Some(vc);
        let issuer: PJVIssuerVerifier =
            PJVIssuerVerifier::new(id, encryption_dlt.clone(), signature_dlt.clone())?;
        let credential_id = String::from("http://delegation.example/credentials/1338");
        let delegatee_id = String::from("https://vc.example/delegators/d2");
        let permissions: Vec<String> =
            vec![String::from("p0"), String::from("p1"), String::from("p2")];
        let vc = issuer.issue_delegation_verifiable_credential(
            context.clone(),
            credential_id,
            valid_from.clone(),
            delegatee_id.clone(),
            validity_period,
            owner.clone(),
            resource_uri.clone(),
            permissions,
            previous_vc,
        )?;

        let id = String::from("https://vc.example/delegators/d2");
        let previous_vc = Some(vc);
        let issuer: PJVIssuerVerifier =
            PJVIssuerVerifier::new(id, encryption_dlt.clone(), signature_dlt.clone())?;
        let credential_id = String::from("http://delegation.example/credentials/1339");
        let delegatee_id = String::from("https://vc.example/delegators/d3");
        let permissions: Vec<String> =
            vec![String::from("p0"), String::from("p1"), String::from("p2")];
        let vc = issuer.issue_delegation_verifiable_credential(
            context.clone(),
            credential_id,
            valid_from.clone(),
            delegatee_id.clone(),
            validity_period,
            owner.clone(),
            resource_uri.clone(),
            permissions,
            previous_vc,
        )?;

        let vp = issuer.issue_delegation_verifiable_presentation(vc, vec![String::from("p1")])?;

        issuer_owner.verify_verifiable_presentation(issuer.id, vp)
    }
}
