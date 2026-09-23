use crate::delegation::credentials::sdjwt::sdjwt_delegation::SdJWTDelegation;
use crate::delegation::credentials::sdjwt::sdjwt_delegation_credential::SdJWTDelegationCredential;
use crate::delegation::credentials::sdjwt::sdjwt_delegator::SdJWTDelegator;
use crate::delegation::credentials::verifiable_credential::VerifiableCredential;
use crate::delegation::entities::dtl_sim::DLTSim;
use crate::delegation::entities::issuer::Issuer;
use crate::delegation::entities::sdjwt::sdjwt_utils;
use ark_std::rand::prelude::StdRng;
use ark_std::rand::{RngCore, SeedableRng};
use ed25519_dalek::{SecretKey, SigningKey};
use josekit::jwk::Jwk;
use josekit::jwk::alg::ec::EcCurve;
use multibase::Base::Base64Url;
use serde_json::Value;
use std::str::FromStr;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub struct SdJWTIssuer {
    id: String,
    issuer_jwk: Jwk,
    holder_jwk: Jwk,
}

impl Issuer<Jwk, SdJWTDelegationCredential> for SdJWTIssuer {
    /// Creates a new SdJWTIssuer structure.
    ///
    /// # Arguments
    /// * `id` - the issuer's unique id.
    /// * `issuer_dlt` - a reference to the DLT Simulator (a hashmap containing public keys) for the
    /// issuers' public keys.
    /// * `holder_dlt` - a reference to the DLT Simulator (a hashmap containing public keys) for the
    /// holders' public keys.
    ///
    /// # Returns
    /// A result containing either the instance of SdJWTIssuer or an error as a string in case of
    /// failure.
    fn new(id: String, issuer_dlt: DLTSim<Jwk>, holder_dlt: DLTSim<Jwk>) -> Result<Self, String> {
        let mut rng: StdRng = StdRng::from_entropy();
        let issuer_jwk: Jwk = match Jwk::generate_ec_key(EcCurve::P256) {
            Ok(jwk) => jwk,
            Err(err) => return Err(format!("Error in generating Jwk: [{err}]")),
        };

        issuer_dlt
            .borrow_mut()
            .insert(id.clone(), issuer_jwk.to_public_key().unwrap().clone());

        let mut sk: SecretKey = [0u8; 32];
        // let signing_algorithm = String::from("EdDSA");

        // =====================================================
        // Ed25519 SIGNATURE - Public and Private Key generation
        // =====================================================
        rng.fill_bytes(&mut sk);
        let signing_key = SigningKey::from_bytes(&sk);
        let public_key_bytes = signing_key.verifying_key().to_bytes();
        let private_key_bytes = signing_key.to_bytes();

        let mut holder_jwk = Jwk::new("OKP");
        match holder_jwk.set_parameter("crv", Some(Value::String(String::from("Ed25519")))) {
            Ok(()) => {}
            Err(e) => {
                return Err(format!(
                    "Failed to set parameter crv for signing key [{}]",
                    e
                ));
            }
        };
        match holder_jwk.set_parameter("x", Some(Value::String(Base64Url.encode(public_key_bytes))))
        {
            Ok(()) => {}
            Err(e) => {
                return Err(format!("Failed to set parameter x for signing key [{}]", e));
            }
        };

        // Take the public key for verification and put it in the DLT
        let public_signature_jwk = holder_jwk.clone();
        holder_dlt
            .borrow_mut()
            .insert(id.clone(), public_signature_jwk);

        // Add the private parameter d to the jwk to enable the signing operation.
        match holder_jwk.set_parameter(
            "d",
            Some(Value::String(Base64Url.encode(private_key_bytes))),
        ) {
            Ok(()) => {}
            Err(e) => {
                return Err(format!("Failed to set parameter d for signing key [{}]", e));
            }
        };

        Ok(SdJWTIssuer {
            id,
            issuer_jwk,
            holder_jwk,
        })
    }

