use crate::delegation::trust::material::public_material_provider_traits::VerificationKeyProvider;
use josekit::jwk::Jwk;
use std::cell::RefCell;
use std::collections::HashMap;

/// Small dedicated in-memory verification-key source useful for tests that do not
/// need accumulator material.
#[derive(Default)]
pub struct InMemoryVerificationKeyProvider {
    verification_keys: RefCell<HashMap<String, Jwk>>,
}

impl InMemoryVerificationKeyProvider {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&self, identity_id: String, verification_key: Jwk) -> Result<(), String> {
        if identity_id.trim().is_empty() {
            return Err(String::from("Identity id cannot be empty"));
        }
        self.verification_keys
            .borrow_mut()
            .insert(identity_id, verification_key);
        Ok(())
    }
}

impl VerificationKeyProvider for InMemoryVerificationKeyProvider {
    fn get_verification_key(&self, identity_id: &str) -> Result<Jwk, String> {
        self.verification_keys
            .borrow()
            .get(identity_id)
            .cloned()
            .ok_or_else(|| format!("No verification key available for identity {identity_id}"))
    }
}
