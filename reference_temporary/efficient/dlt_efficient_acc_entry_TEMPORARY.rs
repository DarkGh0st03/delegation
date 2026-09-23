use ark_ec::pairing::Pairing;
use josekit::jwk::Jwk;
use vb_accumulator::prelude::{PublicKey, SetupParams};

/// Utility structure to be kept in the DLTSimulator for managing accumulators (which is just a hashmap).
#[derive(Clone, Debug)]
pub struct DLTSimEfficientAccEntry<E: Pairing> {
    pub public_key: PublicKey<E>,
    pub setup_params: SetupParams<E>,
    pub jwk: Jwk,
}

impl<E: Pairing> DLTSimEfficientAccEntry<E> {
    /// Creates a new instance of DLTSimAccEntry.
    ///
    /// # Arguments
    /// * `public_key` - Accumulator manager's (issuer) public key.
    /// * `setup_params` - Accumulator manager's (issuer) setup parameters.
    /// * `jwk` - Standard key using for re-delegating credentials.
    ///
    /// # Returns
    /// An instance of DLTSimAccEntry.
    pub fn new(public_key: PublicKey<E>, setup_params: SetupParams<E>, jwk: Jwk) -> Self {
        DLTSimEfficientAccEntry {
            public_key,
            setup_params,
            jwk,
        }
    }
}