    /// Issues a VerifiableCredential containing a SdJWTDelegationCredential.
    ///
    /// # Arguments
    /// * `context` - array of strings containing the context for the VC.
    /// * `credential_id` - unique identifier of the VC.
    /// * `valid_from` - string containing the validity of the VC.
    /// * `delegatee_id` - string containing the subject of the credential (the delegatee).
    /// * `validity_period` - duration for which the credential can be used.
    /// * `permissions` - array of strings containing the permissions given to the delegatee.
    /// * `optional_issuer_vc` - if the issuer is a root delegator (i.e.: the owner of the
    /// resource), this might be set to None. Otherwise, if the issuer has received permissions on
    /// their own, they must prove that the permissions he delegates are in fact given by someone
    /// else by means of another DelegationCredential.
    ///
    /// # Returns
    /// A result containing either the VerifiableCredential or an error as a string in case of
    /// failure.
    fn issue_delegation_verifiable_credential(
        &self,
        context: Vec<String>,
        credential_id: String,
        valid_from: String,
        delegatee_id: String,
        validity_period: Duration,
        permissions: Vec<String>,
        optional_issuer_vc: Option<VerifiableCredential<SdJWTDelegationCredential>>,
    ) -> Result<VerifiableCredential<SdJWTDelegationCredential>, String> {
        // Validity_period refers to a short-lived credential: since its issuance moment, the
        // delegation credential could be valid for a month, a week, a day, or anything really.

        let issuer = self.id.clone();

        if permissions.is_empty() {
            return Err("Permissions array is empty".to_string());
        }

        let since_epoch: Duration = match SystemTime::now().duration_since(UNIX_EPOCH) {
            Ok(duration) => duration,
            Err(e) => return Err(format!("Error encountered in computing issuance time: {e}")),
        };

        let numeric_iat: u128 = since_epoch.as_nanos();
        let mut numeric_exp: u128 = numeric_iat + validity_period.as_nanos();
        let iat = numeric_iat.to_string();
        let mut exp = numeric_exp.to_string();

        // Set exp to the lowest expiration value in hierarchy
        if let Some(vc) = &optional_issuer_vc {
            for delegator in vc.credential().hierarchy() {
                let delegator_exp = match u128::from_str(delegator.exp()) {
                    Ok(delegator_exp) => delegator_exp,
                    Err(err) => {
                        return Err(format!(
                            "Could not parse delegator exp {} [{err}]",
                            delegator.exp()
                        ));
                    }
                };

                if delegator_exp < numeric_exp {
                    numeric_exp = delegator_exp;
                    exp = numeric_exp.to_string();
                }
            }
        }

        match optional_issuer_vc {
            // If the issued credential is from the root delegator, we simply set the hierarchy to
            // an empty array.
            None => {
                let mut permission_salts: Vec<String> = Vec::new();
                let mut hashes: Vec<String> = Vec::new();

                // Generate salts and hashes.
                let mut salt: String;
                for permission in &permissions {
                    salt = sdjwt_utils::generate_random_salt();
                    hashes.push(sdjwt_utils::hash(permission, &salt));
                    permission_salts.push(salt);
                }

                // Sign the data.
                let signature = sdjwt_utils::generate_signature(
                    &self.issuer_jwk,
                    &delegatee_id,
                    &iat,
                    &exp,
                    &hashes,
                )?;

                let hierarchy: Vec<SdJWTDelegator> = vec![];
                let dc = SdJWTDelegationCredential::new(
                    delegatee_id,
                    hashes,
                    iat,
                    exp,
                    permissions,
                    permission_salts,
                    signature,
                    hierarchy,
                )?;
                let vc = VerifiableCredential::new(context, credential_id, issuer, valid_from, dc);
                Ok(vc)
            }

            // If not, we have to check that the permissions are indeed included in previously
            // issued credentials
            Some(issuer_vc) => {
                let issuer_dc = issuer_vc.credential();
                let issuer_permissions = issuer_dc.permissions().clone();
                let mut issuer_salts = issuer_dc.permission_salts().clone();
                let mut issuer_hashes = issuer_dc.hashes().clone();

                // Permissions are only available in the VC, not in hierarchy, so no need to check
                // those
                for permission in &permissions {
                    if !issuer_permissions.contains(&permission) {
                        return Err(format!(
                            "Permission {permission} cannot be granted since it was not included in the previous Delegation Credential"
                        ));
                    }
                }

                let mut issuer_hierarchy = issuer_dc.hierarchy().clone();
                let issuer_permissions_size = issuer_permissions.len();
                let permissions_size = permissions.len();

                // If the delegation credential does have more permissions than the previous one,
                // it incurs in an error
                if permissions_size > issuer_permissions_size {
                    return Err(format!(
                        "Cannot grant more permissions than those included in the previous Delegation Credential [{} < {}]",
                        permissions_size, issuer_permissions_size
                    ));
                }
                // Otherwise, if it has fewer permissions than the previous one, we must filter out
                // the unnecessary permissions and salts from the previous one.
                // We assume here that permissions are granted in the same order as the previous
                // ones
                else if permissions_size < issuer_permissions_size {
                    let mut removable_indices: Vec<usize> = vec![];

                    // For every issuer permission, check whether it is contained in the permissions
                    // to be delegated. If not, add it to an array of indices to be removed
                    for (i, issuer_permission) in issuer_permissions.iter().enumerate() {
                        if !permissions.contains(&issuer_permission) {
                            removable_indices.push(i);
                        }
                    }

                    // Remove indices from salts
                    for i in removable_indices.iter().rev() {
                        issuer_salts.remove(*i);
                        issuer_hashes.remove(*i);
                    }
                }

                let signature = sdjwt_utils::generate_signature(
                    &self.issuer_jwk,
                    &delegatee_id,
                    &iat,
                    &exp,
                    &issuer_hashes,
                )?;

                let issuer_delegator = SdJWTDelegator::new(
                    issuer_vc.issuer().clone(),
                    issuer_dc.delegatee_id().clone(), // should be equal to self.id
                    issuer_dc.iat().clone(),
                    issuer_dc.exp().clone(),
                    issuer_dc.hashes().clone(),
                    issuer_dc.signature().clone(),
                );
                issuer_hierarchy.push(issuer_delegator);

                let result_dc = SdJWTDelegationCredential::new(
                    delegatee_id,
                    issuer_hashes,
                    iat,
                    exp,
                    permissions,
                    issuer_salts,
                    signature,
                    issuer_hierarchy.clone(),
                )?;

                let result_vc = VerifiableCredential::new(
                    context,
                    credential_id,
                    issuer,
                    valid_from,
                    result_dc,
                );

                Ok(result_vc)
            }
        }
    }

