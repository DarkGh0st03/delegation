use ark_bn254::Bn254;
use delegation::benchmark::delegation_benchmark;
use std::env;
use std::str::FromStr;

fn fetch_usize_env_variable(variable_name: &str) -> Result<usize, String> {
    let variable = fetch_env_variable(variable_name)?;
    match usize::from_str(variable.as_str()) {
        Ok(variable) => Ok(variable),
        Err(err) => Err(format!(
            "The environment variable {variable_name} cannot be parsed to i32 [{err}]"
        )),
    }
}

fn fetch_env_variable(variable_name: &str) -> Result<String, String> {
    match env::var(&variable_name) {
        Ok(variable) => Ok(variable),
        Err(err) => Err(format!(
            "The environment variable {variable_name} is not set [{err}]"
        )),
    }
}

pub fn main() -> Result<(), String> {
    type Curve = Bn254;

    const DELEGATORS: &str = "DELEGATORS";
    const PERMISSIONS: &str = "PERMISSIONS";
    const ITERATIONS: &str = "ITERATIONS";

    let delegators = fetch_usize_env_variable(DELEGATORS).unwrap_or_else(|_| 10);
    let permissions = fetch_usize_env_variable(PERMISSIONS).unwrap_or_else(|_| 10);
    let iterations = fetch_usize_env_variable(ITERATIONS).unwrap_or_else(|_| 100) as u16;

    let retain_amount = permissions / delegators;

    delegation_benchmark::iterate_over_delegators::<Curve>(delegators, permissions, 1, iterations)?;
    // delegation_benchmark::iterate_over_delegators::<Curve>(delegators, permissions, 4, iterations)?;
    // delegation_benchmark::iterate_over_delegators::<Curve>(delegators, permissions, 7, iterations)?;
    delegation_benchmark::iterate_over_delegators::<Curve>(
        delegators,
        permissions,
        10,
        iterations,
    )?;
    delegation_benchmark::iterate_over_permissions::<Curve>(delegators, permissions, iterations)?;
    delegation_benchmark::retain_permissions::<Curve>(
        delegators,
        permissions,
        retain_amount,
        iterations,
    )?;

    Ok(())
}
