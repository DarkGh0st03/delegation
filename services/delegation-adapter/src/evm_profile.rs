use crate::auth::{CallerRegistry, CallerRole};
use crate::config::EvmAdapterConfig;
use alloy::primitives::{Address, B256};
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use alloy::sol;
use ark_bn254::Bn254;
use delegation::delegation::accumulator::accumulator_public_data::AccumulatorPublicData;
use delegation::delegation::issuance::delegation_issuer::DelegationIssuer;
use delegation::delegation::issuance::issuer_trait::Issuer;
use delegation::delegation::local::in_memory_trust_store::InMemoryTrustStore;
use delegation::delegation::status::evm::status_list_anchor_reader::StatusListAnchorReader;
use delegation::delegation::status::model::bitstring_status_list_entry::BitstringStatusListEntry;
use delegation::delegation::status::model::status_list_credential_artifact::StatusListCredentialArtifact;
use delegation::delegation::status::model::status_purpose::StatusPurpose;
use delegation::delegation::status::provider::jwt_status_list_provider::{
    JwtAuthenticatedStatusListCredentialProvider, sign_status_list_credential_jwt,
};
use delegation::delegation::status::provider::status_list_credential_provider_trait::{
    StatusListCredentialProvider, StatusListCredentialProviderRef,
};
use delegation::delegation::status::resolver::evm_anchored_status_list_resolver::EvmAnchoredStatusListResolver;
use delegation::delegation::status::resolver::status_list_resolver_trait::StatusListResolverRef;
use delegation::delegation::trust::evm::evm_registry_reader::EvmRegistryReader;
use delegation::delegation::trust::evm::trust_chain_reader::TrustChainReader;
use delegation::delegation::trust::material::accumulator_material_provider::{
    AccumulatorMaterialProvider, AccumulatorMaterialProviderRef,
};
use delegation::delegation::trust::material::did_ethr_verification_key_provider::DidEthrVerificationKeyProvider;
use delegation::delegation::trust::material::verification_key_provider::VerificationKeyProviderRef;
use delegation::delegation::trust::resolver::evm_trust_resolver::EvmTrustResolver;
use delegation::delegation::trust::resolver::trust_resolver_trait::{
    TrustResolver, TrustResolverRef,
};
use delegation::delegation::verification::delegation_verifier::DelegationVerifier;
use delegation::delegation::verification::verifier_trait::Verifier;
use flate2::Compression;
use flate2::write::GzEncoder;
use josekit::jwk::Jwk;
use multibase::Base;
use serde::Serialize;
use std::cell::RefCell;
use std::collections::HashMap;
use std::io::Write;
use std::process::Command;
use std::rc::Rc;
use std::str::FromStr;
use tokio::runtime::Runtime;

type Curve = Bn254;

const STATUS_LIST_BYTES: usize = 16 * 1024;
const MANAGED_ROLES: [CallerRole; 5] = [
    CallerRole::Engineer,
    CallerRole::Orchestrator,
    CallerRole::Backend,
    CallerRole::Frontend,
    CallerRole::Test,
];

sol! {
    #[sol(rpc)]
    interface EnterpriseTrustRegistryWriterContract {
        function enrollEnterpriseIdentity(address identity) external;
        function setTrustAnchor(address identity, bool enabled) external;
        function isActive(address identity) external view returns (bool);
        function isTrustAnchor(address identity) external view returns (bool);
    }

    #[sol(rpc)]
    interface IssuerRegistryWriterContract {
        function publishAccumulatorMaterial(address issuer, bytes32 materialHash)
            external
            returns (uint64 version);

        function registerStatusList(
            address issuer,
            bytes32 listId,
            uint8 purpose,
            bytes32 documentHash
        ) external;
    }
}

struct IssuanceAccumulatorProvider {
    store: Rc<InMemoryTrustStore<Curve>>,
}

impl AccumulatorMaterialProvider<Curve> for IssuanceAccumulatorProvider {
    fn get_accumulator_data_at_version(
        &self,
        identity_id: &str,
        version: u64,
    ) -> Result<AccumulatorPublicData<Curve>, String> {
        self.store
            .get_accumulator_data_at_version(identity_id, version)
    }
}

