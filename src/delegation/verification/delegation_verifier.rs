use crate::delegation::authorization::authorization_request::AuthorizationRequest;
use crate::delegation::authorization::permission::Permission;
use crate::delegation::authorization::verified_delegation::VerifiedDelegation;
use crate::delegation::credentials::delegation::delegation_evidence_trait::DelegationEvidence;
use crate::delegation::credentials::delegation::delegation_credential::DelegationCredential;
use crate::delegation::credentials::generic::verifiable_presentation::VerifiablePresentation;
use crate::delegation::accumulator::accumulator_utils::AccumulatorUtils;
use crate::delegation::accumulator::accumulator_verifier::AccumulatorVerifier;
use crate::delegation::verification::verifier_trait::Verifier;
use crate::delegation::verification::timing::verify_timings;
use crate::delegation::status::bitstring_status_list_entry::BitstringStatusListEntry;
use crate::delegation::status::status_list_resolver::StatusListResolverRef;
use crate::delegation::status::status_purpose::StatusPurpose;
use crate::delegation::trust::trust_registry::TrustRegistryRef;
use ark_ec::pairing::Pairing;
use std::str::FromStr;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub struct DelegationVerifier<E: Pairing> {
    trust_registry: TrustRegistryRef<E>,
    status_list_resolver: StatusListResolverRef,
}

impl<E: Pairing> Verifier<E> for DelegationVerifier<E> {
    /// Creates an instance of an DelegationVerifier structure (a verifier as proposed by our protocol).
    ///
    /// # Arguments
    /// * `trust_registry` - shared registry used to resolve public verification material.
    /// * `status_list_resolver` - resolver used to obtain the current status bit for every credential in the chain.
    ///
    /// # Returns
    /// A result containing either the instance of DelegationVerifier or an error as a string in case of failure.
    fn new(
        trust_registry: TrustRegistryRef<E>,
        status_list_resolver: StatusListResolverRef,
    ) -> Result<Self, String>
    where
        Self: Sized,
    {
        Ok(DelegationVerifier {
            trust_registry,
            status_list_resolver,
        })
    }

    /// Verifies a VerifiablePresentation containing a DelegationCredential.
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
        let ecc_pk = self.trust_registry.get_verification_key(presenter_id)?;

        let vp: VerifiablePresentation<DelegationCredential> =
            VerifiablePresentation::<DelegationCredential>::from_signed_jwt(
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
            self.verify_delegation(
                delegator,
                delegator.id(),
                delegator.credential_id(),
                delegator.credential_status(),
                &permissions,
                now_ns,
            )?;
            current = delegator.id();
        }
        let credential_status = vp.credential_status().ok_or_else(|| {
            String::from("Presented Delegation Credential has no credentialStatus")
        })?;
        self.verify_delegation(
            dc,
            vp.issuer(),
            vp.id(),
            credential_status,
            &permissions,
            now_ns,
        )?;

