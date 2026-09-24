use serde::Serialize;
use serde_json::{Map, Value};
use std::fmt::Display;

pub trait Credential: Clone + Display + Serialize {
    /// Type of claim selectively disclosed by this credential.
    type Claim: Clone + PartialEq;

    /// Function that returns a static string containing the type of the credential.
    fn credential_type(&self) -> &'static str;

    /// Builds an Credential instance from a serde_json Map<String, Value>.
    ///
    /// # Arguments
    /// * `map` - the map object to build the Credential instance from.
    ///
    /// # Returns
    /// A result containing the Credential instance or an error containing a string in case of failure.
    fn from_map(map: Map<String, Value>) -> Result<Self, String>
    where
        Self: Sized;

    /// Builds an Credential instance from a json string.
    ///
    /// # Arguments
    /// * `str` - the json string used to build the instance.
    ///
    /// # Returns
    /// A result containing the Credential instance or an error as a string in case of failure.
    fn from_string(str: String) -> Result<Self, String>
    where
        Self: Sized;

    /// Generates a serde_json Map<String, Value> object from the current Credential instance.
    ///
    /// # Returns
    /// A result containing the Map<String, Value> or an error as a string in case of failure.
    fn to_map(&self) -> Result<Map<String, Value>, String>;

    /// Generates a serde_json Map<String, Value> object from the current Credential instance.
    ///
    /// # Returns
    /// A result containing the Map<String, Value> or an error as a string in case of failure.
    fn to_string(&self) -> Result<String, String>;

    /// Function that enables Selective Disclosure in this credential. It only retains the claims specified and modifies the verification values accordingly.
    ///
    /// # Arguments
    /// * `allowed` - claims to be kept in the credential.
    ///
    /// # Returns
    /// A result containing the indices of the claims removed from the credential or an error as a string in case of failure.
    fn retain_only(&mut self, allowed: Vec<Self::Claim>) -> Result<Vec<usize>, String>;

    /// Checks whether the credential still contains the necessary elements for a presentation.
    /// # Returns
    /// A boolean value: true if the credential is empty, false otherwise.
    fn is_empty(&self) -> bool;
}
