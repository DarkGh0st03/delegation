use crate::delegation::authorization::permission::Permission;
use crate::delegation::credentials::ours::our_delegation::OurDelegation;
use crate::delegation::credentials::ours::our_delegation_credential::OurDelegationCredential;
use crate::delegation::credentials::ours::our_delegator::OurDelegator;
use crate::delegation::credentials::verifiable_credential::VerifiableCredential;
use crate::delegation::credentials::verifiable_presentation::VerifiablePresentation;
use crate::delegation::entities::issuer::Issuer;
use crate::delegation::entities::ours::accumulator_manager::AccumulatorManager;
use crate::delegation::entities::ours::accumulator_utils::AccumulatorUtils;
use crate::delegation::status::bitstring_status_list_entry::BitstringStatusListEntry;
use crate::delegation::trust::accumulator_public_data::AccumulatorPublicData;
use crate::delegation::trust::trust_registry::TrustRegistryRef;
use ark_ec::pairing::Pairing;
use ark_std::rand::prelude::StdRng;
use ark_std::rand::{RngCore, SeedableRng};
use ed25519_dalek::{SecretKey, SigningKey};
use josekit::jwk::Jwk;
use multibase::Base::Base64Url;
use serde_json::Value;
use std::str::FromStr;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use vb_accumulator::prelude::{Keypair, SetupParams};

pub struct OurIssuer<E: Pairing> {
    id: String,
    params: SetupParams<E>,
    acc_keypair: Keypair<E>,
    signature_jwk: Jwk,
}

impl<E: Pairing> Issuer<E, OurDelegationCredential> for OurIssuer<E> {
    /// Creates a new OurIssuer structure. The VC issuer of our proposed protocol.
    ///
    /// # Arguments
    /// * `id` - the issuer's unique id.
    /// * `trust_registry` - shared registry used to publish the issuer's public verification material.
    ///
    /// # Returns
    /// A result containing either the instance of OurIssuer or an error as a string in case of failure.
    fn new(id: String, trust_registry: TrustRegistryRef<E>) -> Result<Self, String> {
        trust_registry.register_identity(id.clone())?;

        let mut rng: StdRng = StdRng::from_entropy();
        let params = SetupParams::<E>::generate_using_rng(&mut rng);
        let acc_keypair = Keypair::<E>::generate_using_rng(&mut rng, &params);

        let entry = AccumulatorPublicData::new(acc_keypair.public_key.clone(), params.clone());
        trust_registry.publish_accumulator_data(id.clone(), entry)?;

        let mut sk: SecretKey = [0u8; 32];
        // let signing_algorithm = String::from("EdDSA");

        // =====================================================
        // Ed25519 SIGNATURE - Public and Private Key generation
        // =====================================================
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

        // Publish only the public verification key. The private parameter is kept locally.
        let public_signature_jwk = signature_jwk.clone();
        trust_registry.publish_verification_key(id.clone(), public_signature_jwk)?;

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

        Ok(OurIssuer {
            id,
            params,
            acc_keypair,
            signature_jwk,
        })
    }

