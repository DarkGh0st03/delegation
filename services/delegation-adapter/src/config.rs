use crate::auth::{CallerCapability, CallerRecord, CallerRegistry, CallerRole};
use std::env;

#[derive(Clone, Debug)]
pub struct AdapterConfig {
    pub bind_addr: String,
    pub callers: CallerRegistry,
}

impl AdapterConfig {
    pub fn from_env() -> Result<Self, String> {
        let bind_addr = env::var("ADAPTER_BIND_ADDR").unwrap_or_else(|_| String::from("0.0.0.0:8090"));

        let engineer_id = env::var("ADAPTER_ID_ENGINEER").unwrap_or_else(|_| String::from("did:thesis:engineer"));
        let orchestrator_id = env::var("ADAPTER_ID_ORCHESTRATOR").unwrap_or_else(|_| String::from("did:thesis:orchestrator"));
        let backend_id = env::var("ADAPTER_ID_BACKEND").unwrap_or_else(|_| String::from("did:thesis:backend-agent"));
        let frontend_id = env::var("ADAPTER_ID_FRONTEND").unwrap_or_else(|_| String::from("did:thesis:frontend-agent"));
        let test_id = env::var("ADAPTER_ID_TEST").unwrap_or_else(|_| String::from("did:thesis:test-agent"));
        let gateway_id = env::var("ADAPTER_ID_GATEWAY").unwrap_or_else(|_| String::from("urn:thesis:service:gateway"));

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
                vec![CallerCapability::IssueChild, CallerCapability::CreatePresentation],
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

        Ok(Self {
            bind_addr,
            callers: CallerRegistry::new(records)?,
        })
    }
}

fn required(name: &str) -> Result<String, String> {
    let value = env::var(name).map_err(|_| format!("Missing required environment variable {name}"))?;
    if value.trim().is_empty() {
        return Err(format!("Environment variable {name} cannot be empty"));
    }
    Ok(value)
}