        // Registration alone is not sufficient for the root of authority.
        // The root issuer must be explicitly configured as a trust anchor.
        let root_issuer = hierarchy
            .first()
            .map(|delegator| delegator.id())
            .unwrap_or(vp.issuer());
        self.trust_registry.ensure_trust_anchor(root_issuer)?;

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

impl<E: Pairing> DelegationVerifier<E> {
    /// Private function useful to verify an DelegationCredential.
    fn verify_delegation<D: DelegationEvidence>(
        &self,
        delegation: &D,
        issuer: &String,
        credential_id: &String,
        credential_status: &BitstringStatusListEntry,
        permissions: &Vec<Permission>,
        now_ns: u128,
    ) -> Result<(), String> {
        // First, verify that timing constraints are indeed respected
        verify_timings(now_ns, delegation.iat(), delegation.exp())?;

        // Resolve the exact historical accumulator public-material version bound into
        // this delegation at issuance time.
        let entry = self
            .trust_registry
            .get_accumulator_data_at_version(issuer, delegation.issuer_material_version())?;

        // Clone the accumulator value and all the witnesses from the delegation credential
        let accumulator_value = delegation.accumulator_value();
        let metadata_witness = delegation.metadata_witness();
        let metadata = AccumulatorUtils::<E>::map_metadata_to_string(vec![
            credential_id.clone(),
            delegation.delegatee_id().clone(),
            delegation.iat().clone(),
            delegation.exp().clone(),
            delegation.issuer_material_version().to_string(),
            credential_status.canonical_value(),
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

        // Resolve status only after the status reference has been authenticated by the
        // accumulator metadata witness.
        self.verify_credential_status(issuer, credential_id, credential_status)?;

        Ok(())
    }

    fn verify_credential_status(
        &self,
        issuer: &String,
        credential_id: &String,
        credential_status: &BitstringStatusListEntry,
    ) -> Result<(), String> {
        match credential_status.status_purpose() {
            StatusPurpose::Message => Err(format!(
                "Credential {credential_id} uses unsupported message status purpose"
            )),
            StatusPurpose::Revocation => {
                if self
                    .status_list_resolver
                    .is_status_set_for_issuer(issuer, credential_status)?
                {
                    Err(format!("Credential {credential_id} is revoked"))
                } else {
                    Ok(())
                }
            }
            StatusPurpose::Suspension => {
                if self
                    .status_list_resolver
                    .is_status_set_for_issuer(issuer, credential_status)?
                {
                    Err(format!("Credential {credential_id} is suspended"))
                } else {
                    Ok(())
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delegation::authorization::authorization_request::AuthorizationRequest;
    use crate::delegation::authorization::operation::Operation;
    use crate::delegation::credentials::generic::verifiable_credential::VerifiableCredential;
    use crate::delegation::issuance::issuer_trait::Issuer;
    use crate::delegation::issuance::delegation_issuer::DelegationIssuer;
    use crate::delegation::status::bitstring_status_list_entry::BitstringStatusListEntry;
    use crate::delegation::status::in_memory_status_list_resolver::InMemoryStatusListResolver;
    use crate::delegation::trust::evm::evm_backed_trust_registry::EvmBackedTrustRegistry;
    use crate::delegation::trust::evm::evm_registry_reader::{
        AccumulatorMaterialAnchor, EvmTrustReader,
    };
    use crate::delegation::trust::identity_status::IdentityStatus;
    use crate::delegation::trust::in_memory_trust_registry::InMemoryTrustRegistry;
    use crate::delegation::trust::public_material_provider::InMemoryPublicMaterialProvider;
    use crate::delegation::trust::trust_registry::{TrustRegistry, TrustRegistryRef};
    use alloy::primitives::B256;
    use ark_bn254::Bn254;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::rc::Rc;
    use std::time::Duration;

    fn test_status(index: u64) -> BitstringStatusListEntry {
        BitstringStatusListEntry::revocation(
            None,
            index.to_string(),
            String::from("https://status.example/lists/revocation-1"),
        )
        .expect("test status entry must be valid")
    }

    fn resolver_for_vc(
        vc: &VerifiableCredential<DelegationCredential>,
    ) -> Result<Rc<InMemoryStatusListResolver>, String> {
        let resolver = Rc::new(InMemoryStatusListResolver::new());

        for delegator in vc.credential().hierarchy() {
            resolver.set_status(delegator.credential_status(), false);
        }

        let current_status = vc
            .credential_status()
            .ok_or_else(|| String::from("Test credential has no credentialStatus"))?;
        resolver.set_status(current_status, false);

        Ok(resolver)
    }

    fn permission(operation: Operation) -> Permission {
        Permission::new(
            String::from("https://gitea.local/repos/project-a"),
            operation,
        )
        .expect("test permission must be valid")
    }

    struct VerifierMockEvmTrustReader {
        statuses: RefCell<HashMap<String, IdentityStatus>>,
        trust_anchors: RefCell<HashMap<String, bool>>,
        latest_versions: RefCell<HashMap<String, u64>>,
        accumulator_anchors: RefCell<HashMap<(String, u64), AccumulatorMaterialAnchor>>,
    }

    impl VerifierMockEvmTrustReader {
        fn new() -> Self {
            Self {
                statuses: RefCell::new(HashMap::new()),
                trust_anchors: RefCell::new(HashMap::new()),
                latest_versions: RefCell::new(HashMap::new()),
                accumulator_anchors: RefCell::new(HashMap::new()),
            }
        }

        fn set_active(&self, identity_id: &str) {
            self.statuses
                .borrow_mut()
                .insert(identity_id.to_string(), IdentityStatus::Active);
        }

        fn set_trust_anchor(&self, identity_id: &str, trusted: bool) {
            self.trust_anchors
                .borrow_mut()
                .insert(identity_id.to_string(), trusted);
        }

        fn set_accumulator_anchor(&self, identity_id: &str, version: u64, material_hash: B256) {
            self.latest_versions
                .borrow_mut()
                .insert(identity_id.to_string(), version);
            self.accumulator_anchors.borrow_mut().insert(
                (identity_id.to_string(), version),
                AccumulatorMaterialAnchor {
                    material_hash,
                    published_at: 1,
                    exists: true,
                },
            );
        }
    }

    impl EvmTrustReader for VerifierMockEvmTrustReader {
        fn identity_status(&self, identity_id: &str) -> Result<IdentityStatus, String> {
            self.statuses
                .borrow()
                .get(identity_id)
                .copied()
                .ok_or_else(|| format!("Identity {identity_id} is not enrolled"))
        }

        fn is_trust_anchor(&self, identity_id: &str) -> Result<bool, String> {
            self.trust_anchors
                .borrow()
                .get(identity_id)
                .copied()
                .ok_or_else(|| format!("Identity {identity_id} is not enrolled"))
        }

        fn latest_accumulator_material_version(&self, issuer_id: &str) -> Result<u64, String> {
            Ok(*self.latest_versions.borrow().get(issuer_id).unwrap_or(&0))
        }

        fn accumulator_material_anchor(
            &self,
            issuer_id: &str,
            version: u64,
        ) -> Result<AccumulatorMaterialAnchor, String> {
            self.accumulator_anchors
                .borrow()
                .get(&(issuer_id.to_string(), version))
                .cloned()
                .ok_or_else(|| {
                    format!("No accumulator anchor for identity {issuer_id} version {version}")
                })
        }
    }

    #[test]
    fn verify_vp_with_evm_backed_trust_registry() -> Result<(), String> {
        type Curve = Bn254;

        // Issuance remains local in this checkpoint. We then move only the public
        // verification material behind the same off-chain/EVM split used in deployment.
        let source_registry = Rc::new(InMemoryTrustRegistry::<Curve>::new());
        let source_registry_ref: TrustRegistryRef<Curve> = source_registry.clone();

        let root_id = String::from("did:ethr:0x7a69:0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
        let holder_id = String::from("did:ethr:0x7a69:0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");

        let root = DelegationIssuer::<Curve>::new(root_id.clone(), source_registry_ref.clone())?;
        let vc = root.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/evm-backed"),
            test_status(950),
            String::from("2026-01-01T00:00:00Z"),
            holder_id.clone(),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            None,
        )?;

        let material_version = vc.credential().issuer_material_version();
        let root_material =
            source_registry.get_accumulator_data_at_version(&root_id, material_version)?;
        let root_commitment =
            EvmBackedTrustRegistry::<Curve>::accumulator_material_commitment(&root_material)?;

        let holder = DelegationIssuer::<Curve>::new(holder_id.clone(), source_registry_ref)?;
        let signed_vp = holder.issue_delegation_verifiable_presentation(
            vc.clone(),
            vec![permission(Operation::ReadFile)],
            String::from("cloud-access-gateway"),
            String::from("challenge-evm-backed"),
        )?;

        let public_material = Rc::new(InMemoryPublicMaterialProvider::<Curve>::new());
        public_material.insert_accumulator_data(
            root_id.clone(),
            material_version,
            root_material,
        )?;
        public_material.insert_verification_key(
            holder_id.clone(),
            source_registry.get_verification_key(&holder_id)?,
        )?;

        let chain = Rc::new(VerifierMockEvmTrustReader::new());
        chain.set_active(&root_id);
        chain.set_active(&holder_id);
        chain.set_trust_anchor(&root_id, true);
        chain.set_accumulator_anchor(&root_id, material_version, root_commitment);

        let evm_registry: TrustRegistryRef<Curve> =
            Rc::new(EvmBackedTrustRegistry::<Curve>::new(chain, public_material));
        let status_resolver = resolver_for_vc(&vc)?;
        let verifier = DelegationVerifier::new(evm_registry, status_resolver)?;

        let request = AuthorizationRequest::new(
            holder_id.clone(),
            String::from("cloud-access-gateway"),
            String::from("challenge-evm-backed"),
            permission(Operation::ReadFile),
        )?;

        let verified = verifier.verify_verifiable_presentation(request, signed_vp)?;

        assert_eq!(verified.presenter_id(), &holder_id);
        assert_eq!(verified.issuer_id(), &root_id);
        assert_eq!(
            verified.permissions(),
            &vec![permission(Operation::ReadFile)]
        );
        assert_eq!(verified.hierarchy_depth(), 0);

        Ok(())
    }

    #[test]
    fn verify_vp() -> Result<(), String> {
        type Curve = Bn254;
        let trust_registry: TrustRegistryRef<Curve> =
            Rc::new(InMemoryTrustRegistry::<Curve>::new());

        let id = String::from("https://vc.example/delegators/d0");
        let previous_vc = None;
        let issuer: DelegationIssuer<Curve> = DelegationIssuer::new(id, trust_registry.clone())?;
        trust_registry.set_trust_anchor(issuer.holder_id(), true)?;
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
            test_status(101),
            valid_from,
            delegatee_id,
            validity_period,
            permissions,
            previous_vc,
        )?;

        // println!("{}", serde_json::to_string_pretty(&vc).unwrap());

        let id = String::from("https://vc.example/delegators/d1");
        let previous_vc = Some(vc);
        let issuer: DelegationIssuer<Bn254> = DelegationIssuer::new(id, trust_registry.clone())?;
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
            test_status(102),
            valid_from.clone(),
            delegatee_id.clone(),
            validity_period,
            permissions,
            previous_vc,
        )?;

        // println!("{}", serde_json::to_string_pretty(&vc).unwrap());

        let id = String::from("https://vc.example/delegators/d2");
        let previous_vc = Some(vc);
        let issuer: DelegationIssuer<Bn254> = DelegationIssuer::new(id, trust_registry.clone())?;
        let credential_id = String::from("http://delegation.example/credentials/1339");
        let delegatee_id = String::from("https://vc.example/delegators/d3");
        let permissions: Vec<Permission> = vec![
            permission(Operation::ReadFile),
            permission(Operation::WriteFile),
        ];
        let vc = issuer.issue_delegation_verifiable_credential(
            context.clone(),
            credential_id,
            test_status(103),
            valid_from.clone(),
            delegatee_id.clone(),
            validity_period,
            permissions,
            previous_vc,
        )?;

        // println!("{}", serde_json::to_string_pretty(&vc).unwrap());

        let id = String::from("https://vc.example/delegators/d3");
        let previous_vc = Some(vc);
        let issuer: DelegationIssuer<Bn254> = DelegationIssuer::new(id, trust_registry.clone())?;
        let credential_id = String::from("http://delegation.example/credentials/1340");
        let delegatee_id = String::from("https://vc.example/delegators/d4");
        let permissions: Vec<Permission> = vec![permission(Operation::ReadFile)];
        let vc = issuer.issue_delegation_verifiable_credential(
            context.clone(),
            credential_id,
            test_status(104),
            valid_from.clone(),
            delegatee_id.clone(),
            validity_period,
            permissions,
            previous_vc,
        )?;

        // println!("{}", serde_json::to_string_pretty(&vc).unwrap());

        let status_resolver = resolver_for_vc(&vc)?;
        let id = delegatee_id.clone();
        let issuer: DelegationIssuer<Bn254> =
            DelegationIssuer::new(id.clone(), trust_registry.clone())?;

        let disclosed_permissions: Vec<Permission> = vec![permission(Operation::ReadFile)];
        let audience = String::from("cloud-access-gateway");
        let challenge = String::from("challenge-1");
        let signed_vp = issuer.issue_delegation_verifiable_presentation(
            vc,
            disclosed_permissions,
            audience.clone(),
            challenge.clone(),
        )?;

        let verifier = DelegationVerifier::new(trust_registry.clone(), status_resolver)?;
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
        let trust_registry: TrustRegistryRef<Curve> =
            Rc::new(InMemoryTrustRegistry::<Curve>::new());

        let root = DelegationIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d0"),
            trust_registry.clone(),
        )?;
        trust_registry.set_trust_anchor(root.holder_id(), true)?;

        let holder_id = String::from("https://vc.example/delegators/d1");
        let vc = root.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/audience-test"),
            test_status(105),
            String::from("2026-01-01T00:00:00Z"),
            holder_id.clone(),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            None,
        )?;

        let status_resolver = resolver_for_vc(&vc)?;
        let holder = DelegationIssuer::<Curve>::new(holder_id.clone(), trust_registry.clone())?;
        let signed_vp = holder.issue_delegation_verifiable_presentation(
            vc,
            vec![permission(Operation::ReadFile)],
            String::from("gateway-a"),
            String::from("challenge-a"),
        )?;

        let verifier = DelegationVerifier::new(trust_registry.clone(), status_resolver)?;
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
        let trust_registry: TrustRegistryRef<Curve> =
            Rc::new(InMemoryTrustRegistry::<Curve>::new());

        let root = DelegationIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d0"),
            trust_registry.clone(),
        )?;
        trust_registry.set_trust_anchor(root.holder_id(), true)?;

        let holder_id = String::from("https://vc.example/delegators/d1");
        let vc = root.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/challenge-test"),
            test_status(106),
            String::from("2026-01-01T00:00:00Z"),
            holder_id.clone(),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            None,
        )?;

        let status_resolver = resolver_for_vc(&vc)?;
        let holder = DelegationIssuer::<Curve>::new(holder_id.clone(), trust_registry.clone())?;
        let signed_vp = holder.issue_delegation_verifiable_presentation(
            vc,
            vec![permission(Operation::ReadFile)],
            String::from("cloud-access-gateway"),
            String::from("challenge-a"),
        )?;

        let verifier = DelegationVerifier::new(trust_registry.clone(), status_resolver)?;
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
        let trust_registry: TrustRegistryRef<Curve> =
            Rc::new(InMemoryTrustRegistry::<Curve>::new());

        let root = DelegationIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d0"),
            trust_registry.clone(),
        )?;
        trust_registry.set_trust_anchor(root.holder_id(), true)?;