    /// Issues a VerifiableCredential containing a OurDelegationCredential.
    ///
    /// # Arguments
    /// * `context` - array of strings containing the context for the VC.
    /// * `credential_id` - unique identifier of the VC.
    /// * `credential_status` - W3C Bitstring Status List entry associated with the new VC.
    /// * `valid_from` - string containing the validity of the VC.
    /// * `delegatee_id` - string containing the subject of the credential (the delegatee).
    /// * `validity_period` - duration for which the credential can be used.
    /// * `permissions` - structured resource/operation permissions given to the delegatee.
    /// * `optional_issuer_vc` - if the issuer is a root delegator (i.e.: the owner of the resource), this might be set to None. Otherwise, if the issuer has received permissions on their own, they must prove that the permissions he delegates are in fact given by someone else by means of another DelegationCredential.
    ///
    /// # Returns
    /// A result containing either the VerifiableCredential or an error as a string in case of failure.
    fn issue_delegation_verifiable_credential(
        &self,
        context: Vec<String>,
        credential_id: String,
        credential_status: BitstringStatusListEntry,
        valid_from: String,
        delegatee_id: String,
        validity_period: Duration,
        permissions: Vec<Permission>,
        optional_issuer_vc: Option<VerifiableCredential<OurDelegationCredential>>,
    ) -> Result<VerifiableCredential<OurDelegationCredential>, String> {
        // Validity_period refers to a short-lived credential: since its issuance moment, the delegation
        // credential could be valid for a month, a week, a day, or anything really.

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

        // A non-root issuer may only delegate from a credential issued to itself.
        // The child expiration is also capped by both the immediate parent credential and
        // every earlier delegation in the hierarchy.
        if let Some(vc) = &optional_issuer_vc {
            if vc.credential().delegatee_id() != &self.id {
                return Err(format!(
                    "Previous Delegation Credential belongs to {}, not to current issuer {}",
                    vc.credential().delegatee_id(),
                    self.id
                ));
            }

            let parent_exp = match u128::from_str(vc.credential().exp()) {
                Ok(parent_exp) => parent_exp,
                Err(err) => {
                    return Err(format!(
                        "Could not parse parent credential exp {} [{err}]",
                        vc.credential().exp()
                    ));
                }
            };

            if parent_exp < numeric_exp {
                numeric_exp = parent_exp;
                exp = numeric_exp.to_string();
            }

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

        // Generate an AccumulatorManager to simplify the steps for accumulating claims
        let mut am = AccumulatorManager::<E>::new(&self.acc_keypair.secret_key, &self.params);

        // Convert each permission into a scalar
        let mut permission_scalars: Vec<E::ScalarField> = vec![];
        for permission in &permissions {
            let canonical_permission = permission.canonical_value();
            permission_scalars.push(AccumulatorUtils::<E>::convert_string_to_scalar(
                &canonical_permission,
            ));
        }

        // Convert each metadata into a scalar

        let metadata_vector: Vec<String> = vec![
            credential_id.clone(),
            delegatee_id.clone(),
            iat.clone(),
            exp.clone(),
            credential_status.canonical_value(),
        ];
        let metadata_string: String =
            AccumulatorUtils::<E>::map_metadata_to_string(metadata_vector);
        let metadata_element: E::ScalarField =
            AccumulatorUtils::<E>::convert_string_to_scalar(&metadata_string);

        // Accumulate every scalar
        am.add_elements(permission_scalars.clone())?;
        am.add_element(metadata_element.clone())?;

        // Retrieve the accumulated value
        let accumulator_value = am.clone_accumulator()?;

        // Compute each witness
        let metadata_witness = am.compute_witness(metadata_element)?;
        let permission_witnesses: Vec<String> =
            am.compute_witnesses(permission_scalars.as_slice())?;

        match optional_issuer_vc {
            // If the issued credential is from the root delegator, we simply set the hierarchy to an
            // empty array.
            None => {
                let hierarchy: Vec<OurDelegator> = vec![];
                let dc = OurDelegationCredential::new(
                    delegatee_id,
                    accumulator_value,
                    iat,
                    exp,
                    permissions,
                    metadata_witness,
                    permission_witnesses,
                    hierarchy,
                )?;
                let vc = VerifiableCredential::new_with_status(
                    context,
                    credential_id,
                    issuer,
                    valid_from,
                    credential_status,
                    dc,
                );
                Ok(vc)
            }

            // If not, we have to check that the permissions are indeed included in previously
            // issued credentials and filter out the permissions and witnesses to grant
            Some(issuer_vc) => {
                let issuer_dc = issuer_vc.credential();
                let mut issuer_permissions = issuer_dc.permissions().clone();
                let mut issuer_permission_witnesses = issuer_dc.permission_witnesses().clone();

                // Permissions are only available in the VC, not in hierarchy, so no need to check those
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
                // We check that the issuer's permissions have the same cardinality of the witnesses
                if issuer_permissions_size != issuer_permission_witnesses.len() {
                    return Err(format!(
                        "Witnesses and permissions have different cardinality [{} - {}]",
                        issuer_permissions_size,
                        issuer_permission_witnesses.len()
                    ));
                }
                // We check that every delegator in the hierarchy has an amount of witnesses that
                // is equal to the number of permissions that the issuer has
                for delegator in issuer_hierarchy.iter() {
                    if issuer_permissions_size != delegator.permission_witnesses().len() {
                        return Err(format!(
                            "Delegation Credential is not well formatted: delegator contains more witnesses than the permits the credential grants [{} - {}]",
                            issuer_permissions_size,
                            delegator.permission_witnesses().len()
                        ));
                    }
                }

                // If the delegation credential does have more permissions than the previous one,
                // it incurs in an error
                if permissions_size > issuer_permissions_size {
                    return Err(format!(
                        "Cannot grant more permissions than those included in the previous Delegation Credential [{} < {}]",
                        permissions_size, issuer_permissions_size
                    ));
                }
                // Otherwise, if it has fewer permissions than the previous one, we must filter out
                // the unnecessary permissions and witnesses from the previous one (and its hierarchy)
                // We assume here that permissions are granted in the same order as the previous ones
                else if permissions_size < issuer_permissions_size {
                    let mut removable_indices: Vec<usize> = vec![];

                    // For every issuer permission check whether it is contained in the permissions
                    // to be delegated. If not, add it to an array of indices to be removed
                    for (i, issuer_permission) in issuer_permissions.iter().enumerate() {
                        if !permissions.contains(&issuer_permission) {
                            removable_indices.push(i);
                        }
                    }

                    // Remove indices from issuer permissions, issuer witnesses, and delegator
                    // witnesses contained in hierarchy
                    for i in removable_indices.iter().rev() {
                        issuer_permissions.remove(*i);
                        issuer_permission_witnesses.remove(*i);

                        for delegator in issuer_hierarchy.iter_mut() {
                            delegator.remove_permission_witness(*i)?;
                        }
                    }
                }

                let issuer_credential_status =
                    issuer_vc.credential_status().cloned().ok_or_else(|| {
                        String::from("Previous Delegation Credential has no credentialStatus")
                    })?;

                let issuer_delegator = OurDelegator::new(
                    issuer_vc.issuer().clone(),
                    issuer_vc.id().clone(),
                    issuer_credential_status,
                    issuer_dc.delegatee_id().clone(), // should be equal to self.id
                    issuer_dc.iat().clone(),
                    issuer_dc.exp().clone(),
                    issuer_dc.accumulator_value().clone(),
                    issuer_dc.metadata_witness().clone(),
                    issuer_permission_witnesses.clone(),
                );
                issuer_hierarchy.push(issuer_delegator);

                let result_dc = OurDelegationCredential::new(
                    delegatee_id,
                    accumulator_value,
                    iat,
                    exp,
                    permissions,
                    metadata_witness,
                    permission_witnesses,
                    issuer_hierarchy.clone(),
                )?;

                let result_vc = VerifiableCredential::new_with_status(
                    context,
                    credential_id,
                    issuer,
                    valid_from,
                    credential_status,
                    result_dc,
                );

                Ok(result_vc)
            }
        }
    }

    fn holder_id(&self) -> &String {
        &self.id
    }

    fn holder_jwk(&self) -> &Jwk {
        &self.signature_jwk
    }

    /// Given a VerifiableCredential and an array of permissions to disclose, issues a VerifiablePresentation.
    ///
    /// # Arguments
    /// * `vc` - VerifiableCredential to disclose permissions from.
    /// * `disclosed_permissions` - structured permissions to disclose.
    ///
    /// # Returns
    /// A result containing either the VerifiablePresentation or an error as a string in case of failure.
    fn issue_delegation_verifiable_presentation(
        &self,
        vc: VerifiableCredential<OurDelegationCredential>,
        disclosed_permissions: Vec<Permission>,
        audience: String,
        challenge: String,
    ) -> Result<String, String> {
        if vc.credential().delegatee_id() != &self.id {
            return Err(format!(
                "Cannot present credential delegated to {} as holder {}",
                vc.credential().delegatee_id(),
                self.id
            ));
        }

        let vp: VerifiablePresentation<OurDelegationCredential> =
            VerifiablePresentation::from_verifiable_credential(
                vc,
                disclosed_permissions,
                self.id.clone(),
                audience,
                challenge,
            )?;

        vp.to_signed_jwt(&self.signature_jwk)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delegation::authorization::operation::Operation;
    use crate::delegation::status::bitstring_status_list_entry::BitstringStatusListEntry;
    use crate::delegation::trust::in_memory_trust_registry::InMemoryTrustRegistry;
    use crate::delegation::trust::trust_registry::TrustRegistryRef;
    use ark_bn254::Bn254;
    use std::rc::Rc;

    fn test_status(index: u64) -> BitstringStatusListEntry {
        BitstringStatusListEntry::revocation(
            None,
            index.to_string(),
            String::from("https://status.example/lists/revocation-1"),
        )
        .expect("test status entry must be valid")
    }

    fn permission(operation: Operation) -> Permission {
        Permission::new(
            String::from("https://gitea.local/repos/project-a"),
            operation,
        )
        .expect("test permission must be valid")
    }

    #[test]
    fn issue_vc() -> Result<(), String> {
        type Curve = Bn254;
        let trust_registry: TrustRegistryRef<Curve> =
            Rc::new(InMemoryTrustRegistry::<Curve>::new());

        let id = String::from("https://vc.example/delegators/d0");
        let previous_vc = None;
        let issuer: OurIssuer<Curve> = OurIssuer::new(id, trust_registry.clone())?;
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
            test_status(1),
            valid_from,
            delegatee_id,
            validity_period,
            permissions,
            previous_vc,
        )?;

        let id = String::from("https://vc.example/delegators/d1");
        let previous_vc = Some(vc);
        let issuer: OurIssuer<Bn254> = OurIssuer::new(id, trust_registry.clone())?;
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
            context,
            credential_id,
            test_status(2),
            valid_from,
            delegatee_id,
            validity_period,
            permissions,
            previous_vc,
        )?;

        let id = String::from("https://vc.example/delegators/d2");
        let previous_vc = Some(vc);
        let issuer: OurIssuer<Bn254> = OurIssuer::new(id, trust_registry.clone())?;
        let context: Vec<String> = vec![String::from("https://www.w3.org/ns/credentials/v2")];
        let credential_id = String::from("http://delegation.example/credentials/1339");
        let valid_from = String::from("2026-01-01T00:00:00Z");
        let delegatee_id = String::from("https://vc.example/delegators/d3");
        let validity_period: Duration = Duration::new(3600, 0);
        let permissions: Vec<Permission> = vec![
            permission(Operation::ReadFile),
            permission(Operation::WriteFile),
        ];
        let vc = issuer.issue_delegation_verifiable_credential(
            context,
            credential_id,
            test_status(3),
            valid_from,
            delegatee_id,
            validity_period,
            permissions,
            previous_vc,
        )?;

        let id = String::from("https://vc.example/delegators/d3");
        let previous_vc = Some(vc);
        let issuer: OurIssuer<Bn254> = OurIssuer::new(id, trust_registry.clone())?;
        let context: Vec<String> = vec![String::from("https://www.w3.org/ns/credentials/v2")];
        let credential_id = String::from("http://delegation.example/credentials/1340");
        let valid_from = String::from("2026-01-01T00:00:00Z");
        let delegatee_id = String::from("https://vc.example/delegators/d4");
        let validity_period: Duration = Duration::new(3600, 0);
        let permissions: Vec<Permission> = vec![permission(Operation::ReadFile)];
        let vc = issuer.issue_delegation_verifiable_credential(
            context,
            credential_id,
            test_status(4),
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
        type Curve = Bn254;
        let trust_registry: TrustRegistryRef<Curve> =
            Rc::new(InMemoryTrustRegistry::<Curve>::new());

        let id = String::from("https://vc.example/delegators/d0");
        let previous_vc = None;
        let issuer: OurIssuer<Curve> = OurIssuer::new(id, trust_registry.clone())?;
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
            context.clone(),
            credential_id,
            test_status(5),
            valid_from.clone(),
            delegatee_id,
            validity_period,
            permissions,
            previous_vc,
        )?;

        let id = String::from("https://vc.example/delegators/d1");
        let previous_vc = Some(vc);
        let issuer: OurIssuer<Bn254> = OurIssuer::new(id, trust_registry.clone())?;
        let credential_id = String::from("http://delegation.example/credentials/1338");
        let delegatee_id = String::from("https://vc.example/delegators/d2");
        let permissions: Vec<Permission> = vec![
            permission(Operation::ReadFile),
            permission(Operation::WriteFile),
        ];
        let vc = issuer.issue_delegation_verifiable_credential(
            context.clone(),
            credential_id,
            test_status(6),
            valid_from.clone(),
            delegatee_id,
            validity_period,
            permissions,
            previous_vc,
        )?;

        let id = String::from("https://vc.example/delegators/d2");
        let previous_vc = Some(vc);
        let issuer: OurIssuer<Bn254> = OurIssuer::new(id, trust_registry.clone())?;
        let credential_id = String::from("http://delegation.example/credentials/1339");
        let delegatee_id = String::from("https://vc.example/delegators/d3");
        let permissions: Vec<Permission> = vec![
            permission(Operation::ReadFile),
            permission(Operation::WriteFile),
        ];
        let vc = issuer.issue_delegation_verifiable_credential(
            context.clone(),
            credential_id,
            test_status(7),
            valid_from.clone(),
            delegatee_id,
            validity_period,
            permissions,
            previous_vc,
        )?;

        let holder = OurIssuer::<Bn254>::new(
            String::from("https://vc.example/delegators/d3"),
            trust_registry.clone(),
        )?;

        let disclosed_permissions: Vec<Permission> = vec![permission(Operation::WriteFile)];
        let signed_vp = holder.issue_delegation_verifiable_presentation(
            vc,
            disclosed_permissions,
            String::from("cloud-access-gateway"),
            String::from("challenge-1"),
        )?;

        println!("{signed_vp}");
        println!("{}", signed_vp.len());

        Ok(())
    }

