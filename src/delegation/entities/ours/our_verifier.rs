use crate::delegation::authorization::authorization_request::AuthorizationRequest;
use crate::delegation::authorization::permission::Permission;
use crate::delegation::authorization::verified_delegation::VerifiedDelegation;
use crate::delegation::credentials::ours::our_delegation::OurDelegation;
use crate::delegation::credentials::ours::our_delegation_credential::OurDelegationCredential;
use crate::delegation::credentials::verifiable_presentation::VerifiablePresentation;
use crate::delegation::entities::dtl_sim::DLTSim;
use crate::delegation::entities::ours::accumulator_utils::AccumulatorUtils;
use crate::delegation::entities::ours::accumulator_verifier::AccumulatorVerifier;
use crate::delegation::entities::ours::dlt_acc_entry::DLTSimAccEntry;
use crate::delegation::entities::verifier::{Verifier, verify_timings};
use ark_ec::pairing::Pairing;
use josekit::jwk::Jwk;
use std::str::FromStr;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub struct OurVerifier<E: Pairing> {
    issuer_dlt: DLTSim<DLTSimAccEntry<E>>,
    holder_dlt: DLTSim<Jwk>,
}

impl<E: Pairing> Verifier<DLTSimAccEntry<E>> for OurVerifier<E> {
    /// Creates an instance of an OurVerifier structure (a verifier as proposed by our protocol).
    ///
    /// # Arguments
    /// * `accumulator_dlt` - a reference to the DLT Simulator (a hashmap containing public keys) for accumulators.
    /// * `verification_dlt` - a reference to the DLT Simulator (a hashmap containing public keys) for ECC signature schemes.
    ///
    /// # Returns
    /// A result containing either the instance of OurVerifier or an error as a string in case of failure.
    fn new(issuer_dlt: DLTSim<DLTSimAccEntry<E>>, holder_dlt: DLTSim<Jwk>) -> Result<Self, String>
    where
        Self: Sized,
    {
        Ok(OurVerifier {
            issuer_dlt,
            holder_dlt,
        })
    }

    /// Verifies a VerifiablePresentation containing a OurDelegationCredential.
    ///
    /// # Arguments
    /// * `presenter_id` - the id of the VP presenter.
    /// * `signed_jwt` - the signed JWT presented (that includes the VP).
    ///
    /// # Returns
    /// A result containing an error as a string in case of failure.
    fn verify_verifiable_presentation(
        &self,
        request: AuthorizationRequest,
        signed_jwt: String,
    ) -> Result<VerifiedDelegation, String> {
        let presenter_id = request.presenter_id();
        let ecc_pk = match self.holder_dlt.borrow().get(presenter_id) {
            None => return Err(format!("Could not find presenter {presenter_id} in DLTSim")),
            Some(ecc_pk) => ecc_pk.clone(),
        };

        let vp: VerifiablePresentation<OurDelegationCredential> =
            VerifiablePresentation::<OurDelegationCredential>::from_signed_jwt(
                signed_jwt, &ecc_pk,
            )?;
        let dc = vp.credential();

        if vp.holder() != presenter_id {
            return Err(format!(
                "VP holder {} does not match presenter {}",
                vp.holder(),
                presenter_id
            ));
        }

        if dc.delegatee_id() != presenter_id {
            return Err(format!(
                "Delegation credential belongs to {}, not to presenter {}",
                dc.delegatee_id(),
                presenter_id
            ));
        }

        if vp.audience() != request.audience() {
            return Err(format!(
                "VP audience {} does not match expected audience {}",
                vp.audience(),
                request.audience()
            ));
        }

        if vp.challenge() != request.challenge() {
            return Err(String::from(
                "VP challenge does not match the authorization request challenge",
            ));
        }

        let permissions = dc.permissions().clone();
        if !permissions.contains(request.required_permission()) {
            return Err(format!(
                "Required permission {} is not disclosed in the VP",
                request.required_permission()
            ));
        }

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
            self.verify_delegation(delegator, &delegator.id(), &permissions, now_ns)?;
            current = delegator.id();
        }
        self.verify_delegation(dc, &vp.issuer(), &permissions, now_ns)?;

