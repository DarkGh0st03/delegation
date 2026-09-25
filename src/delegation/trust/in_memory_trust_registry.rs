use crate::delegation::trust::accumulator_public_data::AccumulatorPublicData;
use crate::delegation::trust::identity_status::IdentityStatus;
use crate::delegation::trust::trust_registry::TrustRegistry;
use ark_ec::pairing::Pairing;
use josekit::jwk::Jwk;
use std::cell::RefCell;
use std::collections::HashMap;

struct IdentityTrustRecord<E: Pairing> {
    status: IdentityStatus,
    trust_anchor: bool,
    accumulator_data: Option<AccumulatorPublicData<E>>,
    verification_key: Option<Jwk>,
}

impl<E: Pairing> IdentityTrustRecord<E> {
    fn new() -> Self {
        Self {
            status: IdentityStatus::Active,
            trust_anchor: false,
            accumulator_data: None,
            verification_key: None,
        }
    }
}

/// In-memory TrustRegistry used by local tests and the PoC before the EVM adapter.
pub struct InMemoryTrustRegistry<E: Pairing> {
    identities: RefCell<HashMap<String, IdentityTrustRecord<E>>>,
}

impl<E: Pairing> InMemoryTrustRegistry<E> {
    pub fn new() -> Self {
        Self {
            identities: RefCell::new(HashMap::new()),
        }
    }

    fn ensure_record_active(
        identity_id: &str,
        record: &IdentityTrustRecord<E>,
    ) -> Result<(), String> {
        match record.status {
            IdentityStatus::Active => Ok(()),
            status => Err(format!("Identity {identity_id} is {status}")),
        }
    }
}

impl<E: Pairing> Default for InMemoryTrustRegistry<E> {
    fn default() -> Self {
        Self::new()
    }
}

impl<E: Pairing> TrustRegistry<E> for InMemoryTrustRegistry<E> {
    fn register_identity(&self, identity_id: String) -> Result<(), String> {
        if identity_id.trim().is_empty() {
            return Err(String::from("Identity id cannot be empty"));
        }

        self.identities
            .borrow_mut()
            .entry(identity_id)
            .or_insert_with(IdentityTrustRecord::new);
        Ok(())
    }

    fn get_identity_status(&self, identity_id: &str) -> Result<IdentityStatus, String> {
        self.identities
            .borrow()
            .get(identity_id)
            .map(|record| record.status)
            .ok_or_else(|| format!("Identity {identity_id} is not registered"))
    }

    fn set_identity_status(&self, identity_id: &str, status: IdentityStatus) -> Result<(), String> {
        let mut identities = self.identities.borrow_mut();
        let record = identities
            .get_mut(identity_id)
            .ok_or_else(|| format!("Identity {identity_id} is not registered"))?;

        if record.status == IdentityStatus::Revoked && status != IdentityStatus::Revoked {
            return Err(format!(
                "Identity {identity_id} is revoked and cannot transition to {status}"
            ));
        }

        record.status = status;
        Ok(())
    }

    fn set_trust_anchor(&self, identity_id: &str, trusted: bool) -> Result<(), String> {
        let mut identities = self.identities.borrow_mut();
        let record = identities
            .get_mut(identity_id)
            .ok_or_else(|| format!("Identity {identity_id} is not registered"))?;

        if trusted {
            Self::ensure_record_active(identity_id, record)?;
        }

        record.trust_anchor = trusted;
        Ok(())
    }

    fn is_trust_anchor(&self, identity_id: &str) -> Result<bool, String> {
        self.identities
            .borrow()
            .get(identity_id)
            .map(|record| record.trust_anchor)
            .ok_or_else(|| format!("Identity {identity_id} is not registered"))
    }

    fn publish_accumulator_data(
        &self,
        identity_id: String,
        data: AccumulatorPublicData<E>,
    ) -> Result<(), String> {
        let mut identities = self.identities.borrow_mut();
        let record = identities
            .get_mut(&identity_id)
            .ok_or_else(|| format!("Identity {identity_id} is not registered"))?;
        Self::ensure_record_active(&identity_id, record)?;
        record.accumulator_data = Some(data);
        Ok(())
    }

    fn get_accumulator_data(&self, identity_id: &str) -> Result<AccumulatorPublicData<E>, String> {
        let identities = self.identities.borrow();
        let record = identities
            .get(identity_id)
            .ok_or_else(|| format!("Identity {identity_id} is not registered"))?;
        Self::ensure_record_active(identity_id, record)?;

        record.accumulator_data.clone().ok_or_else(|| {
            format!("No accumulator public data registered for identity {identity_id}")
        })
    }

