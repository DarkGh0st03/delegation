use crate::delegation::accumulator::accumulator_public_data::AccumulatorPublicData;
use crate::delegation::status::model::status_list_credential_artifact::StatusListCredentialArtifact;
use crate::delegation::status::provider::status_list_credential_provider_trait::StatusListCredentialProvider;
use crate::delegation::trust::material::accumulator_material_provider::AccumulatorMaterialProvider;
use ark_ec::pairing::Pairing;
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::marker::PhantomData;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const MAX_ACCUMULATOR_BYTES: usize = 1024 * 1024;
const MAX_STATUS_BYTES: usize = 1024 * 1024;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Public verification artifacts shared across *independent processes*.
///
/// This is an untrusted byte source, NOT a trust resolver:
///  - EvmTrustResolver must compare canonical accumulator material with the
///    immutable hash/version anchored in IssuerRegistry.
///  - JwtAuthenticatedStatusListCredentialProvider must verify the JWT using
///    the issuer's DID key, and EvmAnchoredStatusListResolver MUST compare
///    its original bytes with the current on-chain artifact hash.
///
/// No private keys, signing credentials, DIDs with embedded secrets, or
/// developer-defined paths are stored here. The directory is provisioned by
/// an operator; it MUST NOT be writable by untrusted agents.
pub struct FilePublicArtifactStore<E: Pairing> {
    root: PathBuf,
    _curve: PhantomData<E>,
}

