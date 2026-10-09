use crate::delegation::accumulator::accumulator_public_data::AccumulatorPublicData;
use ark_ec::pairing::Pairing;
use std::rc::Rc;

/// Narrow source for versioned accumulator public material.
pub trait AccumulatorMaterialProvider<E: Pairing> {
    fn get_accumulator_data_at_version(
        &self,
        identity_id: &str,
        version: u64,
    ) -> Result<AccumulatorPublicData<E>, String>;
}

pub type AccumulatorMaterialProviderRef<E> = Rc<dyn AccumulatorMaterialProvider<E>>;
