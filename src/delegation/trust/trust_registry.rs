use crate::delegation::trust::accumulator_public_data::AccumulatorPublicData;
use ark_ec::pairing::Pairing;
use josekit::jwk::Jwk;
use std::rc::Rc;

/// Abstraction over the public trust material required by issuers and verifiers.
///
/// The current implementation is in-memory. A later EVM-backed implementation can
/// provide the same interface without changing Delegation Credential verification.
pub trait TrustRegistry<E: Pairing> {
    fn publish_accumulator_data(
        &self,
        identity_id: String,
        data: AccumulatorPublicData<E>,
    ) -> Result<(), String>;

    fn get_accumulator_data(&self, identity_id: &str) -> Result<AccumulatorPublicData<E>, String>;

    fn publish_verification_key(
        &self,
        identity_id: String,
        verification_key: Jwk,
    ) -> Result<(), String>;

    fn get_verification_key(&self, identity_id: &str) -> Result<Jwk, String>;
}

pub type TrustRegistryRef<E> = Rc<dyn TrustRegistry<E>>;
