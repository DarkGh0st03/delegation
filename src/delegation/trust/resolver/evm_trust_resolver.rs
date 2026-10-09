use crate::delegation::accumulator::accumulator_public_data::AccumulatorPublicData;
use crate::delegation::trust::evm::trust_chain_reader::TrustChainReader;
use crate::delegation::trust::material::accumulator_material_provider::AccumulatorMaterialProviderRef;
use crate::delegation::trust::material::verification_key_provider::VerificationKeyProviderRef;
use crate::delegation::trust::model::identity_status::IdentityStatus;
use crate::delegation::trust::resolver::trust_resolver_trait::TrustResolver;
use alloy::primitives::{B256, keccak256};
use ark_ec::pairing::Pairing;
use ark_serialize::CanonicalSerialize;
use josekit::jwk::Jwk;
use std::rc::Rc;

/// Verifier-side trust resolver backed by EVM trust anchors.
///
/// The blockchain is the source of truth for identity lifecycle, trust-anchor
/// state, accumulator versions, and accumulator commitments. Complete
/// accumulator material and DID verification keys are supplied by two explicit,
/// independent providers.
pub struct EvmTrustResolver<E: Pairing> {
    chain: Rc<dyn TrustChainReader>,
    accumulator_material: AccumulatorMaterialProviderRef<E>,
    verification_keys: VerificationKeyProviderRef,
}

impl<E: Pairing> EvmTrustResolver<E> {
    pub fn new(
        chain: Rc<dyn TrustChainReader>,
        accumulator_material: AccumulatorMaterialProviderRef<E>,
        verification_keys: VerificationKeyProviderRef,
    ) -> Self {
        Self {
            chain,
            accumulator_material,
            verification_keys,
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
}

impl<E: Pairing> TrustResolver<E> for EvmTrustResolver<E> {
    fn get_identity_status(&self, identity_id: &str) -> Result<IdentityStatus, String> {
        self.chain.identity_status(identity_id)
    }

    fn is_trust_anchor(&self, identity_id: &str) -> Result<bool, String> {
        self.chain.is_trust_anchor(identity_id)
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
            .accumulator_material
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

    fn get_verification_key(&self, identity_id: &str) -> Result<Jwk, String> {
        self.ensure_identity_active(identity_id)?;
        self.verification_keys.get_verification_key(identity_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delegation::trust::evm::trust_chain_reader::AccumulatorMaterialAnchor;
    use crate::delegation::trust::material::accumulator_material_provider::AccumulatorMaterialProviderRef;
    use crate::delegation::trust::material::in_memory_public_material_provider::InMemoryPublicMaterialProvider;
    use crate::delegation::trust::material::verification_key_provider::VerificationKeyProviderRef;
    use ark_bn254::Bn254;
    use ark_std::rand::SeedableRng;
    use ark_std::rand::prelude::StdRng;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use vb_accumulator::prelude::{Keypair, SetupParams};

    struct MockTrustChainReader {
        statuses: RefCell<HashMap<String, IdentityStatus>>,
        anchors: RefCell<HashMap<String, bool>>,
        latest_versions: RefCell<HashMap<String, u64>>,
        materials: RefCell<HashMap<(String, u64), AccumulatorMaterialAnchor>>,
    }

    impl MockTrustChainReader {
        fn new() -> Self {
            Self {
                statuses: RefCell::new(HashMap::new()),
                anchors: RefCell::new(HashMap::new()),
                latest_versions: RefCell::new(HashMap::new()),
                materials: RefCell::new(HashMap::new()),
            }
        }
    }

    impl TrustChainReader for MockTrustChainReader {
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

    fn providers(
        provider: Rc<InMemoryPublicMaterialProvider<Bn254>>,
    ) -> (
        AccumulatorMaterialProviderRef<Bn254>,
        VerificationKeyProviderRef,
    ) {
        (provider.clone(), provider)
    }

    #[test]
    fn accepts_off_chain_material_only_when_commitment_matches() -> Result<(), String> {
        let identity = String::from("did:ethr:0x7a69:0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
        let version = 1;
        let material = accumulator_data();
        let commitment = EvmTrustResolver::<Bn254>::accumulator_material_commitment(&material)?;

        let chain = Rc::new(MockTrustChainReader::new());
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
        let (accumulator_material, verification_keys) = providers(provider);

        let resolver = EvmTrustResolver::new(chain, accumulator_material, verification_keys);
        resolver.get_accumulator_data_at_version(&identity, version)?;
        Ok(())
    }

    #[test]
    fn rejects_off_chain_material_when_commitment_mismatches() -> Result<(), String> {
        let identity = String::from("did:ethr:0x7a69:0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
        let version = 1;

        let chain = Rc::new(MockTrustChainReader::new());
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
        let (accumulator_material, verification_keys) = providers(provider);

        let resolver = EvmTrustResolver::new(chain, accumulator_material, verification_keys);
        assert!(
            resolver
                .get_accumulator_data_at_version(&identity, version)
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn lifecycle_and_trust_anchor_come_from_chain() -> Result<(), String> {
        let identity = String::from("did:ethr:0x7a69:0x70997970C51812dc3A010C7d01b50e0d17dc79C8");

        let chain = Rc::new(MockTrustChainReader::new());
        chain
            .statuses
            .borrow_mut()
            .insert(identity.clone(), IdentityStatus::Active);
        chain.anchors.borrow_mut().insert(identity.clone(), true);

        let provider = Rc::new(InMemoryPublicMaterialProvider::<Bn254>::new());
        provider.insert_verification_key(identity.clone(), verification_key()?)?;
        let (accumulator_material, verification_keys) = providers(provider);

        let resolver = EvmTrustResolver::new(chain, accumulator_material, verification_keys);
        resolver.ensure_trust_anchor(&identity)?;
        resolver.get_verification_key(&identity)?;
        Ok(())
    }

    #[test]
    fn suspended_identity_cannot_resolve_verification_material() -> Result<(), String> {
        let identity = String::from("did:ethr:0x7a69:0x70997970C51812dc3A010C7d01b50e0d17dc79C8");

        let chain = Rc::new(MockTrustChainReader::new());
        chain
            .statuses
            .borrow_mut()
            .insert(identity.clone(), IdentityStatus::Suspended);

        let provider = Rc::new(InMemoryPublicMaterialProvider::<Bn254>::new());
        provider.insert_verification_key(identity.clone(), verification_key()?)?;
        let (accumulator_material, verification_keys) = providers(provider);

        let resolver = EvmTrustResolver::new(chain, accumulator_material, verification_keys);
        assert!(resolver.get_verification_key(&identity).is_err());
        Ok(())
    }
}
