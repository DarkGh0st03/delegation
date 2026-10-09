use crate::delegation::accumulator::accumulator_public_data::AccumulatorPublicData;
use crate::delegation::trust::model::identity_status::IdentityStatus;
use ark_ec::pairing::Pairing;
use josekit::jwk::Jwk;
use std::rc::Rc;

/// Read-side trust contract used by verifiers.
///
/// Implementations resolve identity lifecycle, trust-anchor state, accumulator
/// public material, and signature verification keys without exposing mutation
/// operations.
pub trait TrustResolver<E: Pairing> {
    fn get_identity_status(&self, identity_id: &str) -> Result<IdentityStatus, String>;

    fn is_trust_anchor(&self, identity_id: &str) -> Result<bool, String>;

    /// Resolves the latest accumulator public material for an active identity.
    fn get_accumulator_data(&self, identity_id: &str) -> Result<AccumulatorPublicData<E>, String>;

    /// Resolves the exact historical accumulator public-material version referenced
    /// by a Delegation Credential.
    fn get_accumulator_data_at_version(
        &self,
        identity_id: &str,
        version: u64,
    ) -> Result<AccumulatorPublicData<E>, String>;

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

pub type TrustResolverRef<E> = Rc<dyn TrustResolver<E>>;