        let holder_id = String::from("https://vc.example/delegators/d1");
        let vc = root.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/permission-test"),
            test_status(107),
            String::from("2026-01-01T00:00:00Z"),
            holder_id.clone(),
            Duration::new(3600, 0),
            vec![
                permission(Operation::ReadFile),
                permission(Operation::WriteFile),
            ],
            None,
        )?;

        let status_resolver = resolver_for_vc(&vc)?;
        let holder = DelegationIssuer::<Curve>::new(holder_id.clone(), trust_registry.clone())?;
        let signed_vp = holder.issue_delegation_verifiable_presentation(
            vc,
            vec![permission(Operation::ReadFile)],
            String::from("cloud-access-gateway"),
            String::from("challenge-a"),
        )?;

        let verifier = DelegationVerifier::new(trust_registry.clone(), status_resolver)?;
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
        let trust_registry: TrustRegistryRef<Curve> =
            Rc::new(InMemoryTrustRegistry::<Curve>::new());

        let root = DelegationIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d0"),
            trust_registry.clone(),
        )?;
        trust_registry.set_trust_anchor(root.holder_id(), true)?;

        let vc = root.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/holder-test"),
            test_status(108),
            String::from("2026-01-01T00:00:00Z"),
            String::from("https://vc.example/delegators/d1"),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            None,
        )?;

        let status_resolver = resolver_for_vc(&vc)?;
        let attacker_id = String::from("https://vc.example/delegators/d2");
        let attacker = DelegationIssuer::<Curve>::new(attacker_id.clone(), trust_registry.clone())?;

        let vp = VerifiablePresentation::from_verifiable_credential(
            vc,
            vec![permission(Operation::ReadFile)],
            attacker_id.clone(),
            String::from("cloud-access-gateway"),
            String::from("challenge-a"),
        )?;
        let signed_vp = vp.to_signed_jwt(attacker.holder_jwk())?;

        let verifier = DelegationVerifier::new(trust_registry.clone(), status_resolver)?;
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

    #[test]
    fn rejects_tampered_credential_status() -> Result<(), String> {
        type Curve = Bn254;
        let trust_registry: TrustRegistryRef<Curve> =
            Rc::new(InMemoryTrustRegistry::<Curve>::new());

        let root = DelegationIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d0"),
            trust_registry.clone(),
        )?;
        trust_registry.set_trust_anchor(root.holder_id(), true)?;

        let holder_id = String::from("https://vc.example/delegators/d1");
        let vc = root.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/status-binding-test"),
            test_status(900),
            String::from("2026-01-01T00:00:00Z"),
            holder_id.clone(),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            None,
        )?;

        let status_resolver = resolver_for_vc(&vc)?;
        let tampered_status = test_status(901);
        status_resolver.set_status(&tampered_status, false);

        let tampered_vc = VerifiableCredential::new_with_status(
            vc.context().clone(),
            vc.id().clone(),
            vc.issuer().clone(),
            vc.valid_from().clone(),
            tampered_status,
            vc.credential().clone(),
        );

        let holder = DelegationIssuer::<Curve>::new(holder_id.clone(), trust_registry.clone())?;
        let signed_vp = holder.issue_delegation_verifiable_presentation(
            tampered_vc,
            vec![permission(Operation::ReadFile)],
            String::from("cloud-access-gateway"),
            String::from("challenge-status-binding"),
        )?;

        let verifier = DelegationVerifier::new(trust_registry.clone(), status_resolver)?;
        let request = AuthorizationRequest::new(
            holder_id,
            String::from("cloud-access-gateway"),
            String::from("challenge-status-binding"),
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
    fn rejects_revoked_current_credential() -> Result<(), String> {
        type Curve = Bn254;
        let trust_registry: TrustRegistryRef<Curve> =
            Rc::new(InMemoryTrustRegistry::<Curve>::new());

        let root = DelegationIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d0"),
            trust_registry.clone(),
        )?;
        trust_registry.set_trust_anchor(root.holder_id(), true)?;

        let holder_id = String::from("https://vc.example/delegators/d1");
        let vc = root.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/revoked-current"),
            test_status(920),
            String::from("2026-01-01T00:00:00Z"),
            holder_id.clone(),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            None,
        )?;

        let status_resolver = resolver_for_vc(&vc)?;
        let current_status = vc
            .credential_status()
            .ok_or_else(|| String::from("Credential has no credentialStatus"))?;
        status_resolver.set_status(current_status, true);

        let holder = DelegationIssuer::<Curve>::new(holder_id.clone(), trust_registry.clone())?;
        let signed_vp = holder.issue_delegation_verifiable_presentation(
            vc,
            vec![permission(Operation::ReadFile)],
            String::from("cloud-access-gateway"),
            String::from("challenge-revoked-current"),
        )?;

        let verifier = DelegationVerifier::new(trust_registry.clone(), status_resolver)?;
        let request = AuthorizationRequest::new(
            holder_id,
            String::from("cloud-access-gateway"),
            String::from("challenge-revoked-current"),
            permission(Operation::ReadFile),
        )?;

        let error = verifier
            .verify_verifiable_presentation(request, signed_vp)
            .expect_err("revoked current credential must be rejected");
        assert!(error.contains("revoked"));
        Ok(())
    }

    #[test]
    fn rejects_revoked_ancestor_credential() -> Result<(), String> {
        type Curve = Bn254;
        let trust_registry: TrustRegistryRef<Curve> =
            Rc::new(InMemoryTrustRegistry::<Curve>::new());

        let root = DelegationIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d0"),
            trust_registry.clone(),
        )?;
        trust_registry.set_trust_anchor(root.holder_id(), true)?;

        let parent_vc = root.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/revoked-ancestor"),
            test_status(930),
            String::from("2026-01-01T00:00:00Z"),
            String::from("https://vc.example/delegators/d1"),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            None,
        )?;

        let child_issuer = DelegationIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d1"),
            trust_registry.clone(),
        )?;
        let holder_id = String::from("https://vc.example/delegators/d2");
        let child_vc = child_issuer.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/revoked-descendant"),
            test_status(931),
            String::from("2026-01-01T00:00:00Z"),
            holder_id.clone(),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            Some(parent_vc),
        )?;

        let status_resolver = resolver_for_vc(&child_vc)?;
        let ancestor = child_vc
            .credential()
            .hierarchy()
            .first()
            .ok_or_else(|| String::from("Expected ancestor in delegation hierarchy"))?;
        status_resolver.set_status(ancestor.credential_status(), true);

        let holder = DelegationIssuer::<Curve>::new(holder_id.clone(), trust_registry.clone())?;
        let signed_vp = holder.issue_delegation_verifiable_presentation(
            child_vc,
            vec![permission(Operation::ReadFile)],
            String::from("cloud-access-gateway"),
            String::from("challenge-revoked-ancestor"),
        )?;

        let verifier = DelegationVerifier::new(trust_registry.clone(), status_resolver)?;
        let request = AuthorizationRequest::new(
            holder_id,
            String::from("cloud-access-gateway"),
            String::from("challenge-revoked-ancestor"),
            permission(Operation::ReadFile),
        )?;

        let error = verifier
            .verify_verifiable_presentation(request, signed_vp)
            .expect_err("descendant of a revoked credential must be rejected");
        assert!(error.contains("revoked"));
        Ok(())
    }

    #[test]
    fn rejects_untrusted_root_identity() -> Result<(), String> {
        type Curve = Bn254;
        let trust_registry: TrustRegistryRef<Curve> =
            Rc::new(InMemoryTrustRegistry::<Curve>::new());

        let root = DelegationIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d0"),
            trust_registry.clone(),
        )?;

        let holder_id = String::from("https://vc.example/delegators/d1");
        let vc = root.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/untrusted-root"),
            test_status(940),
            String::from("2026-01-01T00:00:00Z"),
            holder_id.clone(),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            None,
        )?;

        let status_resolver = resolver_for_vc(&vc)?;
        let holder = DelegationIssuer::<Curve>::new(holder_id.clone(), trust_registry.clone())?;
        let signed_vp = holder.issue_delegation_verifiable_presentation(
            vc,
            vec![permission(Operation::ReadFile)],
            String::from("cloud-access-gateway"),
            String::from("challenge-untrusted-root"),
        )?;

        let verifier = DelegationVerifier::new(trust_registry.clone(), status_resolver)?;
        let request = AuthorizationRequest::new(
            holder_id,
            String::from("cloud-access-gateway"),
            String::from("challenge-untrusted-root"),
            permission(Operation::ReadFile),
        )?;

        let error = verifier
            .verify_verifiable_presentation(request, signed_vp)
            .expect_err("registered but untrusted root must be rejected");
        assert!(error.contains("not a trust anchor"));
        Ok(())
    }

    #[test]
    fn rejects_suspended_presenter_identity() -> Result<(), String> {
        type Curve = Bn254;
        let trust_registry: TrustRegistryRef<Curve> =
            Rc::new(InMemoryTrustRegistry::<Curve>::new());

        let root = DelegationIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d0"),
            trust_registry.clone(),
        )?;
        trust_registry.set_trust_anchor(root.holder_id(), true)?;

        let holder_id = String::from("https://vc.example/delegators/d1");
        let vc = root.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/suspended-presenter"),
            test_status(941),
            String::from("2026-01-01T00:00:00Z"),
            holder_id.clone(),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            None,
        )?;

        let status_resolver = resolver_for_vc(&vc)?;
        let holder = DelegationIssuer::<Curve>::new(holder_id.clone(), trust_registry.clone())?;
        let signed_vp = holder.issue_delegation_verifiable_presentation(
            vc,
            vec![permission(Operation::ReadFile)],
            String::from("cloud-access-gateway"),
            String::from("challenge-suspended-presenter"),
        )?;

        trust_registry.set_identity_status(&holder_id, IdentityStatus::Suspended)?;

        let verifier = DelegationVerifier::new(trust_registry.clone(), status_resolver)?;
        let request = AuthorizationRequest::new(
            holder_id,
            String::from("cloud-access-gateway"),
            String::from("challenge-suspended-presenter"),
            permission(Operation::ReadFile),
        )?;

        let error = verifier
            .verify_verifiable_presentation(request, signed_vp)
            .expect_err("suspended presenter must be rejected");
        assert!(error.contains("suspended"));
        Ok(())
    }

    #[test]
    fn rejects_revoked_issuer_identity_in_chain() -> Result<(), String> {
        type Curve = Bn254;
        let trust_registry: TrustRegistryRef<Curve> =
            Rc::new(InMemoryTrustRegistry::<Curve>::new());

        let root = DelegationIssuer::<Curve>::new(
            String::from("https://vc.example/delegators/d0"),
            trust_registry.clone(),
        )?;
        trust_registry.set_trust_anchor(root.holder_id(), true)?;

        let intermediate_id = String::from("https://vc.example/delegators/d1");
        let parent_vc = root.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/identity-parent"),
            test_status(942),
            String::from("2026-01-01T00:00:00Z"),
            intermediate_id.clone(),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            None,
        )?;

        let intermediate =
            DelegationIssuer::<Curve>::new(intermediate_id.clone(), trust_registry.clone())?;
        let holder_id = String::from("https://vc.example/delegators/d2");
        let child_vc = intermediate.issue_delegation_verifiable_credential(
            vec![String::from("https://www.w3.org/ns/credentials/v2")],
            String::from("http://delegation.example/credentials/identity-child"),
            test_status(943),
            String::from("2026-01-01T00:00:00Z"),
            holder_id.clone(),
            Duration::new(3600, 0),
            vec![permission(Operation::ReadFile)],
            Some(parent_vc),
        )?;

        let status_resolver = resolver_for_vc(&child_vc)?;
        let holder = DelegationIssuer::<Curve>::new(holder_id.clone(), trust_registry.clone())?;
        let signed_vp = holder.issue_delegation_verifiable_presentation(
            child_vc,
            vec![permission(Operation::ReadFile)],
            String::from("cloud-access-gateway"),
            String::from("challenge-revoked-issuer"),
        )?;

        trust_registry.set_identity_status(&intermediate_id, IdentityStatus::Revoked)?;

        let verifier = DelegationVerifier::new(trust_registry.clone(), status_resolver)?;
        let request = AuthorizationRequest::new(
            holder_id,
            String::from("cloud-access-gateway"),
            String::from("challenge-revoked-issuer"),
            permission(Operation::ReadFile),
        )?;

        let error = verifier
            .verify_verifiable_presentation(request, signed_vp)
            .expect_err("descendant of revoked issuer identity must be rejected");
        assert!(error.contains("revoked"));
        Ok(())
    }
}