        let expiration = match u128::from_str(dc.exp()) {
            Ok(expiration) => expiration,
            Err(err) => {
                return Err(format!(
                    "Could not parse verified credential expiration {} [{err}]",
                    dc.exp()
                ));
            }
        };

        Ok(VerifiedDelegation::new(
            presenter_id.clone(),
            vp.id().clone(),
            vp.issuer().clone(),
            permissions,
            hierarchy.len(),
            expiration,
        ))
    }
}

impl<E: Pairing> OurVerifier<E> {
    /// Private function useful to verify an OurDelegationCredential.
    fn verify_delegation<D: OurDelegation>(
        &self,
        delegation: &D,
        issuer: &String,
        permissions: &Vec<Permission>,
        now_ns: u128,
    ) -> Result<(), String> {
        // First, verify that timing constraints are indeed respected
        verify_timings(now_ns, delegation.iat(), delegation.exp())?;

        // Check for the issuer's public key and setup parameters in the dlt
        let entry = match self.issuer_dlt.borrow().get(issuer) {
            None => return Err(format!("Could not find issuer {issuer} in DLTSim")),
            Some(entry) => entry.clone(),
        };

        // Clone the accumulator value and all the witnesses from the delegation credential
        let accumulator_value = delegation.accumulator_value();
        let metadata_witness = delegation.metadata_witness();
        let metadata = AccumulatorUtils::<E>::map_metadata_to_string(vec![
            delegation.delegatee_id().clone(),
            delegation.iat().clone(),
            delegation.exp().clone(),
        ]);
        let permission_witnesses = delegation.permission_witnesses();
        let permission_values = permissions
            .iter()
            .map(Permission::canonical_value)
            .collect::<Vec<String>>();

        // Verify both metadata and permission witnesses
        let delegator_av = AccumulatorVerifier::new(
            accumulator_value.clone(),
            entry.public_key,
            entry.setup_params,
        )?;
        delegator_av.verify_accumulator_witness(metadata_witness, &metadata)?;
        delegator_av.verify_accumulator_witnesses(permission_witnesses, &permission_values)?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delegation::authorization::authorization_request::AuthorizationRequest;
    use crate::delegation::authorization::operation::Operation;
    use crate::delegation::entities::dtl_sim::new_dlt_sim;
    use crate::delegation::entities::issuer::Issuer;
    use crate::delegation::entities::ours::our_issuer::OurIssuer;
    use ark_bn254::Bn254;
    use josekit::jwk::Jwk;
    use std::time::Duration;

    fn permission(operation: Operation) -> Permission {
        Permission::new(
            String::from("https://gitea.local/repos/project-a"),
            operation,
        )
        .expect("test permission must be valid")
    }

    #[test]
    fn verify_vp() -> Result<(), String> {
        type Curve = Bn254;
        let accumulator_dlt: DLTSim<DLTSimAccEntry<Curve>> = new_dlt_sim();
        let verification_dlt: DLTSim<Jwk> = new_dlt_sim();

        let id = String::from("https://vc.example/delegators/d0");
        let previous_vc = None;
        let issuer: OurIssuer<Curve> =
            OurIssuer::new(id, accumulator_dlt.clone(), verification_dlt.clone())?;
        let context: Vec<String> = vec![String::from("https://www.w3.org/ns/credentials/v2")];
        let credential_id = String::from("http://delegation.example/credentials/1337");
        let valid_from = String::from("2026-01-01T00:00:00Z");
        let delegatee_id = String::from("https://vc.example/delegators/d1");
        let validity_period: Duration = Duration::new(3600, 0);
        let permissions: Vec<Permission> = vec![
            permission(Operation::ReadFile),
            permission(Operation::WriteFile),
            permission(Operation::CreateBranch),
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
        let issuer: OurIssuer<Bn254> =
            OurIssuer::new(id, accumulator_dlt.clone(), verification_dlt.clone())?;
        let context: Vec<String> = vec![String::from("https://www.w3.org/ns/credentials/v2")];
        let credential_id = String::from("http://delegation.example/credentials/1338");
        let valid_from = String::from("2026-01-01T00:00:00Z");
        let delegatee_id = String::from("https://vc.example/delegators/d2");
        let validity_period: Duration = Duration::new(3600, 0);
        let permissions: Vec<Permission> = vec![
            permission(Operation::ReadFile),
            permission(Operation::WriteFile),
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
        let issuer: OurIssuer<Bn254> =
            OurIssuer::new(id, accumulator_dlt.clone(), verification_dlt.clone())?;
        let credential_id = String::from("http://delegation.example/credentials/1339");
        let delegatee_id = String::from("https://vc.example/delegators/d3");
        let permissions: Vec<Permission> = vec![
            permission(Operation::ReadFile),
            permission(Operation::WriteFile),
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
        let issuer: OurIssuer<Bn254> =
            OurIssuer::new(id, accumulator_dlt.clone(), verification_dlt.clone())?;
        let credential_id = String::from("http://delegation.example/credentials/1340");
        let delegatee_id = String::from("https://vc.example/delegators/d4");
        let permissions: Vec<Permission> = vec![permission(Operation::ReadFile)];
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
        let issuer: OurIssuer<Bn254> = OurIssuer::new(
            id.clone(),
            accumulator_dlt.clone(),
            verification_dlt.clone(),
        )?;

        let disclosed_permissions: Vec<Permission> = vec![permission(Operation::ReadFile)];
        let audience = String::from("cloud-access-gateway");
        let challenge = String::from("challenge-1");
        let signed_vp = issuer.issue_delegation_verifiable_presentation(
            vc,
            disclosed_permissions,
            audience.clone(),
            challenge.clone(),
        )?;

        let verifier = OurVerifier::new(accumulator_dlt, verification_dlt)?;
        let request = AuthorizationRequest::new(
            id.clone(),
            audience,
            challenge,
            permission(Operation::ReadFile),
        )?;
        let verified = verifier.verify_verifiable_presentation(request, signed_vp)?;

        assert_eq!(verified.presenter_id(), &id);
        assert_eq!(
            verified.permissions(),
            &vec![permission(Operation::ReadFile)]
        );
        assert_eq!(verified.hierarchy_depth(), 3);

        Ok(())
    }

    #[test]
    fn rejects_wrong_audience() -> Result<(), String> {
        type Curve = Bn254;
        let accumulator_dlt: DLTSim<DLTSimAccEntry<Curve>> = new_dlt_sim();
        let verification_dlt: DLTSim<Jwk> = new_dlt_sim();

        let root = OurIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d0"),
            accumulator_dlt.clone(),
            verification_dlt.clone(),
        )?;

        let holder_id = String::from("https://vc.example/delegators/d1");
        let vc = root.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/audience-test"),
            String::from("2026-01-01T00:00:00Z"),
            holder_id.clone(),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            None,
        )?;

        let holder = OurIssuer::<Curve>::new(
            holder_id.clone(),
            accumulator_dlt.clone(),
            verification_dlt.clone(),
        )?;
        let signed_vp = holder.issue_delegation_verifiable_presentation(
            vc,
            vec![permission(Operation::ReadFile)],
            String::from("gateway-a"),
            String::from("challenge-a"),
        )?;

        let verifier = OurVerifier::new(accumulator_dlt, verification_dlt)?;
        let request = AuthorizationRequest::new(
            holder_id,
            String::from("gateway-b"),
            String::from("challenge-a"),
            permission(Operation::ReadFile),
        )?;

        assert!(
            verifier
                .verify_verifiable_presentation(request, signed_vp)
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn rejects_wrong_challenge() -> Result<(), String> {
        type Curve = Bn254;
        let accumulator_dlt: DLTSim<DLTSimAccEntry<Curve>> = new_dlt_sim();
        let verification_dlt: DLTSim<Jwk> = new_dlt_sim();

        let root = OurIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d0"),
            accumulator_dlt.clone(),
            verification_dlt.clone(),
        )?;

        let holder_id = String::from("https://vc.example/delegators/d1");
        let vc = root.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/challenge-test"),
            String::from("2026-01-01T00:00:00Z"),
            holder_id.clone(),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            None,
        )?;

        let holder = OurIssuer::<Curve>::new(
            holder_id.clone(),
            accumulator_dlt.clone(),
            verification_dlt.clone(),
        )?;
        let signed_vp = holder.issue_delegation_verifiable_presentation(
            vc,
            vec![permission(Operation::ReadFile)],
            String::from("cloud-access-gateway"),
            String::from("challenge-a"),
        )?;

        let verifier = OurVerifier::new(accumulator_dlt, verification_dlt)?;
        let request = AuthorizationRequest::new(
            holder_id,
            String::from("cloud-access-gateway"),
            String::from("challenge-b"),
            permission(Operation::ReadFile),
        )?;

        assert!(
            verifier
                .verify_verifiable_presentation(request, signed_vp)
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn rejects_permission_not_disclosed() -> Result<(), String> {
        type Curve = Bn254;
        let accumulator_dlt: DLTSim<DLTSimAccEntry<Curve>> = new_dlt_sim();
        let verification_dlt: DLTSim<Jwk> = new_dlt_sim();

        let root = OurIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d0"),
            accumulator_dlt.clone(),
            verification_dlt.clone(),
        )?;

        let holder_id = String::from("https://vc.example/delegators/d1");
        let vc = root.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/permission-test"),
            String::from("2026-01-01T00:00:00Z"),
            holder_id.clone(),
            Duration::new(3600, 0),
            vec![
                permission(Operation::ReadFile),
                permission(Operation::WriteFile),
            ],
            None,
        )?;

        let holder = OurIssuer::<Curve>::new(
            holder_id.clone(),
            accumulator_dlt.clone(),
            verification_dlt.clone(),
        )?;
        let signed_vp = holder.issue_delegation_verifiable_presentation(
            vc,
            vec![permission(Operation::ReadFile)],
            String::from("cloud-access-gateway"),
            String::from("challenge-a"),
        )?;

        let verifier = OurVerifier::new(accumulator_dlt, verification_dlt)?;
        let request = AuthorizationRequest::new(
            holder_id,
            String::from("cloud-access-gateway"),
            String::from("challenge-a"),
            permission(Operation::WriteFile),
        )?;

        assert!(
            verifier
                .verify_verifiable_presentation(request, signed_vp)
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn rejects_presenter_that_is_not_delegatee() -> Result<(), String> {
        type Curve = Bn254;
        let accumulator_dlt: DLTSim<DLTSimAccEntry<Curve>> = new_dlt_sim();
        let verification_dlt: DLTSim<Jwk> = new_dlt_sim();

        let root = OurIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d0"),
            accumulator_dlt.clone(),
            verification_dlt.clone(),
        )?;

        let vc = root.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/holder-test"),
            String::from("2026-01-01T00:00:00Z"),
            String::from("https://vc.example/delegators/d1"),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            None,
        )?;

        let attacker_id = String::from("https://vc.example/delegators/d2");
        let attacker = OurIssuer::<Curve>::new(
            attacker_id.clone(),
            accumulator_dlt.clone(),
            verification_dlt.clone(),
        )?;

        let vp = VerifiablePresentation::from_verifiable_credential(
            vc,
            vec![permission(Operation::ReadFile)],
            attacker_id.clone(),
            String::from("cloud-access-gateway"),
            String::from("challenge-a"),
        )?;
        let signed_vp = vp.to_signed_jwt(attacker.holder_jwk())?;

        let verifier = OurVerifier::new(accumulator_dlt, verification_dlt)?;
        let request = AuthorizationRequest::new(
            attacker_id,
            String::from("cloud-access-gateway"),
            String::from("challenge-a"),
            permission(Operation::ReadFile),
        )?;

        assert!(
            verifier
                .verify_verifiable_presentation(request, signed_vp)
                .is_err()
        );
        Ok(())
    }
}
