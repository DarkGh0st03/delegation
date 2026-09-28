use crate::delegation::trust::accumulator_public_data::AccumulatorPublicData;
use ark_ec::pairing::Pairing;
use josekit::jwk::Jwk;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

/// Supplies the complete public verification material that remains off-chain.
///
/// The EVM registries only anchor trust state and hashes. Verifiers still need a
/// source for the actual accumulator public material and the DID verification key.
pub trait PublicMaterialProvider<E: Pairing> {
    fn get_accumulator_data_at_version(
        &self,
        identity_id: &str,
        version: u64,
    ) -> Result<AccumulatorPublicData<E>, String>;

    fn get_verification_key(&self, identity_id: &str) -> Result<Jwk, String>;
}

pub type PublicMaterialProviderRef<E> = Rc<dyn PublicMaterialProvider<E>>;

/// Deterministic local provider used by tests and by the PoC until the off-chain
/// material service / DID resolver boundary is wired to HTTP.
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

impl<E: Pairing> PublicMaterialProvider<E> for InMemoryPublicMaterialProvider<E> {
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