    fn holder_jwk(&self) -> &Jwk {
        &self.holder_jwk
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delegation::entities::dtl_sim::new_dlt_sim;

    #[test]
    fn issue_vc() -> Result<(), String> {
        let acc_sim: DLTSim<Jwk> = new_dlt_sim();
        let ecc_sim: DLTSim<Jwk> = new_dlt_sim();

        let id = String::from("https://vc.example/delegators/d0");
        let previous_vc = None;
        let issuer: SdJWTIssuer = SdJWTIssuer::new(id, acc_sim.clone(), ecc_sim.clone())?;
        let context: Vec<String> = vec![String::from("https://www.w3.org/ns/credentials/v2")];
        let credential_id = String::from("http://delegation.example/credentials/1337");
        let valid_from = String::from("2026-01-01T00:00:00Z");
        let delegatee_id = String::from("https://vc.example/delegators/d1");
        let validity_period: Duration = Duration::new(3600, 0);
        let permissions: Vec<String> = vec![
            String::from("https://vc.example/resources/r1:p0"),
            String::from("https://vc.example/resources/r1:p1"),
            String::from("https://vc.example/resources/r1:p2"),
        ];
        let vc = issuer.issue_delegation_verifiable_credential(
            context,
            credential_id,
            valid_from,
            delegatee_id,
            validity_period,
            permissions,
            previous_vc,
        )?;

        let id = String::from("https://vc.example/delegators/d1");
        let previous_vc = Some(vc);
        let issuer: SdJWTIssuer = SdJWTIssuer::new(id, acc_sim.clone(), ecc_sim.clone())?;
        let context: Vec<String> = vec![String::from("https://www.w3.org/ns/credentials/v2")];
        let credential_id = String::from("http://delegation.example/credentials/1338");
        let valid_from = String::from("2026-01-01T00:00:00Z");
        let delegatee_id = String::from("https://vc.example/delegators/d2");
        let validity_period: Duration = Duration::new(3600, 0);
        let permissions: Vec<String> = vec![
            String::from("https://vc.example/resources/r1:p0"),
            String::from("https://vc.example/resources/r1:p1"),
        ];
        let vc = issuer.issue_delegation_verifiable_credential(
            context,
            credential_id,
            valid_from,
            delegatee_id,
            validity_period,
            permissions,
            previous_vc,
        )?;

        let id = String::from("https://vc.example/delegators/d2");
        let previous_vc = Some(vc);
        let issuer: SdJWTIssuer = SdJWTIssuer::new(id, acc_sim.clone(), ecc_sim.clone())?;
        let context: Vec<String> = vec![String::from("https://www.w3.org/ns/credentials/v2")];
        let credential_id = String::from("http://delegation.example/credentials/1339");
        let valid_from = String::from("2026-01-01T00:00:00Z");
        let delegatee_id = String::from("https://vc.example/delegators/d3");
        let validity_period: Duration = Duration::new(3600, 0);
        let permissions: Vec<String> = vec![
            String::from("https://vc.example/resources/r1:p0"),
            String::from("https://vc.example/resources/r1:p1"),
        ];
        let vc = issuer.issue_delegation_verifiable_credential(
            context,
            credential_id,
            valid_from,
            delegatee_id,
            validity_period,
            permissions,
            previous_vc,
        )?;

        let id = String::from("https://vc.example/delegators/d3");
        let previous_vc = Some(vc);
        let issuer: SdJWTIssuer = SdJWTIssuer::new(id, acc_sim.clone(), ecc_sim.clone())?;
        let context: Vec<String> = vec![String::from("https://www.w3.org/ns/credentials/v2")];
        let credential_id = String::from("http://delegation.example/credentials/1340");
        let valid_from = String::from("2026-01-01T00:00:00Z");
        let delegatee_id = String::from("https://vc.example/delegators/d4");
        let validity_period: Duration = Duration::new(3600, 0);
        let permissions: Vec<String> = vec![String::from("https://vc.example/resources/r1:p0")];
        let vc = issuer.issue_delegation_verifiable_credential(
            context,
            credential_id,
            valid_from,
            delegatee_id,
            validity_period,
            permissions,
            previous_vc,
        )?;

        let vc_str = serde_json::to_string_pretty(&vc).unwrap();
        println!("{}", vc_str);

        Ok(())
    }

    #[test]
    fn issue_vp() -> Result<(), String> {
        let acc_sim: DLTSim<Jwk> = new_dlt_sim();
        let ecc_sim: DLTSim<Jwk> = new_dlt_sim();

        let id = String::from("https://vc.example/delegators/d0");
        let previous_vc = None;
        let issuer: SdJWTIssuer = SdJWTIssuer::new(id, acc_sim.clone(), ecc_sim.clone())?;
        let context: Vec<String> = vec![String::from("https://www.w3.org/ns/credentials/v2")];
        let credential_id = String::from("http://delegation.example/credentials/1337");
        let valid_from = String::from("2026-01-01T00:00:00Z");
        let delegatee_id = String::from("https://vc.example/delegators/d1");
        let validity_period: Duration = Duration::new(3600, 0);
        let permissions: Vec<String> = vec![
            String::from("https://vc.example/resources/r1:p0"),
            String::from("https://vc.example/resources/r1:p1"),
            String::from("https://vc.example/resources/r1:p2"),
        ];
        let vc = issuer.issue_delegation_verifiable_credential(
            context.clone(),
            credential_id,
            valid_from.clone(),
            delegatee_id,
            validity_period,
            permissions,
            previous_vc,
        )?;

        let id = String::from("https://vc.example/delegators/d1");
        let previous_vc = Some(vc);
        let issuer: SdJWTIssuer = SdJWTIssuer::new(id, acc_sim.clone(), ecc_sim.clone())?;
        let credential_id = String::from("http://delegation.example/credentials/1338");
        let delegatee_id = String::from("https://vc.example/delegators/d2");
        let permissions: Vec<String> = vec![
            String::from("https://vc.example/resources/r1:p0"),
            String::from("https://vc.example/resources/r1:p1"),
        ];
        let vc = issuer.issue_delegation_verifiable_credential(
            context.clone(),
            credential_id,
            valid_from.clone(),
            delegatee_id,
            validity_period,
            permissions,
            previous_vc,
        )?;

        let id = String::from("https://vc.example/delegators/d2");
        let previous_vc = Some(vc);
        let issuer: SdJWTIssuer = SdJWTIssuer::new(id, acc_sim.clone(), ecc_sim.clone())?;
        let credential_id = String::from("http://delegation.example/credentials/1339");
        let delegatee_id = String::from("https://vc.example/delegators/d3");
        let permissions: Vec<String> = vec![
            String::from("https://vc.example/resources/r1:p0"),
            String::from("https://vc.example/resources/r1:p1"),
        ];
        let vc = issuer.issue_delegation_verifiable_credential(
            context.clone(),
            credential_id,
            valid_from.clone(),
            delegatee_id,
            validity_period,
            permissions,
            previous_vc,
        )?;

        let disclosed_permissions: Vec<String> =
            vec![String::from("https://vc.example/resources/r1:p1")];
        let signed_vp =
            issuer.issue_delegation_verifiable_presentation(vc, disclosed_permissions)?;

        println!("{signed_vp}");
        println!("{}", signed_vp.len());

        Ok(())
    }
}
