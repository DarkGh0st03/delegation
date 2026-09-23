pub trait SdJWTDelegation {
    /// Getter function for the delegatee_id variable.
    fn delegatee_id(&self) -> &String;
    /// Getter function for the variable containing the list of hashes.
    fn hashes(&self) -> &Vec<String>;
    /// Getter function for the iat variable.
    fn iat(&self) -> &String;
    /// Getter function for the exp variable.
    fn exp(&self) -> &String;
    /// Getter function for the signature over the rest of the delegation object.
    fn signature(&self) -> &String;
}
