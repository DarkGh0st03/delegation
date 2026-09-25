use crate::delegation::credentials::verifiable_credential::VerifiableCredential;
use crate::delegation::credentials::verifiable_presentation::VerifiablePresentation;
use crate::delegation::status::bitstring_status_list_entry::BitstringStatusListEntry;
use crate::delegation::traits::credential::Credential;
use crate::delegation::trust::trust_registry::TrustRegistryRef;
use ark_ec::pairing::Pairing;
use josekit::jwk::Jwk;
use std::time::Duration;

pub trait Issuer<E: Pairing, C: Credential> {
    fn new(id: String, trust_registry: TrustRegistryRef<E>) -> Result<Self, String>
    where
        Self: Sized;

    fn issue_delegation_verifiable_credential(
        &self,
        context: Vec<String>,
        credential_id: String,
        credential_status: BitstringStatusListEntry,
        valid_from: String,
        delegatee_id: String,
        validity_period: Duration,
        permissions: Vec<C::Claim>,
        optional_issuer_vc: Option<VerifiableCredential<C>>,
    ) -> Result<VerifiableCredential<C>, String>;

    fn holder_id(&self) -> &String;

    fn holder_jwk(&self) -> &Jwk;

    fn issue_delegation_verifiable_presentation(
        &self,
        vc: VerifiableCredential<C>,
        disclosed_permissions: Vec<C::Claim>,
        audience: String,
        challenge: String,
    ) -> Result<String, String> {
        let vp: VerifiablePresentation<C> = VerifiablePresentation::from_verifiable_credential(
            vc,
            disclosed_permissions,
            self.holder_id().clone(),
            audience,
            challenge,
        )?;

        vp.to_signed_jwt(self.holder_jwk())
    }
}
