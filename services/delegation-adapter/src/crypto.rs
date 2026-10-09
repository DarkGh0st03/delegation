use crate::auth::{CallerCapability, CallerRecord, CallerRegistry, CallerRole};
use crate::config::{AdapterConfig, AdapterTrustProfile, EvmAdapterConfig};
use crate::evm_profile::EvmAdapterProfile;
use ark_bn254::Bn254;
use delegation::delegation::authorization::authorization_context::AuthorizationContext;
use delegation::delegation::authorization::permission::Permission;
use delegation::delegation::authorization::verified_delegation::VerifiedDelegation;
use delegation::delegation::credentials::delegation::delegation_credential::DelegationCredential;
use delegation::delegation::credentials::generic::verifiable_credential::VerifiableCredential;
use delegation::delegation::issuance::delegation_issuer::DelegationIssuer;
use delegation::delegation::issuance::issuer_trait::Issuer;
use delegation::delegation::status::model::bitstring_status_list_entry::BitstringStatusListEntry;
use delegation::delegation::status::resolver::status_list_resolver_trait::{
    StatusListResolver, StatusListResolverRef,
};
use delegation::delegation::trust::registry::in_memory_trust_registry::InMemoryTrustRegistry;
use delegation::delegation::trust::registry::trust_publisher_trait::{
    TrustPublisher, TrustPublisherRef,
};
use delegation::delegation::trust::resolver::trust_resolver_trait::TrustResolverRef;
use delegation::delegation::verification::delegation_verifier::DelegationVerifier;
use delegation::delegation::verification::verifier_trait::Verifier;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::time::Duration;

type Curve = Bn254;

