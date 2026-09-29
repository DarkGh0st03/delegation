/// Result of retrieving a Status List Credential.
///
/// `document` is the authenticated JSON document consumed by the Bitstring
/// resolver. `commitment_bytes` are the exact externally fetched bytes whose
/// hash must match the current on-chain anchor.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StatusListCredentialArtifact {
    pub document: String,
    pub commitment_bytes: Vec<u8>,
}
