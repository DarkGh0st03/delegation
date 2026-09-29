use crate::delegation::accumulator::accumulator_public_data::AccumulatorPublicData;
use crate::delegation::trust::material::public_material_provider_traits::{
    AccumulatorMaterialProvider, PublicMaterialProvider, VerificationKeyProvider,
};
use ark_ec::pairing::Pairing;
use josekit::jwk::Jwk;
use std::cell::RefCell;
use std::collections::HashMap;

/// Deterministic local provider used by tests and as the off-chain accumulator
/// source in the PoC. Verification keys can now be supplied independently through
/// `CompositePublicMaterialProvider`.
pub struct InMemoryPublicMaterialProvider<E: Pairing> {
    accumulator_data: RefCell<HashMap<(String, u64), AccumulatorPublicData<E>>>,
    verification_keys: RefCell<HashMap<String, Jwk>>,
}

impl<E: Pairing> InMemoryPublicMaterialProvider<E> {
    pub fn new() -> Self {
        Self {
            accumulator_data: RefCell::new(HashMap::new()),
            verification_keys: RefCell::new(HashMap::new()),
        }
    }

    pub fn insert_accumulator_data(
        &self,
        identity_id: String,
        version: u64,
        data: AccumulatorPublicData<E>,
    ) -> Result<(), String> {
        if identity_id.trim().is_empty() {
            return Err(String::from("Identity id cannot be empty"));
        }
        if version == 0 {
            return Err(String::from(
                "Accumulator material version must be greater than zero",
            ));
        }

        self.accumulator_data
            .borrow_mut()
            .insert((identity_id, version), data);
        Ok(())
    }

    pub fn insert_verification_key(
        &self,
        identity_id: String,
        verification_key: Jwk,
    ) -> Result<(), String> {
        if identity_id.trim().is_empty() {
            return Err(String::from("Identity id cannot be empty"));
        }

        self.verification_keys
            .borrow_mut()
            .insert(identity_id, verification_key);
        Ok(())
    }
}

impl<E: Pairing> Default for InMemoryPublicMaterialProvider<E> {
    fn default() -> Self {
        Self::new()
    }
}

impl<E: Pairing> AccumulatorMaterialProvider<E> for InMemoryPublicMaterialProvider<E> {
    fn get_accumulator_data_at_version(
        &self,
        identity_id: &str,
        version: u64,
    ) -> Result<AccumulatorPublicData<E>, String> {
        self.accumulator_data
            .borrow()
            .get(&(identity_id.to_string(), version))
            .cloned()
            .ok_or_else(|| {
                format!(
                    "No off-chain accumulator public data version {version} for identity {identity_id}"
                )
            })
    }
}

impl<E: Pairing> VerificationKeyProvider for InMemoryPublicMaterialProvider<E> {
    fn get_verification_key(&self, identity_id: &str) -> Result<Jwk, String> {
        self.verification_keys
            .borrow()
            .get(identity_id)
            .cloned()
            .ok_or_else(|| {
                format!("No off-chain verification key available for identity {identity_id}")
            })
    }
}

impl<E: Pairing> PublicMaterialProvider<E> for InMemoryPublicMaterialProvider<E> {
    fn get_accumulator_data_at_version(
        &self,
        identity_id: &str,
        version: u64,
    ) -> Result<AccumulatorPublicData<E>, String> {
        AccumulatorMaterialProvider::get_accumulator_data_at_version(self, identity_id, version)
    }

    fn get_verification_key(&self, identity_id: &str) -> Result<Jwk, String> {
        VerificationKeyProvider::get_verification_key(self, identity_id)
    }
}
