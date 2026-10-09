use josekit::jwk::Jwk;
use std::rc::Rc;

/// Narrow source for identity verification keys.
///
/// In the final PoC this is backed by the did:ethr resolver instead of an
/// in-memory map.
pub trait VerificationKeyProvider {
    fn get_verification_key(&self, identity_id: &str) -> Result<Jwk, String>;
}

pub type VerificationKeyProviderRef = Rc<dyn VerificationKeyProvider>;
