use ark_std::rand::prelude::StdRng;
use ark_std::rand::{Rng, SeedableRng};
use digest::Digest;
use josekit::jwk::Jwk;
use josekit::jws::{ES256, JwsVerifier};
use multibase::Base::Base64Url;
use sha2::Sha256;

/// A function to randomly generate salts.
///
/// # Returns
/// The vector of salts created.
pub fn generate_random_salt() -> String {
    let mut bytes = vec![0; 32];
    let mut rng = StdRng::from_entropy();

    rng.fill(&mut bytes[..]);
    Base64Url.encode(bytes)
}

/// Function to generate the salted hash of a permission.
///
/// # Arguments
/// * `permission` - Permission to be hashed.
/// * `salt` - The salt corresponding to such permission.
///
/// # Returns
/// The hash encoded as a string.
pub fn hash(permission: &String, salt: &String) -> String {
    let mut hasher = Sha256::new();
    let mut hasher_input = permission.clone();

    hasher_input.push_str(salt.as_str());
    hasher.update(hasher_input);

    let encoded_result = Base64Url.encode(hasher.finalize());
    encoded_result
}

/// Generates a valid signature over the necessary data.
///
/// # Arguments
/// * `jwk` - JSON Web Key containing the secret key to be used to produce the signature.
/// * `delegatee_id` - identifier of the delegatee.
/// * `iat` - string containing the time in which the credential was issued.
/// * `exp` - string containing the expiration time for the credential.
/// * `hashes` - list of salted hashes generated from permissions.
///
/// # Returns
/// The signature encoded as a string.
pub fn generate_signature(
    jwk: &Jwk,
    delegatee_id: &String,
    iat: &String,
    exp: &String,
    hashes: &Vec<String>,
) -> Result<String, String> {
    let mut bytes = vec![];

    bytes.extend_from_slice(delegatee_id.as_bytes());
    bytes.extend_from_slice(&iat.as_bytes());
    bytes.extend_from_slice(&exp.as_bytes());
    bytes.extend_from_slice(&hashes.join("").as_bytes());

    let signer = match ES256.signer_from_jwk(jwk) {
        Ok(signer) => signer,
        Err(e) => {
            return Err(format!("Failed to set signer for jwk {}", e));
        }
    };

    let vec_signature = match signer.sign(bytes.as_slice()) {
        Ok(vec_signature) => vec_signature,
        Err(e) => {
            return Err(format!("Failed to sign payload [{}]", e));
        }
    };

    Ok(Base64Url.encode(&vec_signature))
}

/// Generates a valid signature over the necessary data.
///
/// # Arguments
/// * `jwk` - JSON Web Key containing the public key to be used to verify the signature.
/// * `signature` - signature to be verified.
/// * `delegatee_id` - identifier of the delegatee.
/// * `iat` - string containing the time in which the credential was issued.
/// * `exp` - string containing the expiration time for the credential.
/// * `hashes` - list of salted hashes generated from permissions.
///
/// # Returns
/// The signature encoded as a string.
pub fn verify_signature(
    jwk: &Jwk,
    signature: &String,
    delegatee_id: &String,
    iat: &String,
    exp: &String,
    hashes: &Vec<String>,
) -> Result<(), String> {
    let mut bytes = vec![];

    bytes.extend_from_slice(delegatee_id.as_bytes());
    bytes.extend_from_slice(&iat.as_bytes());
    bytes.extend_from_slice(&exp.as_bytes());
    bytes.extend_from_slice(&hashes.join("").as_bytes());

    let verifier = match ES256.verifier_from_jwk(jwk) {
        Ok(verifier) => verifier,
        Err(e) => {
            return Err(format!("Failed to set verifier for jwk {}", e));
        }
    };

    let decoded_signature = match Base64Url.decode(signature) {
        Ok(decoded_signature) => decoded_signature,
        Err(err) => return Err(format!("Failed to decode signature [{}]", err.to_string())),
    };

    match verifier.verify(bytes.as_slice(), decoded_signature.as_slice()) {
        Ok(()) => Ok(()),
        Err(e) => Err(format!("Failed to verify payload [{}]", e)),
    }
}
