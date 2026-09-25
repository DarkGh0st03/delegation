use crate::delegation::trust::accumulator_public_data::AccumulatorPublicData;
use crate::delegation::trust::trust_registry::TrustRegistry;
use ark_ec::pairing::Pairing;
use josekit::jwk::Jwk;
use std::cell::RefCell;
use std::collections::HashMap;

/// In-memory TrustRegistry used by local tests and the PoC before the EVM adapter.
///
/// It replaces the two independent DLTSim maps with one domain-oriented registry.
pub struct InMemoryTrustRegistry<E: Pairing> {
    accumulator_data: RefCell<HashMap<String, AccumulatorPublicData<E>>>,
    verification_keys: RefCell<HashMap<String, Jwk>>,
}

impl<E: Pairing> InMemoryTrustRegistry<E> {
    pub fn new() -> Self {
        Self {
            accumulator_data: RefCell::new(HashMap::new()),
            verification_keys: RefCell::new(HashMap::new()),
        }
    }
}

impl<E: Pairing> Default for InMemoryTrustRegistry<E> {
    fn default() -> Self {
        Self::new()
    }
}

impl<E: Pairing> TrustRegistry<E> for InMemoryTrustRegistry<E> {
    fn publish_accumulator_data(
        &self,
        identity_id: String,
        data: AccumulatorPublicData<E>,
    ) -> Result<(), String> {
        self.accumulator_data.borrow_mut().insert(identity_id, data);
        Ok(())
    }

    fn get_accumulator_data(
        &self,
        identity_id: &str,
    ) -> Result<AccumulatorPublicData<E>, String> {
        self.accumulator_data
            .borrow()
            .get(identity_id)
            .cloned()
            .ok_or_else(|| {
                format!("No accumulator public data registered for identity {identity_id}")
            })
    }

    fn publish_verification_key(
        &self,
        identity_id: String,
        verification_key: Jwk,
    ) -> Result<(), String> {
        self.verification_keys
            .borrow_mut()
            .insert(identity_id, verification_key);
        Ok(())
    }

    fn get_verification_key(&self, identity_id: &str) -> Result<Jwk, String> {
        self.verification_keys
            .borrow()
            .get(identity_id)
            .cloned()
            .ok_or_else(|| {
                format!("No verification key registered for identity {identity_id}")
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ark_bn254::Bn254;
    use ark_std::rand::prelude::StdRng;
    use ark_std::rand::SeedableRng;
    use vb_accumulator::prelude::{Keypair, SetupParams};

    #[test]
    fn stores_and_resolves_public_trust_material() -> Result<(), String> {
        type Curve = Bn254;
        let registry = InMemoryTrustRegistry::<Curve>::new();
        let identity = String::from("did:example:issuer");

        let mut rng = StdRng::from_entropy();
        let params = SetupParams::<Curve>::generate_using_rng(&mut rng);
        let keypair = Keypair::<Curve>::generate_using_rng(&mut rng, &params);
        registry.publish_accumulator_data(
            identity.clone(),
            AccumulatorPublicData::new(keypair.public_key.clone(), params),
        )?;

        let mut jwk = Jwk::new("OKP");
        jwk.set_parameter("crv", Some(serde_json::Value::String(String::from("Ed25519"))))
            .map_err(|err| err.to_string())?;
        registry.publish_verification_key(identity.clone(), jwk)?;

        registry.get_accumulator_data(&identity)?;
        registry.get_verification_key(&identity)?;
        Ok(())
    }

    #[test]
    fn unknown_identity_fails_closed() {
        let registry = InMemoryTrustRegistry::<Bn254>::new();

        assert!(
            registry
                .get_accumulator_data("did:example:missing")
                .is_err()
        );
        assert!(
            registry
                .get_verification_key("did:example:missing")
                .is_err()
        );
    }
}