#[derive(Default)]
struct IssuerAwareStatusProvider {
    documents: RefCell<HashMap<(String, String), String>>,
}

impl IssuerAwareStatusProvider {
    fn insert(&self, issuer_id: String, url: String, document: String) {
        self.documents
            .borrow_mut()
            .insert((issuer_id, url), document);
    }
}

impl StatusListCredentialProvider for IssuerAwareStatusProvider {
    fn get_status_list_credential(
        &self,
        issuer_id: &str,
        url: &str,
    ) -> Result<StatusListCredentialArtifact, String> {
        let document = self
            .documents
            .borrow()
            .get(&(issuer_id.to_string(), url.to_string()))
            .cloned()
            .ok_or_else(|| {
                format!("Status List Credential {url} is not available for issuer {issuer_id}")
            })?;

        Ok(StatusListCredentialArtifact {
            commitment_bytes: document.as_bytes().to_vec(),
            document,
        })
    }
}

pub struct EvmAdapterProfile {
    config: EvmAdapterConfig,
    runtime: Runtime,
    chain_reader: Rc<EvmRegistryReader>,
    status_source: Rc<IssuerAwareStatusProvider>,
}

impl EvmAdapterProfile {
    pub fn initialize(
        config: &EvmAdapterConfig,
        callers: &CallerRegistry,
        issuance_store: Rc<InMemoryTrustStore<Curve>>,
        issuers: &HashMap<CallerRole, DelegationIssuer<Curve>>,
    ) -> Result<(Self, DelegationVerifier<Curve>), String> {
        let runtime =
            Runtime::new().map_err(|err| format!("Could not create EVM writer runtime [{err}]"))?;

        let profile = Self {
            config: config.clone(),
            runtime,
            chain_reader: Rc::new(EvmRegistryReader::connect(
                &config.rpc_url,
                &config.did_registry_address,
                &config.enterprise_trust_registry_address,
                &config.issuer_registry_address,
                config.chain_id,
            )?),
            status_source: Rc::new(IssuerAwareStatusProvider::default()),
        };

        profile.bootstrap_identities(callers, issuance_store.clone(), issuers)?;

        let accumulator_provider: AccumulatorMaterialProviderRef<Curve> =
            Rc::new(IssuanceAccumulatorProvider {
                store: issuance_store,
            });
        let did_keys = Rc::new(DidEthrVerificationKeyProvider::new(
            &config.did_resolver_script,
            &config.rpc_url,
            &config.did_registry_address,
            config.chain_id,
        ));
        let verification_keys: VerificationKeyProviderRef = did_keys.clone();

        for role in MANAGED_ROLES {
            verification_keys.get_verification_key(callers.identity_for_role(role)?)?;
        }

        let trust_reader: Rc<dyn TrustChainReader> = profile.chain_reader.clone();
        let trust_resolver: TrustResolverRef<Curve> = Rc::new(EvmTrustResolver::new(
            trust_reader,
            accumulator_provider,
            verification_keys.clone(),
        ));

        let raw_status_provider: StatusListCredentialProviderRef = profile.status_source.clone();
        let status_provider: StatusListCredentialProviderRef =
            Rc::new(JwtAuthenticatedStatusListCredentialProvider::new(
                raw_status_provider,
                verification_keys,
            ));
        let status_reader: Rc<dyn StatusListAnchorReader> = profile.chain_reader.clone();
        let status_resolver: StatusListResolverRef = Rc::new(EvmAnchoredStatusListResolver::new(
            status_provider,
            status_reader,
        ));

        let verifier = DelegationVerifier::<Curve>::new(trust_resolver, status_resolver)?;
        Ok((profile, verifier))
    }