const VC_CONTEXT: &str = "https://www.w3.org/ns/credentials/v2";

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IssueRootRequest {
    pub credential_id: String,
    pub delegatee: CallerRole,
    pub valid_from: String,
    pub validity_seconds: u64,
    pub credential_status: BitstringStatusListEntry,
    pub permissions: Vec<Permission>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IssueChildRequest {
    pub parent_credential_id: String,
    pub credential_id: String,
    pub delegatee: CallerRole,
    pub valid_from: String,
    pub validity_seconds: u64,
    pub credential_status: BitstringStatusListEntry,
    pub permissions: Vec<Permission>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreatePresentationRequest {
    pub credential_id: String,
    pub disclosed_permissions: Vec<Permission>,
    pub audience: String,
    pub challenge: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerifyPresentationRequest {
    pub presenter: CallerRole,
    pub audience: String,
    pub challenge: String,
    pub required_permission: Permission,
    pub signed_vp: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct SignedPresentationResponse {
    pub signed_vp: String,
}

#[derive(Clone, Default)]
struct AdapterStatusResolver {
    values: Rc<RefCell<HashMap<String, bool>>>,
}

impl AdapterStatusResolver {
    fn key(entry: &BitstringStatusListEntry) -> String {
        format!(
            "{}|{}|{}",
            entry.status_list_credential(),
            entry.status_purpose(),
            entry.status_list_index()
        )
    }

    fn register_active(&self, entry: &BitstringStatusListEntry) {
        self.values.borrow_mut().insert(Self::key(entry), false);
    }
}

impl StatusListResolver for AdapterStatusResolver {
    fn is_status_set(&self, entry: &BitstringStatusListEntry) -> Result<bool, String> {
        self.values
            .borrow()
            .get(&Self::key(entry))
            .copied()
            .ok_or_else(|| {
                format!(
                    "Status entry {}:{} ({}) is not registered in the Adapter runtime",
                    entry.status_list_credential(),
                    entry.status_list_index(),
                    entry.status_purpose()
                )
            })
    }
}

pub struct CryptoRuntime {
    _trust_registry: Rc<InMemoryTrustRegistry<Curve>>,
    status_resolver: Option<Rc<AdapterStatusResolver>>,
    evm_profile: Option<EvmAdapterProfile>,
    issuers: HashMap<CallerRole, DelegationIssuer<Curve>>,
    credentials: HashMap<String, VerifiableCredential<DelegationCredential>>,
    verifier: DelegationVerifier<Curve>,
}

impl CryptoRuntime {
    pub fn new(callers: &CallerRegistry) -> Result<Self, String> {
        Self::new_in_memory(callers)
    }

    pub fn from_config(config: &AdapterConfig) -> Result<Self, String> {
        match config.trust_profile {
            AdapterTrustProfile::InMemory => Self::new_in_memory(&config.callers),
            AdapterTrustProfile::Evm => {
                let evm = config
                    .evm
                    .as_ref()
                    .ok_or_else(|| String::from("EVM Adapter profile is missing configuration"))?;
                Self::new_evm(&config.callers, evm)
            }
        }
    }

    fn initialize_issuers(
        callers: &CallerRegistry,
        trust_ref: TrustPublisherRef<Curve>,
    ) -> Result<HashMap<CallerRole, DelegationIssuer<Curve>>, String> {
        let mut issuers = HashMap::new();
        for role in [
            CallerRole::Engineer,
            CallerRole::Orchestrator,
            CallerRole::Backend,
            CallerRole::Frontend,
            CallerRole::Test,
        ] {
            let identity = callers.identity_for_role(role)?.to_string();
            let issuer = DelegationIssuer::<Curve>::new(identity, trust_ref.clone())?;
            issuers.insert(role, issuer);
        }
        Ok(issuers)
    }

    fn new_in_memory(callers: &CallerRegistry) -> Result<Self, String> {
        let trust_registry = Rc::new(InMemoryTrustRegistry::<Curve>::new());
        let trust_publisher: TrustPublisherRef<Curve> = trust_registry.clone();
        let issuers = Self::initialize_issuers(callers, trust_publisher)?;

        trust_registry.set_trust_anchor(callers.identity_for_role(CallerRole::Engineer)?, true)?;

        let status_resolver = Rc::new(AdapterStatusResolver::default());
        let status_ref: StatusListResolverRef = status_resolver.clone();
        let trust_resolver: TrustResolverRef<Curve> = trust_registry.clone();
        let verifier = DelegationVerifier::<Curve>::new(trust_resolver, status_ref)?;

        Ok(Self {
            _trust_registry: trust_registry,
            status_resolver: Some(status_resolver),
            evm_profile: None,
            issuers,
            credentials: HashMap::new(),
            verifier,
        })
    }

    fn new_evm(callers: &CallerRegistry, config: &EvmAdapterConfig) -> Result<Self, String> {
        let trust_registry = Rc::new(InMemoryTrustRegistry::<Curve>::new());
        let trust_publisher: TrustPublisherRef<Curve> = trust_registry.clone();
        let issuers = Self::initialize_issuers(callers, trust_publisher)?;

        trust_registry.set_trust_anchor(callers.identity_for_role(CallerRole::Engineer)?, true)?;

        let (evm_profile, verifier) =
            EvmAdapterProfile::initialize(config, callers, trust_registry.clone(), &issuers)?;

        Ok(Self {
            _trust_registry: trust_registry,
            status_resolver: None,
            evm_profile: Some(evm_profile),
            issuers,
            credentials: HashMap::new(),
            verifier,
        })
    }

    fn register_active_status(
        &self,
        issuer_role: CallerRole,
        callers: &CallerRegistry,
        entry: &BitstringStatusListEntry,
    ) -> Result<(), String> {
        if let Some(profile) = &self.evm_profile {
            let issuer = self
                .issuers
                .get(&issuer_role)
                .ok_or_else(|| format!("Missing Adapter issuer for {issuer_role:?}"))?;
            return profile.register_active_status(
                issuer_role,
                callers.identity_for_role(issuer_role)?,
                entry,
                issuer.holder_jwk(),
            );
        }

        self.status_resolver
            .as_ref()
            .ok_or_else(|| String::from("Adapter status resolver is not initialized"))?
            .register_active(entry);
        Ok(())
    }

    pub fn issue_root(
        &mut self,
        caller: &CallerRecord,
        callers: &CallerRegistry,
        request: IssueRootRequest,
    ) -> Result<VerifiableCredential<DelegationCredential>, String> {
        require_capability(caller, CallerCapability::IssueRoot)?;
        if caller.role() != CallerRole::Engineer {
            return Err(String::from(
                "Only the Engineer caller may issue the root credential",
            ));
        }
        if request.delegatee != CallerRole::Orchestrator {
            return Err(String::from(
                "The PoC root Delegation Credential must be delegated to the Orchestrator",
            ));
        }
        validate_common_issue_fields(
            &request.credential_id,
            &request.valid_from,
            request.validity_seconds,
        )?;
        self.ensure_credential_id_available(&request.credential_id)?;

        let delegatee_id = callers.identity_for_role(request.delegatee)?.to_string();
        let issuer = self
            .issuers
            .get(&CallerRole::Engineer)
            .ok_or_else(|| String::from("Engineer cryptographic identity is not initialized"))?;

        self.register_active_status(CallerRole::Engineer, callers, &request.credential_status)?;

        let credential = issuer.issue_delegation_verifiable_credential(
            vec![String::from(VC_CONTEXT)],
            request.credential_id.clone(),
            request.credential_status,
            request.valid_from,
            delegatee_id,
            Duration::from_secs(request.validity_seconds),
            request.permissions,
            None,
        )?;

        self.credentials
            .insert(request.credential_id, credential.clone());

        Ok(credential)
    }

    pub fn issue_child(
        &mut self,
        caller: &CallerRecord,
        callers: &CallerRegistry,
        request: IssueChildRequest,
    ) -> Result<VerifiableCredential<DelegationCredential>, String> {
        require_capability(caller, CallerCapability::IssueChild)?;
        if caller.role() != CallerRole::Orchestrator {
            return Err(String::from(
                "Only the Orchestrator caller may issue specialized child credentials",
            ));
        }
        if !matches!(
            request.delegatee,
            CallerRole::Backend | CallerRole::Frontend | CallerRole::Test
        ) {
            return Err(String::from(
                "Child credentials may target only Backend, Frontend, or Test roles",
            ));
        }
        validate_common_issue_fields(
            &request.credential_id,
            &request.valid_from,
            request.validity_seconds,
        )?;
        self.ensure_credential_id_available(&request.credential_id)?;

        let parent = self
            .credentials
            .get(&request.parent_credential_id)
            .cloned()
            .ok_or_else(|| {
                format!(
                    "Parent credential {} is not available",
                    request.parent_credential_id
                )
            })?;

        let delegatee_id = callers.identity_for_role(request.delegatee)?.to_string();
        let issuer = self.issuers.get(&CallerRole::Orchestrator).ok_or_else(|| {
            String::from("Orchestrator cryptographic identity is not initialized")
        })?;

        self.register_active_status(
            CallerRole::Orchestrator,
            callers,
            &request.credential_status,
        )?;

        let credential = issuer.issue_delegation_verifiable_credential(
            vec![String::from(VC_CONTEXT)],
            request.credential_id.clone(),
            request.credential_status,
            request.valid_from,
            delegatee_id,
            Duration::from_secs(request.validity_seconds),
            request.permissions,
            Some(parent),
        )?;

        self.credentials
            .insert(request.credential_id, credential.clone());

        Ok(credential)
    }

    pub fn create_presentation(
        &self,
        caller: &CallerRecord,
        request: CreatePresentationRequest,
    ) -> Result<SignedPresentationResponse, String> {
        require_capability(caller, CallerCapability::CreatePresentation)?;

        let credential = self
            .credentials
            .get(&request.credential_id)
            .cloned()
            .ok_or_else(|| format!("Credential {} is not available", request.credential_id))?;

        let issuer = self
            .issuers
            .get(&caller.role())
            .ok_or_else(|| format!("No signing identity initialized for {:?}", caller.role()))?;

        let signed_vp = issuer.issue_delegation_verifiable_presentation(
            credential,
            request.disclosed_permissions,
            request.audience,
            request.challenge,
        )?;

        Ok(SignedPresentationResponse { signed_vp })
    }

    pub fn verify_presentation(
        &self,
        caller: &CallerRecord,
        callers: &CallerRegistry,
        request: VerifyPresentationRequest,
    ) -> Result<VerifiedDelegation, String> {
        require_capability(caller, CallerCapability::VerifyPresentation)?;
        if caller.role() != CallerRole::Gateway {
            return Err(String::from(
                "Only the Gateway caller may invoke presentation verification",
            ));
        }
        if !matches!(
            request.presenter,
            CallerRole::Orchestrator
                | CallerRole::Backend
                | CallerRole::Frontend
                | CallerRole::Test
        ) {
            return Err(String::from(
                "Presenter must be an Orchestrator or specialized Agent role",
            ));
        }

        let presenter_id = callers.identity_for_role(request.presenter)?.to_string();
        let context = AuthorizationContext::new(
            presenter_id,
            request.audience,
            request.challenge,
            request.required_permission,
        )?;

        self.verifier
            .verify_verifiable_presentation(context, request.signed_vp)
    }

    fn ensure_credential_id_available(&self, credential_id: &str) -> Result<(), String> {
        if self.credentials.contains_key(credential_id) {
            Err(format!("Credential id {credential_id} already exists"))
        } else {
            Ok(())
        }
    }
}

fn require_capability(caller: &CallerRecord, capability: CallerCapability) -> Result<(), String> {
    if caller.has_capability(capability) {
        Ok(())
    } else {
        Err(format!(
            "Caller {:?} does not have capability {:?}",
            caller.role(),
            capability
        ))
    }
}

fn validate_common_issue_fields(
    credential_id: &str,
    valid_from: &str,
    validity_seconds: u64,
) -> Result<(), String> {
    if credential_id.trim().is_empty() {
        return Err(String::from("Credential id cannot be empty"));
    }
    if valid_from.trim().is_empty() {
        return Err(String::from("validFrom cannot be empty"));
    }
    if validity_seconds == 0 {
        return Err(String::from("validity_seconds must be greater than zero"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{CallerCapability, CallerRecord};
    use delegation::delegation::authorization::operation::Operation;
    use delegation::delegation::credentials::delegation::delegation_evidence_trait::DelegationEvidence;

    const STATUS_LIST: &str = "https://status.example/lists/adapter-revocation-1";

    fn callers() -> CallerRegistry {
        CallerRegistry::new(vec![
            CallerRecord::new(
                CallerRole::Engineer,
                String::from("engineer-token"),
                String::from("did:thesis:engineer"),
                vec![CallerCapability::IssueRoot],
            )
            .unwrap(),
            CallerRecord::new(
                CallerRole::Orchestrator,
                String::from("orchestrator-token"),
                String::from("did:thesis:orchestrator"),
                vec![
                    CallerCapability::IssueChild,
                    CallerCapability::CreatePresentation,
                ],
            )
            .unwrap(),
            CallerRecord::new(
                CallerRole::Backend,
                String::from("backend-token"),
                String::from("did:thesis:backend"),
                vec![CallerCapability::CreatePresentation],
            )
            .unwrap(),
            CallerRecord::new(
                CallerRole::Frontend,
                String::from("frontend-token"),
                String::from("did:thesis:frontend"),
                vec![CallerCapability::CreatePresentation],
            )
            .unwrap(),
            CallerRecord::new(
                CallerRole::Test,
                String::from("test-token"),
                String::from("did:thesis:test"),
                vec![CallerCapability::CreatePresentation],
            )
            .unwrap(),
            CallerRecord::new(
                CallerRole::Gateway,
                String::from("gateway-token"),
                String::from("urn:thesis:gateway"),
                vec![CallerCapability::VerifyPresentation],
            )
            .unwrap(),
        ])
        .unwrap()
    }

    fn permission(operation: Operation) -> Permission {
        Permission::new(
            String::from("gitea://gitea.local/thesis/iam-console-poc"),
            operation,
        )
        .unwrap()
    }

    fn status(index: u64) -> BitstringStatusListEntry {
        BitstringStatusListEntry::revocation(None, index.to_string(), String::from(STATUS_LIST))
            .unwrap()
    }

    fn issue_root(
        runtime: &mut CryptoRuntime,
        registry: &CallerRegistry,
    ) -> VerifiableCredential<DelegationCredential> {
        let engineer = registry.record_for_role(CallerRole::Engineer).unwrap();
        runtime
            .issue_root(
                engineer,
                registry,
                IssueRootRequest {
                    credential_id: String::from("urn:credential:root"),
                    delegatee: CallerRole::Orchestrator,
                    valid_from: String::from("2026-10-05T00:00:00Z"),
                    validity_seconds: 3600,
                    credential_status: status(1),
                    permissions: vec![
                        permission(Operation::ReadFile),
                        permission(Operation::UpdateFile),
                    ],
                },
            )
            .unwrap()
    }

    #[test]
    fn root_child_presentation_and_verification_close_the_bridge() {
        let registry = callers();
        let mut runtime = CryptoRuntime::new(&registry).unwrap();
        issue_root(&mut runtime, &registry);

        let orchestrator = registry.record_for_role(CallerRole::Orchestrator).unwrap();
        let child = runtime
            .issue_child(
                orchestrator,
                &registry,
                IssueChildRequest {
                    parent_credential_id: String::from("urn:credential:root"),
                    credential_id: String::from("urn:credential:backend"),
                    delegatee: CallerRole::Backend,
                    valid_from: String::from("2026-10-05T00:00:00Z"),
                    validity_seconds: 1800,
                    credential_status: status(2),
                    permissions: vec![permission(Operation::ReadFile)],
                },
            )
            .unwrap();

        assert_eq!(child.credential().delegatee_id(), "did:thesis:backend");

        let backend = registry.record_for_role(CallerRole::Backend).unwrap();
        let presentation = runtime
            .create_presentation(
                backend,
                CreatePresentationRequest {
                    credential_id: String::from("urn:credential:backend"),
                    disclosed_permissions: vec![permission(Operation::ReadFile)],
                    audience: String::from("cloud-access-gateway"),
                    challenge: String::from("challenge-1"),
                },
            )
            .unwrap();

        let gateway = registry.record_for_role(CallerRole::Gateway).unwrap();
        let verified = runtime
            .verify_presentation(
                gateway,
                &registry,
                VerifyPresentationRequest {
                    presenter: CallerRole::Backend,
                    audience: String::from("cloud-access-gateway"),
                    challenge: String::from("challenge-1"),
                    required_permission: permission(Operation::ReadFile),
                    signed_vp: presentation.signed_vp,
                },
            )
            .unwrap();

        assert_eq!(verified.presenter_id(), "did:thesis:backend");
        assert_eq!(verified.hierarchy_depth(), 1);
        assert_eq!(
            verified.permissions(),
            &vec![permission(Operation::ReadFile)]
        );
    }

    #[test]
    fn child_permission_escalation_is_rejected_by_existing_framework() {
        let registry = callers();
        let mut runtime = CryptoRuntime::new(&registry).unwrap();
        issue_root(&mut runtime, &registry);

        let orchestrator = registry.record_for_role(CallerRole::Orchestrator).unwrap();
        let error = match runtime.issue_child(
            orchestrator,
            &registry,
            IssueChildRequest {
                parent_credential_id: String::from("urn:credential:root"),
                credential_id: String::from("urn:credential:bad-child"),
                delegatee: CallerRole::Backend,
                valid_from: String::from("2026-10-05T00:00:00Z"),
                validity_seconds: 1800,
                credential_status: status(3),
                permissions: vec![permission(Operation::CreatePullRequest)],
            },
        ) {
            Ok(_) => panic!("child escalation must fail"),
            Err(error) => error,
        };

        assert!(error.contains("cannot be granted"));
    }

    #[test]
    fn caller_cannot_sign_a_presentation_for_another_roles_credential() {
        let registry = callers();
        let mut runtime = CryptoRuntime::new(&registry).unwrap();
        issue_root(&mut runtime, &registry);

        let orchestrator = registry.record_for_role(CallerRole::Orchestrator).unwrap();
        runtime
            .issue_child(
                orchestrator,
                &registry,
                IssueChildRequest {
                    parent_credential_id: String::from("urn:credential:root"),
                    credential_id: String::from("urn:credential:backend"),
                    delegatee: CallerRole::Backend,
                    valid_from: String::from("2026-10-05T00:00:00Z"),
                    validity_seconds: 1800,
                    credential_status: status(4),
                    permissions: vec![permission(Operation::ReadFile)],
                },
            )
            .unwrap();

        let frontend = registry.record_for_role(CallerRole::Frontend).unwrap();
        let error = runtime
            .create_presentation(
                frontend,
                CreatePresentationRequest {
                    credential_id: String::from("urn:credential:backend"),
                    disclosed_permissions: vec![permission(Operation::ReadFile)],
                    audience: String::from("cloud-access-gateway"),
                    challenge: String::from("challenge-2"),
                },
            )
            .expect_err("frontend must not sign as backend");

        assert!(error.contains("Cannot present credential delegated to"));
    }

    #[test]
    fn specialized_agent_cannot_issue_child_credentials() {
        let registry = callers();
        let mut runtime = CryptoRuntime::new(&registry).unwrap();
        issue_root(&mut runtime, &registry);

        let backend = registry.record_for_role(CallerRole::Backend).unwrap();
        let error = match runtime.issue_child(
            backend,
            &registry,
            IssueChildRequest {
                parent_credential_id: String::from("urn:credential:root"),
                credential_id: String::from("urn:credential:forbidden"),
                delegatee: CallerRole::Test,
                valid_from: String::from("2026-10-05T00:00:00Z"),
                validity_seconds: 1800,
                credential_status: status(5),
                permissions: vec![permission(Operation::ReadFile)],
            },
        ) {
            Ok(_) => panic!("backend must not issue child credentials"),
            Err(error) => error,
        };

        assert!(error.contains("does not have capability"));
    }
    #[test]
    fn reordered_child_subset_keeps_hierarchy_witnesses_aligned() -> Result<(), String> {
        let registry = callers();
        let mut runtime = CryptoRuntime::new(&registry)?;

        let engineer = registry.record_for_role(CallerRole::Engineer)?;
        runtime.issue_root(
            engineer,
            &registry,
            IssueRootRequest {
                credential_id: String::from("urn:credential:ordered-root"),
                delegatee: CallerRole::Orchestrator,
                valid_from: String::from("2026-10-05T00:00:00Z"),
                validity_seconds: 3600,
                credential_status: status(6),
                permissions: vec![
                    permission(Operation::ReadFile),
                    permission(Operation::UpdateFile),
                    permission(Operation::CreateFile),
                ],
            },
        )?;

        let orchestrator = registry.record_for_role(CallerRole::Orchestrator)?;
        let child = runtime.issue_child(
            orchestrator,
            &registry,
            IssueChildRequest {
                parent_credential_id: String::from("urn:credential:ordered-root"),
                credential_id: String::from("urn:credential:reordered-child"),
                delegatee: CallerRole::Backend,
                valid_from: String::from("2026-10-05T00:00:00Z"),
                validity_seconds: 1800,
                credential_status: status(7),
                permissions: vec![
                    permission(Operation::CreateFile),
                    permission(Operation::ReadFile),
                ],
            },
        )?;

        assert_eq!(
            child.credential().permissions(),
            &vec![
                permission(Operation::CreateFile),
                permission(Operation::ReadFile),
            ]
        );

        let backend = registry.record_for_role(CallerRole::Backend)?;
        let presentation = runtime.create_presentation(
            backend,
            CreatePresentationRequest {
                credential_id: String::from("urn:credential:reordered-child"),
                disclosed_permissions: vec![permission(Operation::CreateFile)],
                audience: String::from("cloud-access-gateway"),
                challenge: String::from("challenge-reordered-subset"),
            },
        )?;

        let gateway = registry.record_for_role(CallerRole::Gateway)?;
        let verified = runtime.verify_presentation(
            gateway,
            &registry,
            VerifyPresentationRequest {
                presenter: CallerRole::Backend,
                audience: String::from("cloud-access-gateway"),
                challenge: String::from("challenge-reordered-subset"),
                required_permission: permission(Operation::CreateFile),
                signed_vp: presentation.signed_vp,
            },
        )?;

        assert_eq!(
            verified.permissions(),
            &vec![permission(Operation::CreateFile)]
        );
        Ok(())
    }
}
