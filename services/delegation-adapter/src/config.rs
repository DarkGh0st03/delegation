use crate::auth::{CallerCapability, CallerRecord, CallerRegistry, CallerRole};
use std::collections::HashMap;
use std::env;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AdapterTrustProfile {
    InMemory,
    Evm,
}

impl AdapterTrustProfile {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InMemory => "in-memory",
            Self::Evm => "evm",
        }
    }

    fn from_env() -> Result<Self, String> {
        match env::var("ADAPTER_TRUST_PROFILE")
            .unwrap_or_else(|_| String::from("in-memory"))
            .to_ascii_lowercase()
            .as_str()
        {
            "in-memory" | "memory" => Ok(Self::InMemory),
            "evm" => Ok(Self::Evm),
            value => Err(format!(
                "Unsupported ADAPTER_TRUST_PROFILE {value}; expected in-memory or evm"
            )),
        }
    }
}

#[derive(Clone)]
pub struct EvmAdapterConfig {
    pub rpc_url: String,
    pub chain_id: u64,
    pub did_registry_address: String,
    pub enterprise_trust_registry_address: String,
    pub issuer_registry_address: String,
    pub governance_private_key: String,
    pub identity_private_keys: HashMap<CallerRole, String>,
    pub did_resolver_script: String,
    pub did_publisher_script: String,
}

impl EvmAdapterConfig {
    pub fn private_key_for(&self, role: CallerRole) -> Result<&str, String> {
        self.identity_private_keys
            .get(&role)
            .map(String::as_str)
            .ok_or_else(|| format!("Missing EVM identity private key for {role:?}"))
    }

    fn from_env() -> Result<Self, String> {
        let chain_id = required("CHAIN_ID")?
            .parse::<u64>()
            .map_err(|err| format!("Invalid CHAIN_ID [{err}]"))?;

        let mut identity_private_keys = HashMap::new();
        for (role, name) in [
            (CallerRole::Engineer, "ADAPTER_EVM_PRIVATE_KEY_ENGINEER"),
            (
                CallerRole::Orchestrator,
                "ADAPTER_EVM_PRIVATE_KEY_ORCHESTRATOR",
            ),
            (CallerRole::Backend, "ADAPTER_EVM_PRIVATE_KEY_BACKEND"),
            (CallerRole::Frontend, "ADAPTER_EVM_PRIVATE_KEY_FRONTEND"),
            (CallerRole::Test, "ADAPTER_EVM_PRIVATE_KEY_TEST"),
        ] {
            identity_private_keys.insert(role, required(name)?);
        }

        Ok(Self {
            rpc_url: required("RPC_URL")?,
            chain_id,
            did_registry_address: required("DID_REGISTRY_ADDRESS")?,
            enterprise_trust_registry_address: required(
                "ENTERPRISE_TRUST_REGISTRY_ADDRESS",
            )?,
            issuer_registry_address: required("ISSUER_REGISTRY_ADDRESS")?,
            governance_private_key: required("GOVERNANCE_PRIVATE_KEY")?,
            identity_private_keys,
            did_resolver_script: env::var("ADAPTER_DID_RESOLVER_SCRIPT").unwrap_or_else(|_| {
                String::from("blockchain/did-client/resolve-did-json.mjs")
            }),
            did_publisher_script: env::var("ADAPTER_DID_PUBLISHER_SCRIPT").unwrap_or_else(|_| {
                String::from("blockchain/did-client/publish-ed25519.mjs")
            }),
        })
    }
}

#[derive(Clone)]
pub struct AdapterConfig {
    pub bind_addr: String,
    pub callers: CallerRegistry,
    pub trust_profile: AdapterTrustProfile,
    pub evm: Option<EvmAdapterConfig>,
}

impl AdapterConfig {
    pub fn from_env() -> Result<Self, String> {
        let bind_addr =
            env::var("ADAPTER_BIND_ADDR").unwrap_or_else(|_| String::from("0.0.0.0:8090"));

        let engineer_id =
            env::var("ADAPTER_ID_ENGINEER").unwrap_or_else(|_| String::from("did:thesis:engineer"));
        let orchestrator_id = env::var("ADAPTER_ID_ORCHESTRATOR")
            .unwrap_or_else(|_| String::from("did:thesis:orchestrator"));
        let backend_id = env::var("ADAPTER_ID_BACKEND")
            .unwrap_or_else(|_| String::from("did:thesis:backend-agent"));
        let frontend_id = env::var("ADAPTER_ID_FRONTEND")
            .unwrap_or_else(|_| String::from("did:thesis:frontend-agent"));
        let test_id =
            env::var("ADAPTER_ID_TEST").unwrap_or_else(|_| String::from("did:thesis:test-agent"));
        let gateway_id = env::var("ADAPTER_ID_GATEWAY")
            .unwrap_or_else(|_| String::from("urn:thesis:service:gateway"));

        let records = vec![
            CallerRecord::new(
                CallerRole::Engineer,
                required("ADAPTER_CALLER_ENGINEER")?,
                engineer_id,
                vec![CallerCapability::IssueRoot],
            )?,
            CallerRecord::new(
                CallerRole::Orchestrator,
                required("ADAPTER_CALLER_ORCHESTRATOR")?,
                orchestrator_id,
                vec![
                    CallerCapability::IssueChild,
                    CallerCapability::CreatePresentation,
                ],
            )?,
            CallerRecord::new(
                CallerRole::Backend,
                required("ADAPTER_CALLER_BACKEND")?,
                backend_id,
                vec![CallerCapability::CreatePresentation],
            )?,
            CallerRecord::new(
                CallerRole::Frontend,
                required("ADAPTER_CALLER_FRONTEND")?,
                frontend_id,
                vec![CallerCapability::CreatePresentation],
            )?,
            CallerRecord::new(
                CallerRole::Test,
                required("ADAPTER_CALLER_TEST")?,
                test_id,
                vec![CallerCapability::CreatePresentation],
            )?,
            CallerRecord::new(
                CallerRole::Gateway,
                required("ADAPTER_CALLER_GATEWAY")?,
                gateway_id,
                vec![CallerCapability::VerifyPresentation],
            )?,
        ];

        let trust_profile = AdapterTrustProfile::from_env()?;
        let evm = match trust_profile {
            AdapterTrustProfile::InMemory => None,
            AdapterTrustProfile::Evm => Some(EvmAdapterConfig::from_env()?),
        };

        Ok(Self {
            bind_addr,
            callers: CallerRegistry::new(records)?,
            trust_profile,
            evm,
        })
    }
}

fn required(name: &str) -> Result<String, String> {
    let value =
        env::var(name).map_err(|_| format!("Missing required environment variable {name}"))?;
    if value.trim().is_empty() {
        return Err(format!("Environment variable {name} cannot be empty"));
    }
    Ok(value)
}
