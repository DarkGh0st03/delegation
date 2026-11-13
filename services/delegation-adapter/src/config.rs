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
    /// Platform administration key (enterprise admission). Present only in
    /// the Engineer core; a per-role wallet never receives it.
    pub governance_private_key: Option<String>,
    pub identity_private_keys: HashMap<CallerRole, String>,
    pub did_resolver_script: String,
    pub did_publisher_script: String,
    /// Optional shared public-only artifact directory, mounted read-only
    /// into independently deployed verifiers. No signing keys are persisted.
    pub public_artifact_dir: Option<String>,
}

impl EvmAdapterConfig {
    pub fn private_key_for(&self, role: CallerRole) -> Result<&str, String> {
        self.identity_private_keys
            .get(&role)
            .map(String::as_str)
            .ok_or_else(|| format!("Missing EVM identity private key for {role:?}"))
    }

    fn from_env(additional: &[CallerRole], signing_role: Option<CallerRole>) -> Result<Self, String> {
        // EVM account keys: only for the identities this runtime signs for.
        let signs = |role: CallerRole| signing_role.is_none() || signing_role == Some(role);
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
            if signs(role) {
                identity_private_keys.insert(role, required(name)?);
            }
        }
        for role in additional {
            if signs(*role) {
                let key =
                    "ADAPTER_EVM_PRIVATE_KEY_".to_owned() + &role.as_str().to_ascii_uppercase();
                identity_private_keys.insert(*role, required(&key)?);
            }
        }

        Ok(Self {
            rpc_url: required("RPC_URL")?,
            chain_id,
            did_registry_address: required("DID_REGISTRY_ADDRESS")?,
            enterprise_trust_registry_address: required("ENTERPRISE_TRUST_REGISTRY_ADDRESS")?,
            issuer_registry_address: required("ISSUER_REGISTRY_ADDRESS")?,
            // Platform administration: the shared runtime and the Engineer
            // core only. A per-role wallet never receives this key.
            governance_private_key: match signing_role {
                None | Some(CallerRole::Engineer) => Some(required("GOVERNANCE_PRIVATE_KEY")?),
                Some(_) => None,
            },
            identity_private_keys,
            did_resolver_script: env::var("ADAPTER_DID_RESOLVER_SCRIPT")
                .unwrap_or_else(|_| String::from("blockchain/did-client/resolve-did-json.mjs")),
            did_publisher_script: env::var("ADAPTER_DID_PUBLISHER_SCRIPT")
                .unwrap_or_else(|_| String::from("blockchain/did-client/publish-ed25519.mjs")),
            public_artifact_dir: env::var("ADAPTER_PUBLIC_ARTIFACT_DIR")
                .ok()
                .filter(|path| !path.trim().is_empty()),
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
        let additional = additional_specialists_from_env()?;
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

        // Which role this runtime SIGNS for. Unset: the historical shared
        // runtime holding every identity. "engineer": the Engineer core
        // (Roots, revocation, Gateway inspection). Any other role: a per-role
        // wallet holding only that identity. Other roles are then known only
        // by their public DID: no token, no capability, no key.
        let signing_role = match env::var("ADAPTER_SIGNING_ROLE") {
            Ok(name) if !name.trim().is_empty() => {
                let role = CallerRole::from_name(name.trim())?;
                if role == CallerRole::Gateway {
                    return Err(String::from("The Gateway never signs delegations"));
                }
                Some(role)
            }
            _ => None,
        };
        let holds = |role: CallerRole| match signing_role {
            None => true,
            Some(CallerRole::Engineer) => {
                role == CallerRole::Engineer || role == CallerRole::Gateway
            }
            Some(own) => role == own,
        };
        let entry = |role: CallerRole,
                     token_env: &str,
                     identity: String,
                     capabilities: Vec<CallerCapability>|
         -> Result<Option<CallerRecord>, String> {
            if holds(role) {
                CallerRecord::new(role, required(token_env)?, identity, capabilities).map(Some)
            } else if role == CallerRole::Gateway {
                Ok(None)
            } else {
                CallerRecord::public_identity(role, identity).map(Some)
            }
        };

        let mut records = vec![
            entry(
                CallerRole::Engineer,
                "ADAPTER_CALLER_ENGINEER",
                engineer_id,
                vec![CallerCapability::IssueRoot, CallerCapability::ManageStatus],
            )?,
            entry(
                CallerRole::Orchestrator,
                "ADAPTER_CALLER_ORCHESTRATOR",
                orchestrator_id,
                vec![
                    CallerCapability::IssueChild,
                    CallerCapability::ManageStatus,
                    CallerCapability::CreatePresentation,
                ],
            )?,
            entry(
                CallerRole::Backend,
                "ADAPTER_CALLER_BACKEND",
                backend_id,
                vec![CallerCapability::CreatePresentation],
            )?,
            entry(
                CallerRole::Frontend,
                "ADAPTER_CALLER_FRONTEND",
                frontend_id,
                vec![CallerCapability::CreatePresentation],
            )?,
            entry(
                CallerRole::Test,
                "ADAPTER_CALLER_TEST",
                test_id,
                vec![CallerCapability::CreatePresentation],
            )?,
            entry(
                CallerRole::Gateway,
                "ADAPTER_CALLER_GATEWAY",
                gateway_id,
                vec![CallerCapability::VerifyPresentation],
            )?,
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();

        for role in &additional {
            let suffix = role.as_str().to_ascii_uppercase();
            let identity = required(&format!("ADAPTER_ID_{suffix}"))?;
            if !identity.starts_with("did:") {
                return Err(String::from(
                    "Additional specialist needs a provisioned DID",
                ));
            }
            if let Some(record) = entry(
                *role,
                &format!("ADAPTER_CALLER_{suffix}"),
                identity,
                vec![CallerCapability::CreatePresentation],
            )? {
                records.push(record);
            }
        }
        let trust_profile = AdapterTrustProfile::from_env()?;
        let evm = match trust_profile {
            AdapterTrustProfile::InMemory => None,
            AdapterTrustProfile::Evm => Some(EvmAdapterConfig::from_env(&additional, signing_role)?),
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

/** Only the deployment Owner's native Rust environment can provision
 * extra signer identities; Agent Cards, Task hints and A2A never reach here.
 * Unknown/duplicate/oversized rosters fail closed before native startup. */
pub fn additional_specialists_from_env() -> Result<Vec<CallerRole>, String> {
    let raw = env::var("ADAPTER_ADDITIONAL_SPECIALISTS").unwrap_or_default();
    if raw.is_empty() {
        return Ok(Vec::new());
    }
    let names = raw.split(',').collect::<Vec<_>>();
    if names.len() > 13 {
        return Err(String::from("Additional specialist role roster too large"));
    }
    let mut roles = Vec::new();
    for name in names {
        let role = CallerRole::from_name(name)?;
        if !matches!(role, CallerRole::Additional(_)) || roles.contains(&role) {
            return Err(String::from("Invalid native additional specialist roster"));
        }
        roles.push(role);
    }
    roles.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    Ok(roles)
}
