use crate::delegation::accumulator::accumulator_public_data::AccumulatorPublicData;
use crate::delegation::trust::evm::evm_reader_traits::EvmTrustReader;
use crate::delegation::trust::model::identity_status::IdentityStatus;
use crate::delegation::trust::material::public_material_provider_traits::PublicMaterialProviderRef;
use crate::delegation::trust::registry::trust_registry_trait::TrustRegistry;
use alloy::primitives::{B256, keccak256};
use ark_ec::pairing::Pairing;
use ark_serialize::CanonicalSerialize;
use josekit::jwk::Jwk;
use std::marker::PhantomData;
use std::rc::Rc;

/// Verifier-side TrustRegistry backed by the EVM trust contracts.
///
/// The blockchain remains the source of truth for lifecycle, trust-anchor state,
/// and accumulator commitments. Complete accumulator material and DID verification
/// keys stay off-chain and are supplied by `PublicMaterialProvider`.
///
/// Write methods intentionally fail: issuer-side EVM publication is a separate
/// concern and must use signed blockchain transactions rather than mutating local
/// verifier state.
pub struct EvmBackedTrustRegistry<E: Pairing> {
    chain: Rc<dyn EvmTrustReader>,
    public_material: PublicMaterialProviderRef<E>,
    _curve: PhantomData<E>,
}

impl<E: Pairing> EvmBackedTrustRegistry<E> {
    pub fn new(
        chain: Rc<dyn EvmTrustReader>,
        public_material: PublicMaterialProviderRef<E>,
    ) -> Self {
        Self {
            chain,
            public_material,
            _curve: PhantomData,
        }
    }

    pub fn accumulator_material_commitment(
        data: &AccumulatorPublicData<E>,
    ) -> Result<B256, String> {
        let mut bytes = Vec::new();
        data.serialize_compressed(&mut bytes)
            .map_err(|err| format!("Could not serialize accumulator public material [{err}]"))?;
        Ok(keccak256(bytes))
    }

    fn read_only_error(operation: &str) -> String {
        format!(
            "EvmBackedTrustRegistry is verifier-side/read-only; {operation} requires an issuer/governance transaction path"
        )
    }
}

impl<E: Pairing> TrustRegistry<E> for EvmBackedTrustRegistry<E> {
    fn register_identity(&self, _identity_id: String) -> Result<(), String> {
        Err(Self::read_only_error("register_identity"))
    }

    fn get_identity_status(&self, identity_id: &str) -> Result<IdentityStatus, String> {
        self.chain.identity_status(identity_id)
    }

    fn set_identity_status(
        &self,
        _identity_id: &str,
        _status: IdentityStatus,
    ) -> Result<(), String> {
        Err(Self::read_only_error("set_identity_status"))
    }

    fn set_trust_anchor(&self, _identity_id: &str, _trusted: bool) -> Result<(), String> {
        Err(Self::read_only_error("set_trust_anchor"))
    }

    fn is_trust_anchor(&self, identity_id: &str) -> Result<bool, String> {
        self.chain.is_trust_anchor(identity_id)
    }

    fn publish_accumulator_data(
        &self,
        _identity_id: String,
        _data: AccumulatorPublicData<E>,
    ) -> Result<u64, String> {
        Err(Self::read_only_error("publish_accumulator_data"))
    }

    fn get_accumulator_data(&self, identity_id: &str) -> Result<AccumulatorPublicData<E>, String> {
        self.ensure_identity_active(identity_id)?;
        let version = self
            .chain
            .latest_accumulator_material_version(identity_id)?;

        if version == 0 {
            return Err(format!(
                "Identity {identity_id} has no accumulator public material anchored on-chain"
            ));
        }

        self.get_accumulator_data_at_version(identity_id, version)
    }

    fn get_accumulator_data_at_version(
        &self,
        identity_id: &str,
        version: u64,
    ) -> Result<AccumulatorPublicData<E>, String> {
        self.ensure_identity_active(identity_id)?;

        let anchor = self
            .chain
            .accumulator_material_anchor(identity_id, version)?;

        if !anchor.exists {
            return Err(format!(
                "Accumulator material version {version} for identity {identity_id} is not anchored on-chain"
            ));
        }

        let material = self
            .public_material
            .get_accumulator_data_at_version(identity_id, version)?;

        let observed_hash = Self::accumulator_material_commitment(&material)?;
        if observed_hash != anchor.material_hash {
            return Err(format!(
                "Accumulator material commitment mismatch for identity {identity_id} version {version}: on-chain {}, observed {}",
                anchor.material_hash, observed_hash
            ));
        }

        Ok(material)
    }

    fn publish_verification_key(
        &self,
        _identity_id: String,
        _verification_key: Jwk,
    ) -> Result<(), String> {
        Err(Self::read_only_error("publish_verification_key"))
    }