impl<E: Pairing> FilePublicArtifactStore<E> {
    pub fn new(root: impl AsRef<Path>) -> Result<Self, String> {
        let root = root.as_ref();
        if root.as_os_str().is_empty() {
            return Err(String::from("Public artifact directory cannot be empty"));
        }
        fs::create_dir_all(root)
            .map_err(|err| format!("Could not create public artifact directory [{err}]"))?;
        let root = fs::canonicalize(root)
            .map_err(|err| format!("Could not resolve public artifact directory [{err}]"))?;
        if !root.is_dir() {
            return Err(String::from("Public artifact root must be a directory"));
        }
        let store = Self {
            root,
            _curve: PhantomData,
        };
        for name in ["accumulators", "status-lists"] {
            let path = store.root.join(name);
            fs::create_dir_all(&path)
                .map_err(|err| format!("Could not create artifact subdirectory [{err}]"))?;
            let metadata = fs::symlink_metadata(&path)
                .map_err(|err| format!("Could not inspect artifact subdirectory [{err}]"))?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(String::from("Artifact subdirectory must not be a symlink"));
            }
        }
        Ok(store)
    }

    fn key(parts: &[&str]) -> String {
        let mut hasher = Sha256::new();
        for part in parts {
            hasher.update((part.len() as u64).to_be_bytes());
            hasher.update(part.as_bytes());
        }
        hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    fn accumulator_path(&self, issuer: &str, version: u64) -> Result<PathBuf, String> {
        if issuer.trim().is_empty() || version == 0 {
            return Err(String::from("Invalid public accumulator issuer or version"));
        }
        Ok(self
            .root
            .join("accumulators")
            .join(format!("{}_v{version}.bin", Self::key(&[issuer]))))
    }

    fn status_path(&self, issuer: &str, url: &str) -> Result<PathBuf, String> {
        if issuer.trim().is_empty() || url.trim().is_empty() {
            return Err(String::from("Invalid Status List issuer or URL"));
        }
        Ok(self
            .root
            .join("status-lists")
            .join(format!("{}.jwt", Self::key(&[issuer, url]))))
    }

    fn read_bounded(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
        let metadata = fs::symlink_metadata(path)
            .map_err(|err| format!("Public verification artifact unavailable [{err}]"))?;
        if !metadata.file_type().is_file() || metadata.len() > limit as u64 {
            return Err(String::from(
                "Public verification artifact is unsafe or oversized",
            ));
        }
        let mut f =
            File::open(path).map_err(|err| format!("Cannot read verification artifact [{err}]"))?;
        let mut data = Vec::new();
        f.take((limit + 1) as u64)
            .read_to_end(&mut data)
            .map_err(|err| format!("Cannot read verification artifact bytes [{err}]"))?;
        if data.len() > limit {
            return Err(String::from("Verification artifact exceeds its size limit"));
        }
        Ok(data)
    }

    /// Write the immutable, canonical public material for an issuer/version.
    /// An existing version is accepted only when the bytes are identical.
    pub fn publish_accumulator(
        &self,
        issuer: &str,
        version: u64,
        material: &AccumulatorPublicData<E>,
    ) -> Result<(), String> {
        let path = self.accumulator_path(issuer, version)?;
        let mut bytes = Vec::new();
        material
            .serialize_compressed(&mut bytes)
            .map_err(|err| format!("Cannot encode accumulator public material [{err}]"))?;
        if bytes.is_empty() || bytes.len() > MAX_ACCUMULATOR_BYTES {
            return Err(String::from("Invalid public accumulator artifact size"));
        }
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                f.write_all(&bytes)
                    .and_then(|_| f.sync_all())
                    .map_err(|err| format!("Cannot publish accumulator artifact [{err}]"))?;
                Ok(())
            }
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                if Self::read_bounded(&path, MAX_ACCUMULATOR_BYTES)? == bytes {
                    Ok(())
                } else {
                    Err(String::from(
                        "Immutable accumulator version already has different bytes",
                    ))
                }
            }
            Err(err) => Err(format!("Cannot create accumulator artifact [{err}]")),
        }
    }

    /// Publish only a compact signed Status List JWT. The file swap is atomic;
    /// verifiers must reject a JWT whose commitment is not currently on-chain.
    pub fn publish_status_jwt(
        &self,
        issuer: &str,
        url: &str,
        signed_jwt: &str,
    ) -> Result<(), String> {
        let path = self.status_path(issuer, url)?;
        if signed_jwt.is_empty()
            || signed_jwt.len() > MAX_STATUS_BYTES
            || signed_jwt.split('.').count() != 3
            || !signed_jwt
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
        {
            return Err(String::from(
                "Status List artifact must be a bounded compact JWT",
            ));
        }

        let number = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let name = format!(".status-{}-{number}.tmp", std::process::id());
        let temp = path.with_file_name(name);
        let result = (|| -> Result<(), String> {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(|err| format!("Cannot stage Status List artifact [{err}]"))?;
            file.write_all(signed_jwt.as_bytes())
                .and_then(|_| file.sync_all())
                .map_err(|err| format!("Cannot persist Status List artifact [{err}]"))?;
            // Reject a malicious symlink at the destination instead of replacing
            // an unexpected path. The containing directory must be trusted.
            if let Ok(meta) = fs::symlink_metadata(&path) {
                if !meta.is_file() || meta.file_type().is_symlink() {
                    return Err(String::from(
                        "Invalid Status List destination artifact type",
                    ));
                }
            }
            fs::rename(&temp, &path)
                .map_err(|err| format!("Cannot publish Status List artifact [{err}]"))?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result
    }
}

impl<E: Pairing> AccumulatorMaterialProvider<E> for FilePublicArtifactStore<E> {
    fn get_accumulator_data_at_version(
        &self,
        issuer: &str,
        version: u64,
    ) -> Result<AccumulatorPublicData<E>, String> {
        let raw = Self::read_bounded(
            &self.accumulator_path(issuer, version)?,
            MAX_ACCUMULATOR_BYTES,
        )?;
        let mut bytes = raw.as_slice();
        let material = AccumulatorPublicData::<E>::deserialize_compressed(&mut bytes)
            .map_err(|err| format!("Cannot decode public accumulator artifact [{err}]"))?;
        if !bytes.is_empty() {
            return Err(String::from(
                "Public accumulator artifact has trailing bytes",
            ));
        }
        Ok(material)
    }
}

impl<E: Pairing> StatusListCredentialProvider for FilePublicArtifactStore<E> {
    fn get_status_list_credential(
        &self,
        issuer: &str,
        url: &str,
    ) -> Result<StatusListCredentialArtifact, String> {
        let raw = Self::read_bounded(&self.status_path(issuer, url)?, MAX_STATUS_BYTES)?;
        let document = String::from_utf8(raw.clone())
            .map_err(|err| format!("Status List artifact is not UTF-8 [{err}]"))?;
        Ok(StatusListCredentialArtifact {
            document,
            commitment_bytes: raw,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delegation::trust::resolver::evm_trust_resolver::EvmTrustResolver;
    use ark_bn254::Bn254;
    use ark_std::rand::{SeedableRng, prelude::StdRng};
    use vb_accumulator::prelude::{Keypair, SetupParams};

    fn dir() -> Result<PathBuf, String> {
        let path = std::env::temp_dir().join(format!(
            "delegation-public-artifacts-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).map_err(|err| err.to_string())?;
        Ok(path)
    }
    fn material() -> AccumulatorPublicData<Bn254> {
        let mut rng = StdRng::from_entropy();
        let params = SetupParams::<Bn254>::generate_using_rng(&mut rng);
        let keypair = Keypair::<Bn254>::generate_using_rng(&mut rng, &params);
        AccumulatorPublicData::new(keypair.public_key, params)
    }

    #[test]
    fn independent_reader_recovers_same_public_material_and_chain_commitment() -> Result<(), String>
    {
        let dir = dir()?;
        let issuer = "did:ethr:0x7a69:0x1234";
        let producer = FilePublicArtifactStore::<Bn254>::new(&dir)?;
        let expected = material();
        let commitment = EvmTrustResolver::<Bn254>::accumulator_material_commitment(&expected)?;
        producer.publish_accumulator(issuer, 1, &expected)?;
        let reader = FilePublicArtifactStore::<Bn254>::new(&dir)?;
        let observed = reader.get_accumulator_data_at_version(issuer, 1)?;
        assert_eq!(
            EvmTrustResolver::<Bn254>::accumulator_material_commitment(&observed)?,
            commitment
        );
        assert!(reader.get_accumulator_data_at_version(issuer, 2).is_err());
        assert!(
            reader
                .get_accumulator_data_at_version("different-issuer", 1)
                .is_err()
        );
        let changed = material();
        assert!(producer.publish_accumulator(issuer, 1, &changed).is_err());
        producer.publish_accumulator(issuer, 1, &expected)?;
        fs::remove_dir_all(dir).map_err(|err| err.to_string())
    }

    #[test]
    fn independent_reader_sees_atomic_status_updates_and_exact_jwt_bytes() -> Result<(), String> {
        let dir = dir()?;
        let producer = FilePublicArtifactStore::<Bn254>::new(&dir)?;
        let reader = FilePublicArtifactStore::<Bn254>::new(&dir)?;
        let issuer = "did:ethr:0x7a69:0x1234";
        let url = "https://status.example/list";
        assert!(reader.get_status_list_credential(issuer, url).is_err());
        producer.publish_status_jwt(issuer, url, "header.payload.signature")?;
        assert_eq!(
            reader
                .get_status_list_credential(issuer, url)?
                .commitment_bytes,
            b"header.payload.signature"
        );
        producer.publish_status_jwt(issuer, url, "next.payload.signature")?;
        assert_eq!(
            reader.get_status_list_credential(issuer, url)?.document,
            "next.payload.signature"
        );
        assert!(
            reader
                .get_status_list_credential(issuer, "https://other/list")
                .is_err()
        );
        assert!(producer.publish_status_jwt(issuer, url, "not jwt").is_err());
        fs::remove_dir_all(dir).map_err(|err| err.to_string())
    }
}
