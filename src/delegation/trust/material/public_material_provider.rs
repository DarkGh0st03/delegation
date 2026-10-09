use crate::delegation::accumulator::accumulator_public_data::AccumulatorPublicData;
use ark_ec::pairing::Pairing;
use josekit::jwk::Jwk;
use std::rc::Rc;

/// Compatibility facade that supplies complete public verification material.
///
/// This facade is retained during the contract split. The next refactoring phase
/// can remove it if callers depend directly on the two narrow providers.
pub trait PublicMaterialProvider<E: Pairing> {
    fn get_accumulator_data_at_version(
        &self,
        identity_id: &str,
        version: u64,
    ) -> Result<AccumulatorPublicData<E>, String>;

    fn get_verification_key(&self, identity_id: &str) -> Result<Jwk, String>;
}

pub type PublicMaterialProviderRef<E> = Rc<dyn PublicMaterialProvider<E>>;