    fn publish_verification_key(
        &self,
        identity_id: String,
        verification_key: Jwk,
    ) -> Result<(), String> {
        let mut identities = self.identities.borrow_mut();
        let record = identities
            .get_mut(&identity_id)
            .ok_or_else(|| format!("Identity {identity_id} is not registered"))?;
        Self::ensure_record_active(&identity_id, record)?;
        record.verification_key = Some(verification_key);
        Ok(())
    }

    fn get_verification_key(&self, identity_id: &str) -> Result<Jwk, String> {
        let identities = self.identities.borrow();
        let record = identities
            .get(identity_id)
            .ok_or_else(|| format!("Identity {identity_id} is not registered"))?;
        Self::ensure_record_active(identity_id, record)?;

        record
            .verification_key
            .clone()
            .ok_or_else(|| format!("No verification key registered for identity {identity_id}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ark_bn254::Bn254;
    use ark_std::rand::SeedableRng;
    use ark_std::rand::prelude::StdRng;
    use vb_accumulator::prelude::{Keypair, SetupParams};

    fn verification_key() -> Result<Jwk, String> {
        let mut jwk = Jwk::new("OKP");
        jwk.set_parameter(
            "crv",
            Some(serde_json::Value::String(String::from("Ed25519"))),
        )
        .map_err(|err| err.to_string())?;
        Ok(jwk)
    }

    #[test]
    fn stores_and_resolves_public_trust_material() -> Result<(), String> {
        type Curve = Bn254;
        let registry = InMemoryTrustRegistry::<Curve>::new();
        let identity = String::from("did:example:issuer");
        registry.register_identity(identity.clone())?;

        let mut rng = StdRng::from_entropy();
        let params = SetupParams::<Curve>::generate_using_rng(&mut rng);
        let keypair = Keypair::<Curve>::generate_using_rng(&mut rng, &params);
        registry.publish_accumulator_data(
            identity.clone(),
            AccumulatorPublicData::new(keypair.public_key.clone(), params),
        )?;
        registry.publish_verification_key(identity.clone(), verification_key()?)?;

        registry.get_accumulator_data(&identity)?;
        registry.get_verification_key(&identity)?;
        Ok(())
    }

    #[test]
    fn registered_identity_is_active_but_not_automatically_trusted() -> Result<(), String> {
        let registry = InMemoryTrustRegistry::<Bn254>::new();
        let identity = String::from("did:example:registered");
        registry.register_identity(identity.clone())?;

        assert_eq!(
            registry.get_identity_status(&identity)?,
            IdentityStatus::Active
        );
        assert!(!registry.is_trust_anchor(&identity)?);

        registry.set_trust_anchor(&identity, true)?;
        assert!(registry.is_trust_anchor(&identity)?);
        Ok(())
    }

    #[test]
    fn suspension_blocks_material_and_can_be_reactivated() -> Result<(), String> {
        let registry = InMemoryTrustRegistry::<Bn254>::new();
        let identity = String::from("did:example:suspended");
        registry.register_identity(identity.clone())?;
        registry.publish_verification_key(identity.clone(), verification_key()?)?;

        registry.set_identity_status(&identity, IdentityStatus::Suspended)?;
        assert!(registry.get_verification_key(&identity).is_err());

        registry.set_identity_status(&identity, IdentityStatus::Active)?;
        registry.get_verification_key(&identity)?;
        Ok(())
    }

    #[test]
    fn revocation_is_terminal() -> Result<(), String> {
        let registry = InMemoryTrustRegistry::<Bn254>::new();
        let identity = String::from("did:example:revoked");
        registry.register_identity(identity.clone())?;

        registry.set_identity_status(&identity, IdentityStatus::Revoked)?;
        assert_eq!(
            registry.get_identity_status(&identity)?,
            IdentityStatus::Revoked
        );
        assert!(
            registry
                .set_identity_status(&identity, IdentityStatus::Active)
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn unknown_identity_fails_closed() {
        let registry = InMemoryTrustRegistry::<Bn254>::new();

        assert!(registry.get_identity_status("did:example:missing").is_err());
        assert!(
            registry
                .get_accumulator_data("did:example:missing")
                .is_err()
        );
        assert!(
            registry
                .get_verification_key("did:example:missing")
                .is_err()
        );
        assert!(registry.is_trust_anchor("did:example:missing").is_err());
    }
}