    pub fn register_active_status(
        &self,
        issuer_role: CallerRole,
        issuer_id: &str,
        entry: &BitstringStatusListEntry,
        signing_jwk: &Jwk,
    ) -> Result<(), String> {
        let (purpose_code, purpose_name) = status_purpose(entry.status_purpose())?;
        let document = status_list_document(issuer_id, entry, purpose_name)?;
        let signed_status = sign_status_list_credential_jwt(&document, signing_jwk)?;
        let commitment = EvmAnchoredStatusListResolver::artifact_commitment(&signed_status);
        let existing = self
            .chain_reader
            .status_list_anchor(issuer_id, entry.status_list_credential())?;

        if existing.exists {
            if existing.purpose != purpose_code || existing.current_document_hash != commitment {
                return Err(format!(
                    "Existing EVM Status List anchor for {} and issuer {} does not match the Adapter active document",
                    entry.status_list_credential(),
                    issuer_id
                ));
            }
        } else {
            let issuer_address = did_address(issuer_id)?;
            let list_id = EvmRegistryReader::status_list_id(entry.status_list_credential());
            self.runtime.block_on(register_status_list(
                &self.config.rpc_url,
                &self.config.issuer_registry_address,
                self.config.private_key_for(issuer_role)?,
                issuer_address,
                list_id,
                purpose_code,
                commitment,
            ))?;

            let anchored = self
                .chain_reader
                .status_list_anchor(issuer_id, entry.status_list_credential())?;
            if !anchored.exists
                || anchored.purpose != purpose_code
                || anchored.current_document_hash != commitment
                || anchored.current_version == 0
            {
                return Err(format!(
                    "EVM Status List anchor did not become visible for issuer {issuer_id}"
                ));
            }
        }

        self.status_source.insert(
            issuer_id.to_string(),
            entry.status_list_credential().to_string(),
            signed_status,
        );
        Ok(())
    }

    fn bootstrap_identities(
        &self,
        callers: &CallerRegistry,
        issuance_store: Rc<InMemoryTrustStore<Curve>>,
        issuers: &HashMap<CallerRole, DelegationIssuer<Curve>>,
    ) -> Result<(), String> {
        let identities = MANAGED_ROLES
            .iter()
            .map(|role| {
                let identity = callers.identity_for_role(*role)?.to_string();
                let address = did_address(&identity)?;
                let private_key = self.config.private_key_for(*role)?;
                let signer: PrivateKeySigner = private_key
                    .parse()
                    .map_err(|err| format!("Invalid EVM private key for {role:?} [{err}]"))?;
                if signer.address() != address {
                    return Err(format!(
                        "EVM private key for {role:?} controls {}, but Adapter identity is {identity}",
                        signer.address()
                    ));
                }
                Ok((*role, identity, address))
            })
            .collect::<Result<Vec<_>, String>>()?;

        let addresses = identities
            .iter()
            .map(|(_, _, address)| *address)
            .collect::<Vec<_>>();
        let engineer = did_address(callers.identity_for_role(CallerRole::Engineer)?)?;

        self.runtime.block_on(ensure_enterprise_state(
            &self.config.rpc_url,
            &self.config.enterprise_trust_registry_address,
            &self.config.governance_private_key,
            &addresses,
            engineer,
        ))?;

        for (role, identity, address) in identities {
            let issuer = issuers
                .get(&role)
                .ok_or_else(|| format!("Missing Adapter issuer for {role:?}"))?;

            publish_did_ed25519(
                &self.config,
                &identity,
                self.config.private_key_for(role)?,
                issuer.holder_jwk(),
            )?;

            let material = issuance_store.get_accumulator_data_at_version(&identity, 1)?;
            let commitment = EvmTrustResolver::<Curve>::accumulator_material_commitment(&material)?;
            let current_version = self
                .chain_reader
                .latest_accumulator_material_version(&identity)?;

            match current_version {
                0 => self.runtime.block_on(publish_accumulator(
                    &self.config.rpc_url,
                    &self.config.issuer_registry_address,
                    self.config.private_key_for(role)?,
                    address,
                    commitment,
                ))?,
                1 => {
                    let existing = self
                        .chain_reader
                        .accumulator_material_anchor(&identity, 1)?;
                    if !existing.exists || existing.material_hash != commitment {
                        return Err(format!(
                            "Existing accumulator anchor for {identity} does not match this Adapter runtime"
                        ));
                    }
                }
                version => {
                    return Err(format!(
                        "Identity {identity} already has accumulator version {version}; the EVM Adapter profile requires a fresh or matching chain"
                    ));
                }
            }

            let anchored = self
                .chain_reader
                .accumulator_material_anchor(&identity, 1)?;
            if !anchored.exists || anchored.material_hash != commitment {
                return Err(format!(
                    "Accumulator commitment for {identity} was not anchored correctly"
                ));
            }
        }

        let engineer_id = callers.identity_for_role(CallerRole::Engineer)?;
        if !self.chain_reader.is_trust_anchor(engineer_id)? {
            return Err(format!(
                "Engineer identity {engineer_id} is not an active EVM trust anchor"
            ));
        }
        Ok(())
    }
}

