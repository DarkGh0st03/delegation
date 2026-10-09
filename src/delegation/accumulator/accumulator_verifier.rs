use crate::delegation::accumulator::accumulator_utils::AccumulatorUtils;
use ark_ec::pairing::Pairing;
#[cfg(feature = "parallel_verification")]
use std::thread;
#[cfg(feature = "parallel_verification")]
use std::thread::JoinHandle;
use vb_accumulator::prelude::{
    Accumulator, MembershipWitness, PositiveAccumulator, PublicKey, SetupParams,
};

pub struct AccumulatorVerifier<E: Pairing> {
    accumulator_value: PositiveAccumulator<E::G1Affine>,
    public_key: PublicKey<E>,
    params: SetupParams<E>,
}

impl<E: Pairing> AccumulatorVerifier<E> {
    /// Creates a new AccumulatorVerifier, an object that is used by verifiers to assess the inclusion of elements in
    /// a cryptographic accumulator by leveraging the issuer's public key and setup parameters.
    ///
    /// # Arguments
    /// * `accumulator_value` - a string as computed from the "clone_accumulator" function in AccumulatorManager that represents the state of the accumulator.
    /// * `public_key` - the accumulator manager's public key.
    /// * `params` - the accumulator manager's setup parameters.
    ///
    /// # Returns
    /// A result containing the AccumulatorVerifier instance or an error as a string in case of failure.
    pub fn new(
        accumulator_value: String,
        public_key: PublicKey<E>,
        params: SetupParams<E>,
    ) -> Result<Self, String> {
        let accumulator_value: PositiveAccumulator<E::G1Affine> =
            AccumulatorUtils::<E>::deserialize(&accumulator_value)?;

        Ok(AccumulatorVerifier {
            accumulator_value,
            public_key,
            params,
        })
    }

    /// Private function that wraps the verification of witnesses.
    fn verify_witness(
        accumulator_value: &PositiveAccumulator<E::G1Affine>,
        witness: &String,
        element: &String,
        public_key: &PublicKey<E>,
        params: &SetupParams<E>,
    ) -> Result<(), String> {
        let witness_value: MembershipWitness<E::G1Affine> =
            AccumulatorUtils::<E>::deserialize(&witness)?;
        let element_value: E::ScalarField =
            AccumulatorUtils::<E>::convert_string_to_scalar(&element);

        match accumulator_value.verify_membership(
            &element_value,
            &witness_value,
            &public_key,
            &params,
        ) {
            true => Ok(()),
            false => Err(format!("Could not verify membership for element {element}")),
        }
    }

    /// Function that asserts the inclusion of an element within an accumulator value given their
    /// witness.
    ///
    /// # Arguments
    /// * `witness` - witness to be verified.
    /// * `element` - element corresponding to the witness.
    ///
    /// # Returns
    /// A result containing an error as a string in case of failure.
    pub fn verify_accumulator_witness(
        &self,
        witness: &String,
        element: &String,
    ) -> Result<(), String> {
        AccumulatorVerifier::verify_witness(
            &self.accumulator_value,
            witness,
            element,
            &self.public_key,
            &self.params,
        )
    }

    /// Function that asserts the inclusion of elements within an accumulator value given their witnesses.
    ///
    /// # Arguments
    /// * `witnesses` - vector containing the witnesses for each of the elements to be verified, in the same order.
    /// * `elements` - vector containing the elements to be verified.
    /// * `parallel` - since batch verification does not exist in this scope, whether to use threads to parallelize the computation of verification.
    ///
    /// # Returns
    /// A result containing an error as a string in case of failure.
    pub fn verify_accumulator_witnesses(
        &self,
        witnesses: &Vec<String>,
        elements: &Vec<String>,
    ) -> Result<(), String> {
        if elements.len() != witnesses.len() {
            return Err(format!(
                "Witnesses length does not match elements [{} - {}]",
                elements.len(),
                witnesses.len()
            ));
        }

        #[cfg(not(feature = "parallel_verification"))]
        {
            for (witness, element) in witnesses.iter().zip(elements.iter()) {
                AccumulatorVerifier::verify_witness(
                    &self.accumulator_value,
                    witness,
                    element,
                    &self.public_key,
                    &self.params,
                )?;
            }

            Ok(())
        }

        #[cfg(feature = "parallel_verification")]
        {
            // Thread creation has more overhead than value for an empty or single-item batch.
            if witnesses.len() <= 1 {
                for (witness, element) in witnesses.iter().zip(elements.iter()) {
                    AccumulatorVerifier::verify_witness(
                        &self.accumulator_value,
                        witness,
                        element,
                        &self.public_key,
                        &self.params,
                    )?;
                }

                return Ok(());
            }

            let mut threads: Vec<JoinHandle<Result<(), String>>> = vec![];

            for (witness, element) in witnesses.iter().zip(elements.iter()) {
                let accumulator_value = self.accumulator_value.clone();
                let witness = witness.clone();
                let element = element.clone();
                let public_key = self.public_key.clone();
                let params = self.params.clone();

                let thread = thread::spawn(move || {
                    AccumulatorVerifier::verify_witness(
                        &accumulator_value,
                        &witness,
                        &element,
                        &public_key,
                        &params,
                    )
                });
                threads.push(thread);
            }

            for thread in threads {
                match thread.join() {
                    Ok(Ok(())) => {}
                    Ok(Err(err)) => return Err(err),
                    Err(_) => {
                        return Err(String::from("Thread verifying witness panicked"));
                    }
                }
            }

            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delegation::accumulator::accumulator_manager::AccumulatorManager;
    use ark_bn254::Bn254;
    use ark_std::rand::SeedableRng;
    use ark_std::rand::prelude::StdRng;
    use vb_accumulator::prelude::{Keypair, SetupParams};

    fn verifier_fixture(
        elements: &[String],
    ) -> Result<(AccumulatorVerifier<Bn254>, Vec<String>), String> {
        let mut rng = StdRng::from_entropy();
        let params = SetupParams::<Bn254>::generate_using_rng(&mut rng);
        let keypair = Keypair::<Bn254>::generate_using_rng(&mut rng, &params);
        let mut manager = AccumulatorManager::<Bn254>::new(&keypair.secret_key, &params);

        let scalars = elements
            .iter()
            .map(AccumulatorUtils::<Bn254>::convert_string_to_scalar)
            .collect::<Vec<_>>();

        manager.add_elements(scalars.clone())?;
        let witnesses = manager.compute_witnesses(&scalars)?;
        let accumulator_value = manager.clone_accumulator()?;
        let verifier =
            AccumulatorVerifier::new(accumulator_value, keypair.public_key.clone(), params)?;

        Ok((verifier, witnesses))
    }

    #[test]
    fn verifies_valid_batch() -> Result<(), String> {
        let elements = vec![
            String::from("permission:read"),
            String::from("permission:write"),
        ];
        let (verifier, witnesses) = verifier_fixture(&elements)?;

        verifier.verify_accumulator_witnesses(&witnesses, &elements)
    }

    #[test]
    fn rejects_invalid_witness_element_pair_in_batch() -> Result<(), String> {
        let issued_elements = vec![
            String::from("permission:read"),
            String::from("permission:write"),
        ];
        let (verifier, witnesses) = verifier_fixture(&issued_elements)?;

        let presented_elements = vec![issued_elements[0].clone(), String::from("permission:admin")];

        assert!(
            verifier
                .verify_accumulator_witnesses(&witnesses, &presented_elements)
                .is_err()
        );
        Ok(())
    }
}
