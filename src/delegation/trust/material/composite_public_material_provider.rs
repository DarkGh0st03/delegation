use crate::delegation::accumulator::accumulator_public_data::AccumulatorPublicData;
use crate::delegation::trust::material::public_material_provider_traits::{
    AccumulatorMaterialProviderRef, PublicMaterialProvider, VerificationKeyProviderRef,
};
use ark_ec::pairing::Pairing;
use josekit::jwk::Jwk;

/// Composes independent accumulator-material and DID-key resolution boundaries.
pub struct CompositePublicMaterialProvider<E: Pairing> {
    accumulator_material: AccumulatorMaterialProviderRef<E>,
    verification_keys: VerificationKeyProviderRef,
}

impl<E: Pairing> CompositePublicMaterialProvider<E> {
    pub fn new(
        accumulator_material: AccumulatorMaterialProviderRef<E>,
        verification_keys: VerificationKeyProviderRef,
    ) -> Self {
        Self {
            accumulator_material,
            verification_keys,
        }
    }
}

impl<E: Pairing> PublicMaterialProvider<E> for CompositePublicMaterialProvider<E> {
    fn get_accumulator_data_at_version(
        &self,
        identity_id: &str,
        version: u64,
    ) -> Result<AccumulatorPublicData<E>, String> {
        self.accumulator_material
            .get_accumulator_data_at_version(identity_id, version)
    }

    fn get_verification_key(&self, identity_id: &str) -> Result<Jwk, String> {
        self.verification_keys.get_verification_key(identity_id)
    }
}