fn status_purpose(purpose: &StatusPurpose) -> Result<(u8, &'static str), String> {
    match purpose {
        StatusPurpose::Revocation => Ok((1, "revocation")),
        StatusPurpose::Suspension => Ok((2, "suspension")),
        StatusPurpose::Message => Err(String::from(
            "Status purpose message is not supported by the EVM Adapter profile",
        )),
    }
}

fn status_list_document(
    issuer_id: &str,
    entry: &BitstringStatusListEntry,
    purpose: &str,
) -> Result<String, String> {
    let index = entry.status_list_index().parse::<usize>().map_err(|err| {
        format!(
            "Invalid statusListIndex {} [{err}]",
            entry.status_list_index()
        )
    })?;
    if index >= STATUS_LIST_BYTES * 8 {
        return Err(format!(
            "statusListIndex {index} exceeds the EVM Adapter status-list capacity"
        ));
    }

    let bitstring = vec![0u8; STATUS_LIST_BYTES];
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(&bitstring)
        .map_err(|err| format!("Could not compress Status List bitstring [{err}]"))?;
    let compressed = encoder
        .finish()
        .map_err(|err| format!("Could not finish Status List compression [{err}]"))?;
    let encoded = multibase::encode(Base::Base64Url, compressed);

    serde_json::to_string(&serde_json::json!({
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        "id": entry.status_list_credential(),
        "type": ["VerifiableCredential", "BitstringStatusListCredential"],
        "issuer": issuer_id,
        "validFrom": "2026-01-01T00:00:00Z",
        "credentialSubject": {
            "id": format!("{}#list", entry.status_list_credential()),
            "type": "BitstringStatusList",
            "statusPurpose": purpose,
            "encodedList": encoded
        }
    }))
    .map_err(|err| format!("Could not encode Status List Credential [{err}]"))
}

fn did_address(did: &str) -> Result<Address, String> {
    let address = did
        .rsplit(':')
        .next()
        .ok_or_else(|| format!("Invalid did:ethr identifier {did}"))?;
    Address::from_str(address)
        .map_err(|err| format!("Invalid address in did:ethr identifier {did} [{err}]"))
}

fn public_jwk_json<T: Serialize>(jwk: &T) -> Result<String, String> {
    let mut value =
        serde_json::to_value(jwk).map_err(|err| format!("Could not serialize JWK [{err}]"))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| String::from("JWK serialization was not a JSON object"))?;
    object.remove("d");
    serde_json::to_string(&value).map_err(|err| format!("Could not encode public JWK [{err}]"))
}

