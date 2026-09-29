pub trait DelegationEvidence {
    /// Getter function for the delegatee_id variable.
    fn delegatee_id(&self) -> &String;
    /// Getter function for the accumulator_value variable.
    fn accumulator_value(&self) -> &String;
    /// Getter function for the iat variable.
    fn iat(&self) -> &String;
    /// Getter function for the exp variable.
    fn exp(&self) -> &String;
    /// Exact issuer accumulator public-material version used at issuance.
    fn issuer_material_version(&self) -> u64;
    /// Getter function for the metadata_witnesses variable.
    fn metadata_witness(&self) -> &String;
    /// Getter function for the permission_witnesses variable.
    fn permission_witnesses(&self) -> &Vec<String>;
}
