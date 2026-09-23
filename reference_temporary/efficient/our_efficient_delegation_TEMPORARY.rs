use crate::delegation::credentials::ours::asymmetric_mechanism::AsymmetricMechanism;

pub trait OurEfficientDelegation {
    /// Getter function for the delegatee_id variable.
    fn delegatee_id(&self) -> &String;
    /// Getter function for the iat variable.
    fn iat(&self) -> &String;
    /// Getter function for the exp variable.
    fn exp(&self) -> &String;
    /// Getter function for retrieving the underlying asymmetric mechanism variable.
    fn asymmetric_mechanism(&self) -> &AsymmetricMechanism;
}