fn publish_did_ed25519<T: Serialize>(
    config: &EvmAdapterConfig,
    expected_identity: &str,
    identity_private_key: &str,
    signing_jwk: &T,
) -> Result<(), String> {
    let output = Command::new("node")
        .arg(&config.did_publisher_script)
        .env("RPC_URL", &config.rpc_url)
        .env("REGISTRY_ADDRESS", &config.did_registry_address)
        .env("CHAIN_ID", config.chain_id.to_string())
        .env("IDENTITY_PRIVATE_KEY", identity_private_key)
        .env("ED25519_JWK", public_jwk_json(signing_jwk)?)
        .output()
        .map_err(|err| {
            format!(
                "Could not launch DID publication script {} [{err}]",
                config.did_publisher_script
            )
        })?;

    if !output.status.success() {
        return Err(format!(
            "DID Ed25519 publication failed for {expected_identity}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let published = stdout
        .lines()
        .find_map(|line| line.trim().strip_prefix("did="))
        .ok_or_else(|| {
            format!("DID publication for {expected_identity} did not report the published DID")
        })?;

    if did_address(published)? != did_address(expected_identity)? {
        return Err(format!(
            "DID publication returned {published}, expected {expected_identity}"
        ));
    }

    Ok(())
}

async fn ensure_enterprise_state(
    rpc_url: &str,
    enterprise_registry: &str,
    governance_private_key: &str,
    identities: &[Address],
    engineer: Address,
) -> Result<(), String> {
    let governance_signer: PrivateKeySigner = governance_private_key
        .parse()
        .map_err(|err| format!("Invalid GOVERNANCE_PRIVATE_KEY [{err}]"))?;
    let provider = ProviderBuilder::new()
        .wallet(governance_signer)
        .connect(rpc_url)
        .await
        .map_err(|err| format!("Could not connect governance EVM provider [{err}]"))?;
    let address = Address::from_str(enterprise_registry)
        .map_err(|err| format!("Invalid EnterpriseTrustRegistry address [{err}]"))?;
    let trust = EnterpriseTrustRegistryWriterContract::new(address, &provider);

    for identity in identities {
        let active = trust
            .isActive(*identity)
            .call()
            .await
            .map_err(|err| format!("Could not read enterprise identity {identity} [{err}]"))?;
        if !active {
            trust
                .enrollEnterpriseIdentity(*identity)
                .send()
                .await
                .map_err(|err| format!("Could not enroll enterprise identity {identity} [{err}]"))?
                .get_receipt()
                .await
                .map_err(|err| {
                    format!("Could not confirm enterprise enrollment for {identity} [{err}]")
                })?;
        }
    }

    if !trust
        .isTrustAnchor(engineer)
        .call()
        .await
        .map_err(|err| format!("Could not read Engineer trust-anchor state [{err}]"))?
    {
        trust
            .setTrustAnchor(engineer, true)
            .send()
            .await
            .map_err(|err| format!("Could not set Engineer trust anchor [{err}]"))?
            .get_receipt()
            .await
            .map_err(|err| format!("Could not confirm Engineer trust anchor [{err}]"))?;
    }

    Ok(())
}

async fn publish_accumulator(
    rpc_url: &str,
    issuer_registry: &str,
    private_key: &str,
    issuer: Address,
    commitment: B256,
) -> Result<(), String> {
    let signer: PrivateKeySigner = private_key
        .parse()
        .map_err(|err| format!("Invalid issuer private key [{err}]"))?;
    let provider = ProviderBuilder::new()
        .wallet(signer)
        .connect(rpc_url)
        .await
        .map_err(|err| format!("Could not connect issuer EVM provider [{err}]"))?;
    let address = Address::from_str(issuer_registry)
        .map_err(|err| format!("Invalid IssuerRegistry address [{err}]"))?;
    let registry = IssuerRegistryWriterContract::new(address, &provider);

    registry
        .publishAccumulatorMaterial(issuer, commitment)
        .send()
        .await
        .map_err(|err| format!("Could not publish accumulator commitment [{err}]"))?
        .get_receipt()
        .await
        .map_err(|err| format!("Could not confirm accumulator commitment [{err}]"))?;
    Ok(())
}

async fn register_status_list(
    rpc_url: &str,
    issuer_registry: &str,
    private_key: &str,
    issuer: Address,
    list_id: B256,
    purpose: u8,
    commitment: B256,
) -> Result<(), String> {
    let signer: PrivateKeySigner = private_key
        .parse()
        .map_err(|err| format!("Invalid issuer private key [{err}]"))?;
    let provider = ProviderBuilder::new()
        .wallet(signer)
        .connect(rpc_url)
        .await
        .map_err(|err| format!("Could not connect issuer EVM provider [{err}]"))?;
    let address = Address::from_str(issuer_registry)
        .map_err(|err| format!("Invalid IssuerRegistry address [{err}]"))?;
    let registry = IssuerRegistryWriterContract::new(address, &provider);

    registry
        .registerStatusList(issuer, list_id, purpose, commitment)
        .send()
        .await
        .map_err(|err| format!("Could not register Status List anchor [{err}]"))?
        .get_receipt()
        .await
        .map_err(|err| format!("Could not confirm Status List anchor [{err}]"))?;
    Ok(())
}
