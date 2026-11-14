use serde::de::Error as SerdeError;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::{HashMap, HashSet};

/// A bounded, inline role label retains Copy semantics for existing native
/// callers without turning a model/HTTP-selected String into authority.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct AdditionalSpecialistName {
    bytes: [u8; 24],
    len: u8,
}
impl AdditionalSpecialistName {
    pub fn parse(name: &str) -> Result<Self, String> {
        let raw = name.as_bytes();
        if raw.is_empty()
            || raw.len() > 24
            || !raw[0].is_ascii_lowercase()
            || raw.iter().any(|byte| {
                !byte.is_ascii_lowercase()
                    && !byte.is_ascii_digit()
                    && *byte != b'_'
                    && *byte != b'-'
            })
        {
            return Err(String::from(
                "Invalid owner-provisioned additional specialist role",
            ));
        }
        let mut bytes = [0; 24];
        bytes[..raw.len()].copy_from_slice(raw);
        Ok(Self {
            bytes,
            len: raw.len() as u8,
        })
    }
    pub fn as_str(&self) -> &str {
        // Only ASCII bytes accepted in parse(), never from raw deserialization.
        std::str::from_utf8(&self.bytes[..self.len as usize])
            .expect("validated ASCII specialist role")
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum CallerRole {
    Engineer,
    Orchestrator,
    Backend,
    Frontend,
    Test,
    /// Documentation specialist (README, docs).
    Docs,
    /// Data specialist (seed data, schemas, migrations).
    Data,
    /// DevOps specialist (Dockerfile, CI, build configuration).
    Devops,
    Gateway,
    Additional(AdditionalSpecialistName),
}

impl CallerRole {
    /// First-class specialists that are provisioned only when configured
    /// (their DID is present): same authority model as Backend/Frontend.
    pub const OPTIONAL_SPECIALISTS: [CallerRole; 3] =
        [CallerRole::Docs, CallerRole::Data, CallerRole::Devops];

    /// Every specialist that may receive a Child credential and present VPs.
    pub fn is_specialist(&self) -> bool {
        matches!(
            self,
            Self::Backend
                | Self::Frontend
                | Self::Test
                | Self::Docs
                | Self::Data
                | Self::Devops
                | Self::Additional(_)
        )
    }
}
impl CallerRole {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Engineer => "engineer",
            Self::Orchestrator => "orchestrator",
            Self::Backend => "backend",
            Self::Frontend => "frontend",
            Self::Test => "test",
            Self::Docs => "docs",
            Self::Data => "data",
            Self::Devops => "devops",
            Self::Gateway => "gateway",
            Self::Additional(name) => name.as_str(),
        }
    }
    pub fn from_name(value: &str) -> Result<Self, String> {
        match value {
            "engineer" => Ok(Self::Engineer),
            "orchestrator" => Ok(Self::Orchestrator),
            "backend" => Ok(Self::Backend),
            "frontend" => Ok(Self::Frontend),
            "test" => Ok(Self::Test),
            "docs" => Ok(Self::Docs),
            "data" => Ok(Self::Data),
            "devops" => Ok(Self::Devops),
            "gateway" => Ok(Self::Gateway),
            other => AdditionalSpecialistName::parse(other).map(Self::Additional),
        }
    }
}
impl Serialize for CallerRole {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}
impl<'de> Deserialize<'de> for CallerRole {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let name = String::deserialize(deserializer)?;
        CallerRole::from_name(&name).map_err(D::Error::custom)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CallerCapability {
    IssueRoot,
    IssueChild,
    ManageStatus,
    CreatePresentation,
    VerifyPresentation,
}

#[derive(Clone)]
pub struct CallerRecord {
    role: CallerRole,
    token: String,
    identity_id: String,
    capabilities: Vec<CallerCapability>,
    /// Public identity only (DID): no token, no capability, no signing key
    /// in this runtime. Used by a per-role wallet to know the other roles.
    public_only: bool,
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
            return Err(String::from(
                "Adapter caller must have at least one capability",
            ));
        }
        // Additional specialist registration cannot create a new issuer,
        // credential status manager or verifier, even inside native Rust.
        if matches!(role, CallerRole::Additional(_))
            && (capabilities.as_slice() != [CallerCapability::CreatePresentation]
                || !identity_id.starts_with("did:"))
        {
            return Err(String::from(
                "Additional specialist must have one independent presenter identity",
            ));
        }

