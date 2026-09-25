use ark_ec::pairing::Pairing;
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use vb_accumulator::prelude::{PublicKey, SetupParams};

/// Public accumulator material published by an issuer and consumed by verifiers.
#[derive(Clone, Debug, CanonicalSerialize, CanonicalDeserialize)]
pub struct AccumulatorPublicData<E: Pairing> {
    pub public_key: PublicKey<E>,
    pub setup_params: SetupParams<E>,
}

impl<E: Pairing> AccumulatorPublicData<E> {
    pub fn new(public_key: PublicKey<E>, setup_params: SetupParams<E>) -> Self {
        Self {
            public_key,
            setup_params,
        }
    }
}
