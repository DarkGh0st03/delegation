use crate::delegation::accumulator::accumulator_public_data::AccumulatorPublicData;
use crate::delegation::trust::model::identity_status::IdentityStatus;
use ark_ec::pairing::Pairing;
use josekit::jwk::Jwk;
use std::rc::Rc;

/// Write-side trust contract used by issuer/governance paths.
///
/// Implementations mutate identity lifecycle and publish verification material.
pub trait TrustPublisher<E: Pairing> {
    fn register_identity(&self, identity_id: String) -> Result<(), String>;

    fn set_identity_status(&self, identity_id: &str, status: IdentityStatus) -> Result<(), String>;

    fn set_trust_anchor(&self, identity_id: &str, trusted: bool) -> Result<(), String>;

    /// Publishes a new immutable version of the issuer's accumulator public material.
    ///
    /// Returns the monotonically increasing version assigned to the material.
    fn publish_accumulator_data(
        &self,
        identity_id: String,
        data: AccumulatorPublicData<E>,
    ) -> Result<u64, String>;

    fn publish_verification_key(
        &self,
        identity_id: String,
        verification_key: Jwk,
    ) -> Result<(), String>;
}

pub type TrustPublisherRef<E> = Rc<dyn TrustPublisher<E>>;
