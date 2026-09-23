use crate::delegation::credentials::sdjwt::sdjwt_efficient_delegation::SdJWTEfficientDelegation;
use crate::delegation::credentials::sdjwt::sdjwt_efficient_delegation_credential::SdJWTEfficientDelegationCredential;
use crate::delegation::credentials::verifiable_presentation::VerifiablePresentation;
use crate::delegation::entities::dtl_sim::DLTSim;
use crate::delegation::entities::sdjwt::sdjwt_utils;
use crate::delegation::entities::verifier::{Verifier, verify_timings};
use josekit::jwk::Jwk;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub struct SdJWTEfficientVerifier {
    issuer_dlt: DLTSim<Jwk>,
    holder_dlt: DLTSim<Jwk>,
}

impl Verifier<Jwk> for SdJWTEfficientVerifier {
    /// Creates an instance of an SdJWTVerifier structure.
    ///
    /// # Arguments
    /// * `issuer_dlt` - a reference to the DLT Simulator (a hashmap containing public keys) for
    /// the issuer's public keys.
    /// * `holder_dlt` - a reference to the DLT Simulator (a hashmap containing public keys) for
    /// the holder's public keys.
    ///
    /// # Returns
    /// A result containing either the instance of SdJWTVerifier or an error as a string in case of
    /// failure.
    fn new(issuer_dlt: DLTSim<Jwk>, holder_dlt: DLTSim<Jwk>) -> Result<Self, String> {
        Ok(SdJWTEfficientVerifier {
            issuer_dlt,
            holder_dlt,
        })
    }

    /// Verifies a VerifiablePresentation containing a SdJWTDelegationCredential.
    ///
    /// # Arguments
    /// * `presenter_id` - the id of the VP presenter.
    /// * `signed_jwt` - the signed JWT presented (that includes the VP).
    ///
    /// # Returns
    /// A result containing an error as a string in case of failure.
    fn verify_verifiable_presentation(
        &self,
        presenter_id: String,
        signed_jwt: String,
    ) -> Result<(), String> {
        let ecc_pk = match self.holder_dlt.borrow().get(&presenter_id) {
            None => return Err(format!("Could not find presenter {presenter_id} in DLTSim")),
            Some(ecc_pk) => ecc_pk.clone(),
        };

        let vp: VerifiablePresentation<SdJWTEfficientDelegationCredential> =
            VerifiablePresentation::<SdJWTEfficientDelegationCredential>::from_signed_jwt(
                signed_jwt, &ecc_pk,
            )?;
        let dc = vp.credential();

        let permissions = dc
            .permissions()
            .iter()
            .map(|s| s.clone())
            .collect::<Vec<String>>();

        let permission_salts = dc
            .permission_salts()
            .iter()
            .map(|s| s.clone())
            .collect::<Vec<String>>();

        let hashes = match dc.hashes() {
            None => return Err(String::from("The DC must provide hashes")),
            Some(hashes) => hashes.iter().map(|s| s.clone()).collect::<Vec<String>>(),
        };

        // Get now timestamp and convert it to nanoseconds
        let now: Duration = match SystemTime::now().duration_since(UNIX_EPOCH) {
            Ok(duration) => duration,
            Err(e) => return Err(format!("Error encountered in computing issuance time: {e}")),
        };
        let now_ns = now.as_nanos();

        // Assert:
        //  - the hierarchy is valid by using each permission and metadata
        //  - for each delegator in hierarchy, check that the issuer of the credential is the
        //    delegatee in the previous credential
        //  - every timing constraint is respected
        let hierarchy = dc.hierarchy();
        let mut previous: &String;
        let mut current: &String = vp.issuer();
        // !!! It's in reverse order !!!
        for delegator in hierarchy.iter().rev() {
            previous = delegator.delegatee_id();
            // Check that the current delegator is the delegatee in the previous credential
            if previous != current {
                return Err(format!(
                    "Previous delegator {previous} does not match current delegatee {current}"
                ));
            }

            // Verify the delegation credential
            self.verify_delegation(
                delegator,
                delegator.id(),
                &hashes,
                &permissions,
                &permission_salts,
                now_ns,
            )?;
            current = delegator.id();
        }
        self.verify_delegation(
            dc,
            &vp.issuer(),
            &hashes,
            &permissions,
            &permission_salts,
            now_ns,
        )?;

        Ok(())
    }
}

