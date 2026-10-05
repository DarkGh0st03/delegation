use serde::Serialize;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CallerRole {
    Engineer,
    Orchestrator,
    Backend,
    Frontend,
    Test,
    Gateway,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CallerCapability {
    IssueRoot,
    IssueChild,
    CreatePresentation,
    VerifyPresentation,
}

#[derive(Clone, Debug)]
pub struct CallerRecord {
    role: CallerRole,
    token: String,
    identity_id: String,
    capabilities: Vec<CallerCapability>,
}

impl CallerRecord {
    pub fn new(
        role: CallerRole,
        token: String,
        identity_id: String,
        capabilities: Vec<CallerCapability>,
    ) -> Result<Self, String> {
        if token.trim().is_empty() {
            return Err(String::from("Adapter caller token cannot be empty"));
        }
        if identity_id.trim().is_empty() {
            return Err(String::from("Adapter caller identity cannot be empty"));
        }
        if capabilities.is_empty() {
            return Err(String::from("Adapter caller must have at least one capability"));
        }

        Ok(Self {
            role,
            token,
            identity_id,
            capabilities,
        })
    }

    pub fn role(&self) -> CallerRole {
        self.role
    }

    pub fn identity_id(&self) -> &str {
        &self.identity_id
    }

    pub fn capabilities(&self) -> &[CallerCapability] {
        &self.capabilities
    }

    pub fn has_capability(&self, capability: CallerCapability) -> bool {
        self.capabilities.contains(&capability)
    }

    pub fn require_identity(&self, claimed_identity: &str) -> Result<(), String> {
        if claimed_identity == self.identity_id {
            Ok(())
        } else {
            Err(format!(
                "Caller {:?} is bound to {}, not {}",
                self.role, self.identity_id, claimed_identity
            ))
        }
    }
}

#[derive(Clone, Debug)]
pub struct CallerRegistry {
    by_token: HashMap<String, CallerRecord>,
    by_role: HashMap<CallerRole, CallerRecord>,
}

impl CallerRegistry {
    pub fn new(records: Vec<CallerRecord>) -> Result<Self, String> {
        let mut by_token = HashMap::new();
        let mut by_role = HashMap::new();

        for record in records {
            if by_token.contains_key(&record.token) {
                return Err(String::from("Adapter caller tokens must be unique"));
            }
            if by_role.contains_key(&record.role) {
                return Err(format!("Duplicate adapter caller role {:?}", record.role));
            }

            by_token.insert(record.token.clone(), record.clone());
            by_role.insert(record.role, record);
        }

        Ok(Self { by_token, by_role })
    }

    pub fn authenticate(&self, token: &str) -> Result<&CallerRecord, String> {
        self.by_token
            .get(token)
            .ok_or_else(|| String::from("Invalid adapter caller credential"))
    }

    pub fn identity_for_role(&self, role: CallerRole) -> Result<&str, String> {
        self.by_role
            .get(&role)
            .map(|record| record.identity_id())
            .ok_or_else(|| format!("No adapter identity configured for role {role:?}"))
    }
}

pub fn bearer_token(header_value: &str) -> Result<&str, String> {
    let value = header_value.trim();
    let token = value
        .strip_prefix("Bearer ")
        .ok_or_else(|| String::from("Authorization header must use Bearer authentication"))?;

    if token.trim().is_empty() {
        return Err(String::from("Bearer token cannot be empty"));
    }

    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry() -> CallerRegistry {
        CallerRegistry::new(vec![
            CallerRecord::new(
                CallerRole::Orchestrator,
                String::from("orchestrator-secret"),
                String::from("did:thesis:orchestrator"),
                vec![CallerCapability::IssueChild, CallerCapability::CreatePresentation],
            )
            .unwrap(),
            CallerRecord::new(
                CallerRole::Backend,
                String::from("backend-secret"),
                String::from("did:thesis:backend-agent"),
                vec![CallerCapability::CreatePresentation],
            )
            .unwrap(),
        ])
        .unwrap()
    }

    #[test]
    fn maps_token_to_server_side_identity() {
        let registry = registry();
        let caller = registry.authenticate("backend-secret").unwrap();

        assert_eq!(caller.role(), CallerRole::Backend);
        assert_eq!(caller.identity_id(), "did:thesis:backend-agent");
        assert!(caller.has_capability(CallerCapability::CreatePresentation));
        assert!(!caller.has_capability(CallerCapability::IssueChild));
    }

    #[test]
    fn rejects_cross_identity_impersonation() {
        let registry = registry();
        let caller = registry.authenticate("backend-secret").unwrap();

        let error = caller
            .require_identity("did:thesis:orchestrator")
            .expect_err("backend caller must not impersonate orchestrator");

        assert!(error.contains("not did:thesis:orchestrator"));
    }

    #[test]
    fn rejects_unknown_token() {
        assert!(registry().authenticate("wrong-secret").is_err());
    }

    #[test]
    fn rejects_duplicate_tokens() {
        let result = CallerRegistry::new(vec![
            CallerRecord::new(
                CallerRole::Backend,
                String::from("same"),
                String::from("did:thesis:backend"),
                vec![CallerCapability::CreatePresentation],
            )
            .unwrap(),
            CallerRecord::new(
                CallerRole::Frontend,
                String::from("same"),
                String::from("did:thesis:frontend"),
                vec![CallerCapability::CreatePresentation],
            )
            .unwrap(),
        ]);

        assert!(result.is_err());
    }

    #[test]
    fn parses_bearer_header() {
        assert_eq!(bearer_token("Bearer abc").unwrap(), "abc");
        assert!(bearer_token("Basic abc").is_err());
        assert!(bearer_token("Bearer ").is_err());
    }
}