    fn get_verification_key(&self, identity_id: &str) -> Result<Jwk, String> {
        self.ensure_identity_active(identity_id)?;
        self.public_material.get_verification_key(identity_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delegation::trust::evm::evm_reader_traits::AccumulatorMaterialAnchor;
    use crate::delegation::trust::material::in_memory_public_material_provider::InMemoryPublicMaterialProvider;
    use ark_bn254::Bn254;
    use ark_std::rand::SeedableRng;
    use ark_std::rand::prelude::StdRng;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use vb_accumulator::prelude::{Keypair, SetupParams};

    struct MockEvmTrustReader {
        statuses: RefCell<HashMap<String, IdentityStatus>>,
        anchors: RefCell<HashMap<String, bool>>,
        latest_versions: RefCell<HashMap<String, u64>>,
        materials: RefCell<HashMap<(String, u64), AccumulatorMaterialAnchor>>,
    }

    impl MockEvmTrustReader {
        fn new() -> Self {
            Self {
                statuses: RefCell::new(HashMap::new()),
                anchors: RefCell::new(HashMap::new()),
                latest_versions: RefCell::new(HashMap::new()),
                materials: RefCell::new(HashMap::new()),
            }
        }
    }

    impl EvmTrustReader for MockEvmTrustReader {
        fn identity_status(&self, identity_id: &str) -> Result<IdentityStatus, String> {
            self.statuses
                .borrow()
                .get(identity_id)
                .copied()
                .ok_or_else(|| format!("Identity {identity_id} is not enrolled"))
        }

        fn is_trust_anchor(&self, identity_id: &str) -> Result<bool, String> {
            self.anchors
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
            self.materials
                .borrow()
                .get(&(issuer_id.to_string(), version))
                .cloned()
                .ok_or_else(|| {
                    format!("No accumulator anchor for identity {issuer_id} version {version}")
                })
        }
    }

    fn accumulator_data() -> AccumulatorPublicData<Bn254> {
        let mut rng = StdRng::from_entropy();
        let params = SetupParams::<Bn254>::generate_using_rng(&mut rng);
        let keypair = Keypair::<Bn254>::generate_using_rng(&mut rng, &params);
        AccumulatorPublicData::new(keypair.public_key.clone(), params)
    }

    fn verification_key() -> Result<Jwk, String> {
        let mut jwk = Jwk::new("OKP");
        jwk.set_parameter(
            "crv",
            Some(serde_json::Value::String(String::from("Ed25519"))),
        )
        .map_err(|err| err.to_string())?;
        Ok(jwk)
    }

    #[test]
    fn accepts_off_chain_material_only_when_commitment_matches() -> Result<(), String> {
        let identity = String::from("did:ethr:0x7a69:0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
        let version = 1;
        let material = accumulator_data();
        let commitment =
            EvmBackedTrustRegistry::<Bn254>::accumulator_material_commitment(&material)?;

        let chain = Rc::new(MockEvmTrustReader::new());
        chain
            .statuses
            .borrow_mut()
            .insert(identity.clone(), IdentityStatus::Active);
        chain
            .latest_versions
            .borrow_mut()
            .insert(identity.clone(), version);
        chain.materials.borrow_mut().insert(
            (identity.clone(), version),
            AccumulatorMaterialAnchor {
                material_hash: commitment,
                published_at: 1,
                exists: true,
            },
        );

        let provider = Rc::new(InMemoryPublicMaterialProvider::<Bn254>::new());
        provider.insert_accumulator_data(identity.clone(), version, material)?;

        let registry = EvmBackedTrustRegistry::new(chain, provider);
        registry.get_accumulator_data_at_version(&identity, version)?;
        Ok(())
    }

    #[test]
    fn rejects_off_chain_material_when_commitment_mismatches() -> Result<(), String> {
        let identity = String::from("did:ethr:0x7a69:0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
        let version = 1;

        let chain = Rc::new(MockEvmTrustReader::new());
        chain
            .statuses
            .borrow_mut()
            .insert(identity.clone(), IdentityStatus::Active);
        chain.materials.borrow_mut().insert(
            (identity.clone(), version),
            AccumulatorMaterialAnchor {
                material_hash: B256::ZERO,
                published_at: 1,
                exists: true,
            },
        );

        let provider = Rc::new(InMemoryPublicMaterialProvider::<Bn254>::new());
        provider.insert_accumulator_data(identity.clone(), version, accumulator_data())?;

        let registry = EvmBackedTrustRegistry::new(chain, provider);
        assert!(
            registry
                .get_accumulator_data_at_version(&identity, version)
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn lifecycle_and_trust_anchor_come_from_chain() -> Result<(), String> {
        let identity = String::from("did:ethr:0x7a69:0x70997970C51812dc3A010C7d01b50e0d17dc79C8");

        let chain = Rc::new(MockEvmTrustReader::new());
        chain
            .statuses
            .borrow_mut()
            .insert(identity.clone(), IdentityStatus::Active);
        chain.anchors.borrow_mut().insert(identity.clone(), true);

        let provider = Rc::new(InMemoryPublicMaterialProvider::<Bn254>::new());
        provider.insert_verification_key(identity.clone(), verification_key()?)?;

        let registry = EvmBackedTrustRegistry::new(chain, provider);
        registry.ensure_trust_anchor(&identity)?;
        registry.get_verification_key(&identity)?;
        Ok(())
    }

    #[test]
    fn suspended_identity_cannot_resolve_verification_material() -> Result<(), String> {
        let identity = String::from("did:ethr:0x7a69:0x70997970C51812dc3A010C7d01b50e0d17dc79C8");

        let chain = Rc::new(MockEvmTrustReader::new());
        chain
            .statuses
            .borrow_mut()
            .insert(identity.clone(), IdentityStatus::Suspended);

        let provider = Rc::new(InMemoryPublicMaterialProvider::<Bn254>::new());
        provider.insert_verification_key(identity.clone(), verification_key()?)?;

        let registry = EvmBackedTrustRegistry::new(chain, provider);
        assert!(registry.get_verification_key(&identity).is_err());
        Ok(())
    }

    #[test]
    fn verifier_side_registry_rejects_write_operations() {
        let chain = Rc::new(MockEvmTrustReader::new());
        let provider = Rc::new(InMemoryPublicMaterialProvider::<Bn254>::new());
        let registry = EvmBackedTrustRegistry::new(chain, provider);

        assert!(
            registry
                .register_identity(String::from("did:ethr:0x7a69:0x0"))
                .is_err()
        );
    }
}
