use crate::delegation::trust::accumulator_public_data::AccumulatorPublicData;
use crate::delegation::trust::identity_status::IdentityStatus;
use ark_ec::pairing::Pairing;
use josekit::jwk::Jwk;
use std::rc::Rc;

/// Abstraction over identity lifecycle, trust anchors, and public verification material.
///
/// The current implementation is in-memory. A later EVM-backed implementation can
/// provide the same interface without changing Delegation Credential verification.
pub trait TrustRegistry<E: Pairing> {
    fn register_identity(&self, identity_id: String) -> Result<(), String>;

    fn get_identity_status(&self, identity_id: &str) -> Result<IdentityStatus, String>;

    fn set_identity_status(
        &self,
        identity_id: &str,
        status: IdentityStatus,
    ) -> Result<(), String>;

    fn set_trust_anchor(&self, identity_id: &str, trusted: bool) -> Result<(), String>;

    fn is_trust_anchor(&self, identity_id: &str) -> Result<bool, String>;

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

    fn ensure_identity_active(&self, identity_id: &str) -> Result<(), String> {
        match self.get_identity_status(identity_id)? {
            IdentityStatus::Active => Ok(()),
            status => Err(format!("Identity {identity_id} is {status}")),
        }
    }

    fn ensure_trust_anchor(&self, identity_id: &str) -> Result<(), String> {
        self.ensure_identity_active(identity_id)?;
        if self.is_trust_anchor(identity_id)? {
            Ok(())
        } else {
            Err(format!("Identity {identity_id} is not a trust anchor"))
        }
    }
}

pub type TrustRegistryRef<E> = Rc<dyn TrustRegistry<E>>;