        Ok(Self {
            role,
            token,
            identity_id,
            capabilities,
            public_only: false,
        })
    }

    /// A role known to this runtime only by its public DID. It cannot be
    /// authenticated (no token) and this runtime holds no key for it.
    pub fn public_identity(role: CallerRole, identity_id: String) -> Result<Self, String> {
        if identity_id.trim().is_empty() || !identity_id.starts_with("did:") {
            return Err(String::from("Public identity must be a DID"));
        }
        if role == CallerRole::Gateway {
            return Err(String::from("The Gateway is not a delegated identity"));
        }
        Ok(Self {
            role,
            token: String::new(),
            identity_id,
            capabilities: Vec::new(),
            public_only: true,
        })
    }

    pub fn is_public_only(&self) -> bool {
        self.public_only
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

#[derive(Clone)]
pub struct CallerRegistry {
    by_token: HashMap<String, CallerRecord>,
    by_role: HashMap<CallerRole, CallerRecord>,
}

impl CallerRegistry {
    pub fn new(records: Vec<CallerRecord>) -> Result<Self, String> {
        let mut by_token = HashMap::new();
        let mut by_role = HashMap::new();
        let mut identities = HashSet::new();

        for record in records {
            if !record.public_only && by_token.contains_key(&record.token) {
                return Err(String::from("Adapter caller tokens must be unique"));
            }
            if by_role.contains_key(&record.role) {
                return Err(format!("Duplicate adapter caller role {:?}", record.role));
            }
            if !identities.insert(record.identity_id.clone()) {
                return Err(String::from("Adapter caller identities must be distinct"));
            }

            if !record.public_only {
                by_token.insert(record.token.clone(), record.clone());
            }
            by_role.insert(record.role, record);
        }

        Ok(Self { by_token, by_role })
    }

    /// Canonical deterministic issuer/public-key roster. The Gateway is a
    /// verifier, never a VP signer or a delegated identity.
    pub fn managed_identity_roles(&self) -> Result<Vec<CallerRole>, String> {
        let mut roles = vec![
            CallerRole::Engineer,
            CallerRole::Orchestrator,
            CallerRole::Backend,
            CallerRole::Frontend,
            CallerRole::Test,
        ];
        for role in &roles {
            self.record_for_role(*role)?;
        }
        for role in CallerRole::OPTIONAL_SPECIALISTS {
            if self.by_role.contains_key(&role) {
                roles.push(role);
            }
        }
        let mut additional: Vec<CallerRole> = self
            .by_role
            .keys()
            .filter(|role| matches!(role, CallerRole::Additional(_)))
            .copied()
            .collect();
        additional.sort_by(|a, b| a.as_str().cmp(b.as_str()));
        if additional.len() > 13 {
            return Err(String::from(
                "Additional specialist identity roster too large",
            ));
        }
        roles.extend(additional);
        Ok(roles)
    }

    /// Roles whose signing identity THIS runtime holds: every managed role
    /// that is not public-only. A per-role wallet holds exactly one.
    pub fn signing_identity_roles(&self) -> Result<Vec<CallerRole>, String> {
        Ok(self
            .managed_identity_roles()?
            .into_iter()
            .filter(|role| {
                self.by_role
                    .get(role)
                    .map(|record| !record.public_only)
                    .unwrap_or(false)
            })
            .collect())
    }

    pub fn authenticate(&self, token: &str) -> Result<&CallerRecord, String> {
        self.by_token
            .get(token)
            .ok_or_else(|| String::from("Invalid adapter caller credential"))
    }

    pub fn record_for_role(&self, role: CallerRole) -> Result<&CallerRecord, String> {
        self.by_role
            .get(&role)
            .ok_or_else(|| format!("No adapter caller configured for role {role:?}"))
    }

    pub fn identity_for_role(&self, role: CallerRole) -> Result<&str, String> {
        Ok(self.record_for_role(role)?.identity_id())
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
                vec![
                    CallerCapability::IssueChild,
                    CallerCapability::CreatePresentation,
                ],
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

#[cfg(test)]
mod additional_role_tests {
    use super::*;
    #[test]
    fn additional_role_roundtrip_is_bounded_and_does_not_impersonate_core_role() {
        for name in [
            "reviewer",
            "release_audit",
            "r2",
            "a-b",
            "x".repeat(24).as_str(),
        ] {
            let parsed = CallerRole::from_name(name).unwrap();
            assert_eq!(parsed.as_str(), name);
            let json = serde_json::to_string(&parsed).unwrap();
            let restored: CallerRole = serde_json::from_str(&json).unwrap();
            assert_eq!(restored, parsed);
            assert!(matches!(restored, CallerRole::Additional(_)));
        }
        for value in [
            "",
            "Reviewer",
            "orchestrator.hidden",
            "../test",
            "__proto__",
            "x/y",
            "a.b",
            "x x",
            "x".repeat(25).as_str(),
        ] {
            assert!(CallerRole::from_name(value).is_err());
        }
        assert_eq!(CallerRole::from_name("test").unwrap(), CallerRole::Test);
    }
    #[test]
    fn additional_role_requires_separate_authentication_and_has_no_issuer_power() {
        let role = CallerRole::from_name("reviewer").unwrap();
        let registry = CallerRegistry::new(vec![
            CallerRecord::new(
                role,
                String::from("reviewer-token"),
                String::from("did:thesis:reviewer"),
                vec![CallerCapability::CreatePresentation],
            )
            .unwrap(),
            CallerRecord::new(
                CallerRole::Gateway,
                String::from("gateway-token"),
                String::from("did:thesis:gateway"),
                vec![CallerCapability::VerifyPresentation],
            )
            .unwrap(),
        ])
        .unwrap();
        assert_eq!(
            registry.authenticate("reviewer-token").unwrap().role(),
            role
        );
        assert!(
            !registry
                .authenticate("reviewer-token")
                .unwrap()
                .has_capability(CallerCapability::IssueChild)
        );
        assert!(registry.authenticate("wrong").is_err());
        assert!(
            CallerRegistry::new(vec![
                CallerRecord::new(
                    role,
                    String::from("same"),
                    String::from("did:thesis:a"),
                    vec![CallerCapability::CreatePresentation]
                )
                .unwrap(),
                CallerRecord::new(
                    CallerRole::Backend,
                    String::from("same"),
                    String::from("did:thesis:b"),
                    vec![CallerCapability::CreatePresentation]
                )
                .unwrap()
            ])
            .is_err()
        );
    }
}

#[cfg(test)]
mod additional_role_authority_isolation_tests {
    use super::*;

    #[test]
    fn additional_role_is_never_a_native_issuer_or_verifier() {
        let role = CallerRole::from_name("reviewer").unwrap();
        for capability in [
            CallerCapability::IssueRoot,
            CallerCapability::IssueChild,
            CallerCapability::ManageStatus,
            CallerCapability::VerifyPresentation,
        ] {
            let attempt = CallerRecord::new(
                role,
                String::from("reviewer-token"),
                String::from("did:thesis:reviewer"),
                vec![CallerCapability::CreatePresentation, capability],
            );
            assert!(attempt.is_err());
        }
        assert!(
            CallerRecord::new(
                role,
                String::from("reviewer-token"),
                String::from("did:thesis:reviewer"),
                vec![CallerCapability::IssueChild],
            )
            .is_err()
        );
        assert!(
            CallerRecord::new(
                role,
                String::from("reviewer-token"),
                String::from("urn:thesis:service:gateway"),
                vec![CallerCapability::CreatePresentation],
            )
            .is_err()
        );
    }

    #[test]
    fn additional_role_cannot_share_backend_did_even_with_distinct_bearer() {
        let role = CallerRole::from_name("reviewer").unwrap();
        let denied = CallerRegistry::new(vec![
            CallerRecord::new(
                CallerRole::Backend,
                String::from("backend-token"),
                String::from("did:thesis:backend-agent"),
                vec![CallerCapability::CreatePresentation],
            )
            .unwrap(),
            CallerRecord::new(
                role,
                String::from("reviewer-token"),
                String::from("did:thesis:backend-agent"),
                vec![CallerCapability::CreatePresentation],
            )
            .unwrap(),
        ]);
        assert!(denied.is_err());
        let independent = CallerRegistry::new(vec![
            CallerRecord::new(
                CallerRole::Backend,
                String::from("backend-token"),
                String::from("did:thesis:backend-agent"),
                vec![CallerCapability::CreatePresentation],
            )
            .unwrap(),
            CallerRecord::new(
                role,
                String::from("reviewer-token"),
                String::from("did:thesis:reviewer-agent"),
                vec![CallerCapability::CreatePresentation],
            )
            .unwrap(),
        ]);
        assert!(independent.is_ok());
    }
}

#[cfg(test)]
mod optional_specialist_tests {
    use super::*;

    #[test]
    fn documentation_data_devops_are_first_class_specialists() {
        for (name, role) in [
            ("docs", CallerRole::Docs),
            ("data", CallerRole::Data),
            ("devops", CallerRole::Devops),
        ] {
            assert_eq!(CallerRole::from_name(name).unwrap(), role);
            assert_eq!(role.as_str(), name);
            assert!(role.is_specialist());
            assert!(!matches!(role, CallerRole::Additional(_)));
        }
        assert!(!CallerRole::Orchestrator.is_specialist());
        assert!(!CallerRole::Engineer.is_specialist());
        assert!(!CallerRole::Gateway.is_specialist());
    }

    #[test]
    fn optional_specialists_join_the_roster_only_when_provisioned() {
        let base = |extra: Vec<CallerRecord>| {
            let mut records = vec![
                CallerRecord::new(CallerRole::Engineer, "t-e".into(), "did:e".into(),
                    vec![CallerCapability::IssueRoot]).unwrap(),
                CallerRecord::new(CallerRole::Orchestrator, "t-o".into(), "did:o".into(),
                    vec![CallerCapability::IssueChild]).unwrap(),
                CallerRecord::new(CallerRole::Backend, "t-b".into(), "did:b".into(),
                    vec![CallerCapability::CreatePresentation]).unwrap(),
                CallerRecord::new(CallerRole::Frontend, "t-f".into(), "did:f".into(),
                    vec![CallerCapability::CreatePresentation]).unwrap(),
                CallerRecord::new(CallerRole::Test, "t-t".into(), "did:t".into(),
                    vec![CallerCapability::CreatePresentation]).unwrap(),
            ];
            records.extend(extra);
            CallerRegistry::new(records).unwrap()
        };
        assert_eq!(base(vec![]).managed_identity_roles().unwrap().len(), 5);
        let with_docs = base(vec![CallerRecord::new(CallerRole::Docs, "t-d".into(), "did:d".into(),
            vec![CallerCapability::CreatePresentation]).unwrap()]);
        assert!(with_docs.managed_identity_roles().unwrap().contains(&CallerRole::Docs));
    }
}
