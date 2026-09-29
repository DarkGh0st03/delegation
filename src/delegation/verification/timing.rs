use std::str::FromStr;

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
