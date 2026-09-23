use crate::delegation::credentials::ours::asymmetric_mechanism::AsymmetricMechanism;
use crate::delegation::credentials::ours::our_efficient_delegation::OurEfficientDelegation;
use crate::delegation::credentials::ours::our_efficient_delegation_credential::OurEfficientDelegationCredential;
use crate::delegation::credentials::verifiable_presentation::VerifiablePresentation;
use crate::delegation::entities::dtl_sim::DLTSim;
use crate::delegation::entities::ours::accumulator_utils::AccumulatorUtils;
use crate::delegation::entities::ours::accumulator_verifier::AccumulatorVerifier;
use crate::delegation::entities::ours::dlt_efficient_acc_entry::DLTSimEfficientAccEntry;
use crate::delegation::entities::ours::signature_utils::verify_signature;
use crate::delegation::entities::verifier::{Verifier, verify_timings};
use ark_ec::pairing::Pairing;
use josekit::jwk::Jwk;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub struct OurEfficientVerifier<E: Pairing> {
    issuer_dlt: DLTSim<DLTSimEfficientAccEntry<E>>,
    holder_dlt: DLTSim<Jwk>,
}

impl<E: Pairing> Verifier<DLTSimEfficientAccEntry<E>> for OurEfficientVerifier<E> {
    /// Creates an instance of an OurVerifier structure (a verifier as proposed by our protocol).
    ///
    /// # Arguments
    /// * `accumulator_dlt` - a reference to the DLT Simulator (a hashmap containing public keys) for accumulators.
    /// * `verification_dlt` - a reference to the DLT Simulator (a hashmap containing public keys) for ECC signature schemes.
    ///
    /// # Returns
    /// A result containing either the instance of OurVerifier or an error as a string in case of failure.
    fn new(
        issuer_dlt: DLTSim<DLTSimEfficientAccEntry<E>>,
        holder_dlt: DLTSim<Jwk>,
    ) -> Result<Self, String>
    where
        Self: Sized,
    {
        Ok(OurEfficientVerifier {
            issuer_dlt,
            holder_dlt,
        })
    }

    /// Verifies a VerifiablePresentation containing a OurEfficientDelegationCredential.
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
        let presentation_pk = match self.holder_dlt.borrow().get(&presenter_id) {
            None => return Err(format!("Could not find presenter {presenter_id} in DLTSim")),
            Some(ecc_pk) => ecc_pk.clone(),
        };

        let vp: VerifiablePresentation<OurEfficientDelegationCredential> =
            VerifiablePresentation::<OurEfficientDelegationCredential>::from_signed_jwt(
                signed_jwt,
                &presentation_pk,
            )?;
        let dc = vp.credential();

        let permissions = dc
            .permissions()
            .iter()
            .map(|s| s.clone())
            .collect::<Vec<String>>();

        // Get now timestamp and convert it to nanoseconds
        let now: Duration = match SystemTime::now().duration_since(UNIX_EPOCH) {
            Ok(duration) => duration,
            Err(e) => return Err(format!("Error encountered in computing issuance time: {e}")),
        };
        let now_ns = now.as_nanos();

        let mut optional_accumulator_value: Option<String> = None;
        let mut optional_metadata_witness: Option<String> = None;
        match dc.asymmetric_mechanism() {
            AsymmetricMechanism::Signature(_) => {
                for delegator in dc.hierarchy() {
                    match delegator.asymmetric_mechanism() {
                        AsymmetricMechanism::Signature(_) => {}
                        AsymmetricMechanism::Accumulator(
                            accumulator_value,
                            metadata_witness,
                            _,
                        ) => {
                            optional_accumulator_value = Some(accumulator_value.clone());
                            optional_metadata_witness = Some(metadata_witness.clone());
                            break;
                        }
                    }
                }
            }
            AsymmetricMechanism::Accumulator(accumulator_value, metadata_witness, _) => {
                optional_accumulator_value = Some(accumulator_value.clone());
                optional_metadata_witness = Some(metadata_witness.clone());
            }
        }

