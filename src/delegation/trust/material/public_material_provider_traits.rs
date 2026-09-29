use crate::delegation::accumulator::accumulator_public_data::AccumulatorPublicData;
use ark_ec::pairing::Pairing;
use josekit::jwk::Jwk;
use std::rc::Rc;

/// Supplies complete public verification material that remains off-chain.
pub trait PublicMaterialProvider<E: Pairing> {
    fn get_accumulator_data_at_version(
        &self,
        identity_id: &str,
        version: u64,
    ) -> Result<AccumulatorPublicData<E>, String>;

    fn get_verification_key(&self, identity_id: &str) -> Result<Jwk, String>;
}

pub type PublicMaterialProviderRef<E> = Rc<dyn PublicMaterialProvider<E>>;

/// Narrow source for versioned accumulator public material.
pub trait AccumulatorMaterialProvider<E: Pairing> {
    fn get_accumulator_data_at_version(
        &self,
        identity_id: &str,
        version: u64,
    ) -> Result<AccumulatorPublicData<E>, String>;
}

pub type AccumulatorMaterialProviderRef<E> = Rc<dyn AccumulatorMaterialProvider<E>>;

/// Narrow source for identity verification keys.
///
/// In the final pre-Gateway PoC this is backed by the official did:ethr resolver
/// instead of an in-memory map.
pub trait VerificationKeyProvider {
    fn get_verification_key(&self, identity_id: &str) -> Result<Jwk, String>;
}

pub type VerificationKeyProviderRef = Rc<dyn VerificationKeyProvider>;