    #[test]
    fn rejects_subdelegation_with_foreign_credential() -> Result<(), String> {
        type Curve = Bn254;
        let trust_registry: TrustRegistryRef<Curve> =
            Rc::new(InMemoryTrustRegistry::<Curve>::new());

        let root = OurIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d0"),
            trust_registry.clone(),
        )?;

        let foreign_vc = root.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/foreign"),
            test_status(8),
            String::from("2026-01-01T00:00:00Z"),
            String::from("https://vc.example/delegators/d1"),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            None,
        )?;

        let attacker = OurIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d2"),
            trust_registry.clone(),
        )?;

        let result = attacker.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/invalid-child"),
            test_status(9),
            String::from("2026-01-01T00:00:00Z"),
            String::from("https://vc.example/delegators/d3"),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            Some(foreign_vc),
        );

        assert!(result.is_err());
        Ok(())
    }

    #[test]
    fn child_expiration_is_capped_by_immediate_parent() -> Result<(), String> {
        type Curve = Bn254;
        let trust_registry: TrustRegistryRef<Curve> =
            Rc::new(InMemoryTrustRegistry::<Curve>::new());

        let root = OurIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d0"),
            trust_registry.clone(),
        )?;

        let parent_vc = root.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/parent"),
            test_status(10),
            String::from("2026-01-01T00:00:00Z"),
            String::from("https://vc.example/delegators/d1"),
            Duration::new(60, 0),
            vec![permission(Operation::ReadFile)],
            None,
        )?;

        let parent_exp = parent_vc.credential().exp().clone();

        let child_issuer = OurIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d1"),
            trust_registry.clone(),
        )?;

        let child_vc = child_issuer.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/child"),
            test_status(11),
            String::from("2026-01-01T00:00:00Z"),
            String::from("https://vc.example/delegators/d2"),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            Some(parent_vc),
        )?;

        assert_eq!(child_vc.credential().exp(), &parent_exp);
        Ok(())
    }

    #[test]
    fn propagates_parent_status_into_hierarchy() -> Result<(), String> {
        type Curve = Bn254;
        let trust_registry: TrustRegistryRef<Curve> =
            Rc::new(InMemoryTrustRegistry::<Curve>::new());

        let root = OurIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d0"),
            trust_registry.clone(),
        )?;

        let parent_status = test_status(800);
        let parent_vc = root.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/status-parent"),
            parent_status.clone(),
            String::from("2026-01-01T00:00:00Z"),
            String::from("https://vc.example/delegators/d1"),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            None,
        )?;
        let parent_credential_id = parent_vc.id().clone();

        let child_issuer = OurIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d1"),
            trust_registry.clone(),
        )?;
        let child_vc = child_issuer.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/status-child"),
            test_status(801),
            String::from("2026-01-01T00:00:00Z"),
            String::from("https://vc.example/delegators/d2"),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            Some(parent_vc),
        )?;

        let ancestor = child_vc
            .credential()
            .hierarchy()
            .first()
            .ok_or_else(|| String::from("Expected parent delegation in hierarchy"))?;

        assert_eq!(ancestor.credential_id(), &parent_credential_id);
        assert_eq!(ancestor.credential_status(), &parent_status);
        Ok(())
    }
}