        if let None = optional_accumulator_value {
            return Err(
                "No valid accumulator setting has been found in the credential".to_string(),
            );
        }
        if let None = optional_metadata_witness {
            return Err("No valid metadata witness has been found in the credential".to_string());
        }
        let accumulator_value = optional_accumulator_value.unwrap();
        let metadata_witness = optional_metadata_witness.unwrap();

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
                &delegator.id(),
                &accumulator_value,
                &metadata_witness,
                &permissions,
                now_ns,
            )?;
            current = delegator.id();
        }

        self.verify_delegation(
            dc,
            &vp.issuer(),
            &accumulator_value,
            &metadata_witness,
            &permissions,
            now_ns,
        )?;

        Ok(())
    }
}

impl<E: Pairing> OurEfficientVerifier<E> {
    /// Private function useful to verify an OurEfficientDelegationCredential.
    fn verify_delegation<D: OurEfficientDelegation>(
        &self,
        delegation: &D,
        issuer: &String,
        accumulator_value: &String,
        metadata_witness: &String,
        permissions: &Vec<String>,
        now_ns: u128,
    ) -> Result<(), String> {
        // First, verify that timing constraints are indeed respected
        verify_timings(now_ns, delegation.iat(), delegation.exp())?;

        // Check for the issuer's public key and setup parameters in the dlt
        let entry = match self.issuer_dlt.borrow().get(issuer) {
            None => return Err(format!("Could not find issuer {issuer} in DLTSim")),
            Some(entry) => entry.clone(),
        };

        match delegation.asymmetric_mechanism() {
            AsymmetricMechanism::Signature(signature) => {
                verify_signature(
                    &entry.jwk,
                    signature,
                    delegation.delegatee_id(),
                    delegation.iat(),
                    delegation.exp(),
                    accumulator_value,
                    metadata_witness,
                )?;
            }
            AsymmetricMechanism::Accumulator(_, _, permission_witnesses) => {
                // Verify both metadata and permission witnesses
                let delegator_av = AccumulatorVerifier::new(
                    accumulator_value.clone(),
                    entry.public_key,
                    entry.setup_params,
                )?;

                let metadata = AccumulatorUtils::<E>::map_metadata_to_string(vec![
                    delegation.delegatee_id().clone(),
                    delegation.iat().clone(),
                    delegation.exp().clone(),
                ]);
                delegator_av.verify_accumulator_witness(metadata_witness, &metadata)?;

                delegator_av.verify_accumulator_witnesses(permission_witnesses, permissions)?;
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delegation::entities::dtl_sim::new_dlt_sim;
    use crate::delegation::entities::issuer::Issuer;
    use crate::delegation::entities::ours::our_efficient_issuer::OurEfficientIssuer;
    use ark_bn254::Bn254;
    use josekit::jwk::Jwk;
    use std::time::Duration;

    #[test]
    fn verify_vp() -> Result<(), String> {
        type Curve = Bn254;
        let accumulator_dlt: DLTSim<DLTSimEfficientAccEntry<Curve>> = new_dlt_sim();
        let verification_dlt: DLTSim<Jwk> = new_dlt_sim();

        let id = String::from("https://vc.example/delegators/d0");
        let previous_vc = None;
        let issuer: OurEfficientIssuer<Curve> =
            OurEfficientIssuer::new(id, accumulator_dlt.clone(), verification_dlt.clone())?;
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

        // println!("{}", serde_json::to_string_pretty(&vc).unwrap());

        let id = String::from("https://vc.example/delegators/d1");
        let previous_vc = Some(vc);
        let issuer: OurEfficientIssuer<Bn254> =
            OurEfficientIssuer::new(id, accumulator_dlt.clone(), verification_dlt.clone())?;
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
        let issuer: OurEfficientIssuer<Bn254> =
            OurEfficientIssuer::new(id, accumulator_dlt.clone(), verification_dlt.clone())?;
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
        let issuer: OurEfficientIssuer<Bn254> =
            OurEfficientIssuer::new(id, accumulator_dlt.clone(), verification_dlt.clone())?;
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
        let issuer: OurEfficientIssuer<Bn254> = OurEfficientIssuer::new(
            id.clone(),
            accumulator_dlt.clone(),
            verification_dlt.clone(),
        )?;

        let disclosed_permissions: Vec<String> =
            vec![String::from("https://vc.example/resources/r1:p0")];
        let signed_vp =
            issuer.issue_delegation_verifiable_presentation(vc, disclosed_permissions)?;

        let verifier = OurEfficientVerifier::new(accumulator_dlt, verification_dlt)?;
        verifier.verify_verifiable_presentation(id, signed_vp)?;

        Ok(())
    }
}