impl SdJWTEfficientVerifier {
    /// Private function useful to verify an SdJWTDelegationCredential.
    fn verify_delegation<D: SdJWTEfficientDelegation>(
        &self,
        delegation: &D,
        issuer: &String,
        hashes: &Vec<String>,
        permissions: &Vec<String>,
        permission_salts: &Vec<String>,
        now_ns: u128,
    ) -> Result<(), String> {
        // First, verify that timing constraints are indeed respected
        verify_timings(now_ns, delegation.iat(), delegation.exp())?;

        // Check for the issuer's public key and setup parameters in the dlt
        let issuer_jwk = match self.issuer_dlt.borrow().get(issuer) {
            None => return Err(format!("Could not find issuer {issuer} in DLTSim")),
            Some(entry) => entry.clone(),
        };

        // Re-compute each salted hash with the corresponding permission and salt.
        // Check that it is, in fact, included in the signed list.
        let mut hash: String;
        for (permission, salt) in permissions.iter().zip(permission_salts) {
            hash = sdjwt_utils::hash(permission, salt);
            if !hashes.contains(&hash) {
                return Err(
                    "Hash found in delegation is not included in the signed list of hashes"
                        .to_string(),
                );
            }
        }

        sdjwt_utils::verify_signature(
            &issuer_jwk,
            delegation.signature(),
            delegation.delegatee_id(),
            delegation.iat(),
            delegation.exp(),
            hashes,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delegation::entities::dtl_sim::new_dlt_sim;
    use crate::delegation::entities::issuer::Issuer;
    use crate::delegation::entities::sdjwt::sdjwt_efficient_issuer::SdJWTEfficientIssuer;
    use josekit::jwk::Jwk;
    use std::time::Duration;

    #[test]
    fn verify_vp() -> Result<(), String> {
        let issuer_dlt: DLTSim<Jwk> = new_dlt_sim();
        let holder_dlt: DLTSim<Jwk> = new_dlt_sim();

        let id = String::from("https://vc.example/delegators/d0");
        let previous_vc = None;
        let issuer: SdJWTEfficientIssuer =
            SdJWTEfficientIssuer::new(id, issuer_dlt.clone(), holder_dlt.clone())?;
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
            delegatee_id.clone(),
            validity_period,
            permissions,
            previous_vc,
        )?;

        // println!("{}", serde_json::to_string_pretty(&vc).unwrap());

        let id = String::from("https://vc.example/delegators/d1");
        let previous_vc = Some(vc);
        let issuer: SdJWTEfficientIssuer =
            SdJWTEfficientIssuer::new(id, issuer_dlt.clone(), holder_dlt.clone())?;
        let credential_id = String::from("http://delegation.example/credentials/1338");
        let delegatee_id = String::from("https://vc.example/delegators/d2");
        let validity_period: Duration = Duration::new(3600, 0);
        let permissions: Vec<String> = vec![
            String::from("https://vc.example/resources/r1:p0"),
            String::from("https://vc.example/resources/r1:p1"),
        ];
        let vc = issuer.issue_delegation_verifiable_credential(
            context.clone(),
            credential_id,
            valid_from.clone(),
            delegatee_id.clone(),
            validity_period,
            permissions,
            previous_vc,
        )?;

        // println!("{}", serde_json::to_string_pretty(&vc).unwrap());

        let id = String::from("https://vc.example/delegators/d2");
        let previous_vc = Some(vc);
        let issuer: SdJWTEfficientIssuer =
            SdJWTEfficientIssuer::new(id, issuer_dlt.clone(), holder_dlt.clone())?;
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
            delegatee_id.clone(),
            validity_period,
            permissions,
            previous_vc,
        )?;

        // println!("{}", serde_json::to_string_pretty(&vc).unwrap());

        let id = String::from("https://vc.example/delegators/d3");
        let previous_vc = Some(vc);
        let issuer: SdJWTEfficientIssuer =
            SdJWTEfficientIssuer::new(id, issuer_dlt.clone(), holder_dlt.clone())?;
        let credential_id = String::from("http://delegation.example/credentials/1340");
        let delegatee_id = String::from("https://vc.example/delegators/d4");
        let permissions: Vec<String> = vec![String::from("https://vc.example/resources/r1:p0")];
        let vc = issuer.issue_delegation_verifiable_credential(
            context.clone(),
            credential_id,
            valid_from.clone(),
            delegatee_id.clone(),
            validity_period,
            permissions,
            previous_vc,
        )?;

        // println!("{}", serde_json::to_string_pretty(&vc).unwrap());

        let id = delegatee_id.clone();
        let issuer: SdJWTEfficientIssuer =
            SdJWTEfficientIssuer::new(id.clone(), issuer_dlt.clone(), holder_dlt.clone())?;
        let disclosed_permissions: Vec<String> =
            vec![String::from("https://vc.example/resources/r1:p0")];

        let signed_vp =
            issuer.issue_delegation_verifiable_presentation(vc.clone(), disclosed_permissions)?;
        let verifier = SdJWTEfficientVerifier::new(issuer_dlt.clone(), holder_dlt.clone())?;
        verifier.verify_verifiable_presentation(id, signed_vp)?;

        Ok(())
    }
}
