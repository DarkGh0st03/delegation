use crate::delegation::accumulator::accumulator_utils::AccumulatorUtils;
use ark_ec::pairing::Pairing;
use std::collections::HashSet;
use std::hash::Hash;
use vb_accumulator::persistence::{State, UniversalAccumulatorState};
use vb_accumulator::positive::{Accumulator, PositiveAccumulator};
use vb_accumulator::prelude::{SecretKey, SetupParams};

/// This class is necessary to the accumulator to simply assert whether a value was or wasn't previously
/// included in it. This makes it so that it's not possible to compute witnesses for elements that are
/// not accumulated.

#[derive(Clone, Debug)]
pub struct InMemoryState<T: Clone> {
    pub db: HashSet<T>,
}

impl<T: Clone> InMemoryState<T> {
    pub fn new() -> Self {
        let db = HashSet::<T>::new();
        Self { db }
    }
}

impl<T: Clone + Hash + Eq + Sized> State<T> for InMemoryState<T> {
    fn add(&mut self, element: T) {
        self.db.insert(element);
    }

    fn remove(&mut self, element: &T) {
        self.db.remove(element);
    }

    fn has(&self, element: &T) -> bool {
        self.db.get(element).is_some()
    }

    fn size(&self) -> u64 {
        self.db.len() as u64
    }
}

impl<'a, T: Clone + Hash + Eq + Sized + 'a> UniversalAccumulatorState<'a, T> for InMemoryState<T> {
    type ElementIterator = std::collections::hash_set::Iter<'a, T>;
    fn elements(&'a self) -> Self::ElementIterator {
        self.db.iter()
    }
}

pub struct AccumulatorManager<'sk, E: Pairing> {
    secret_key: &'sk SecretKey<E::ScalarField>,
    accumulator: PositiveAccumulator<E::G1Affine>,
    state: InMemoryState<E::ScalarField>,
}

impl<'keypair, E: Pairing> AccumulatorManager<'keypair, E> {
    /// Creates a new AccumulatorManager over the pairing E.
    ///
    /// # Arguments
    /// * `secret_key` - Private key used to manage the accumulator.
    /// * `params` - ECC params relative to the accumulator.
    ///
    /// # Returns
    /// A new accumulator manager.
    pub fn new(
        secret_key: &'keypair SecretKey<E::ScalarField>,
        params: &'keypair SetupParams<E>,
    ) -> AccumulatorManager<'keypair, E> {
        let accumulator = PositiveAccumulator::<E::G1Affine>::initialize(params);
        let state: InMemoryState<E::ScalarField> = InMemoryState::new();
        AccumulatorManager {
            secret_key,
            accumulator,
            state,
        }
    }

    /// Returns a serialized copy of the internal accumulator state.
    ///
    /// # Returns
    /// A result either containing the serialized accumulator value as a string or an error.
    pub fn clone_accumulator(&self) -> Result<String, String> {
        AccumulatorUtils::<E>::serialize(&self.accumulator)
    }

    /// Accumulates a single element in the accumulator.
    ///
    /// # Arguments
    /// * `element` - the element to be added to the accumulator, already converted as a scalar in the curve.
    ///
    /// # Returns
    /// A result containing an error as a string in case of failure.
    pub fn add_element(&mut self, element: E::ScalarField) -> Result<(), String> {
        match self
            .accumulator
            .add(element, &self.secret_key, &mut self.state)
        {
            Ok(accumulator) => {
                self.accumulator = accumulator;
                Ok(())
            }
            Err(err) => Err(format!("Error in adding single element: [{:?}]", err)),
        }
    }

    /// Accumulates multiple elements in the accumulator.
    ///
    /// # Arguments
    /// * `elements` - vector containing the elements to be added to the accumulator, already converted as scalars in the curve.
    ///
    /// # Returns
    /// A result containing an error as a string in case of failure.
    pub fn add_elements(&mut self, elements: Vec<E::ScalarField>) -> Result<(), String> {
        match self
            .accumulator
            .add_batch(elements, &self.secret_key, &mut self.state)
        {
            Ok(accumulator) => {
                self.accumulator = accumulator;
                Ok(())
            }
            Err(err) => Err(format!("Error in adding batch elements: [{:?}]", err)),
        }
    }

    /// Removes a single element from the accumulator.
    ///
    /// # Arguments
    /// * `element` - the element to be removed from the accumulator, converted as a scalar in the curve.
    ///
    /// # Returns
    /// A result containing an error as a string in case of failure.
    pub fn remove_element(&mut self, element: E::ScalarField) -> Result<(), String> {
        match self
            .accumulator
            .remove(&element, &self.secret_key, &mut self.state)
        {
            Ok(accumulator) => {
                self.accumulator = accumulator;
                Ok(())
            }
            Err(err) => Err(format!("Error in removing single element: [{:?}]", err)),
        }
    }

    /// Removes an array of elements from the accumulator.
    ///
    /// # Arguments
    /// * `elements` - array of elements to be removed from the accumulator, converted as a scalar in the curve.
    ///
    /// # Returns
    /// A result containing an error as a string in case of failure.
    pub fn remove_elements(&mut self, elements: &[E::ScalarField]) -> Result<(), String> {
        match self
            .accumulator
            .remove_batch(elements, &self.secret_key, &mut self.state)
        {
            Ok(accumulator) => {
                self.accumulator = accumulator;
                Ok(())
            }
            Err(err) => Err(format!("Error in removing batch elements: [{:?}]", err)),
        }
    }

    /// Computes the witness corresponding to the element in input with respect to the current accumulator value.
    ///
    /// # Arguments
    /// * `element` - the element for which the witness will be computed, converted as a scalar in the curve.
    ///
    /// # Returns
    /// A result containing the serialized witness, or an error as a string in case of failure.
    pub fn compute_witness(&mut self, element: E::ScalarField) -> Result<String, String> {
        let witness = self
            .accumulator
            .compute_membership_witness(&element, &self.secret_key);
        AccumulatorUtils::<E>::serialize(&witness)
    }

    /// Computes the witnesses corresponding to the elements in input with respect to the current accumulator value.
    ///
    /// # Arguments
    /// * `elements` - array of elements for which the witnesses will be computed, converted as a scalar in the curve.
    ///
    /// # Returns
    /// A result containing the serialized witnesses, or an error as a string in case of failure.
    pub fn compute_witnesses(
        &mut self,
        elements: &[E::ScalarField],
    ) -> Result<Vec<String>, String> {
        let witnesses = self
            .accumulator
            .compute_membership_witnesses_for_batch(elements, &self.secret_key);
        let mut result = vec![];

        for witness in witnesses {
            result.push(AccumulatorUtils::<E>::serialize(&witness)?);
        }
        Ok(result)
    }
}
