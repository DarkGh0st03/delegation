use crate::delegation::authorization::authorization_request::AuthorizationRequest;
use crate::delegation::authorization::verified_delegation::VerifiedDelegation;
use crate::delegation::trust::trust_registry::TrustRegistryRef;
use crate::delegation::status::status_list_resolver::StatusListResolverRef;
use ark_ec::pairing::Pairing;
use std::str::FromStr;

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

/// Utility function to let verifiers verify timings.
pub fn verify_timings(now: u128, iat: &String, exp: &String) -> Result<(), String> {
    // Parse iat
    let iat_ns = match u128::from_str(iat) {
        Ok(iat) => iat,
        Err(err) => {
            return Err(format!("Could not parse timestamp iat {} [{err}]", iat));
        }
    };

    // Parse exp
    let exp_ns = match u128::from_str(exp) {
        Ok(iat) => iat,
        Err(err) => {
            return Err(format!("Could not parse timestamp exp {} [{err}]", exp));
        }
    };

    if now < iat_ns {
        return Err(format!("Timestamp is less than issuance time {iat_ns}"));
    } else if now > exp_ns {
        return Err(format!(
            "Timestamp is greater than expiration time {exp_ns}"
        ));
    } else if iat_ns > exp_ns {
        return Err(format!(
            "Credential is issued after its expiration date {iat_ns} > {exp_ns}"
        ));
    }

    Ok(())
}
