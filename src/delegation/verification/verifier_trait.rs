use crate::delegation::authorization::authorization_request::AuthorizationRequest;
use crate::delegation::authorization::verified_delegation::VerifiedDelegation;
use crate::delegation::status::resolver::status_list_resolver_trait::StatusListResolverRef;
use crate::delegation::trust::trust_registry::TrustRegistryRef;
use ark_ec::pairing::Pairing;

pub trait Verifier<E: Pairing> {
    fn new(
        trust_registry: TrustRegistryRef<E>,
        status_list_resolver: StatusListResolverRef,
    ) -> Result<Self, String>
    where
        Self: Sized;

    fn verify_verifiable_presentation(
        &self,
        request: AuthorizationRequest,
        signed_jwt: String,
    ) -> Result<VerifiedDelegation, String>;
}
