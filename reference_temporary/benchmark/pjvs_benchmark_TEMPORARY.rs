use crate::benchmark::benchmark::Benchmark;
use crate::benchmark::benchmark_result::BenchmarkResult;
use crate::delegation::entities::dtl_sim::{DLTSim, new_dlt_sim};
use crate::delegation::entities::pjv::pjv_issuer_verifier::PJVIssuerVerifier;
use josekit::jwk::Jwk;
use std::time::Duration;

pub struct PJVBenchmark {
    delegator_ids: Vec<String>,
    credential_ids: Vec<String>,
    delegators: Vec<PJVIssuerVerifier>,
    context: Vec<String>,
    valid_from: String,
    validity_period: Duration,
    owner: String,
    resource_uri: String,
}

// TODO: Documentation
impl Benchmark for PJVBenchmark {
    fn new(delegators_size: usize) -> Result<PJVBenchmark, String> {
        let encryption_dlt: DLTSim<Jwk> = new_dlt_sim();
        let verification_dlt: DLTSim<Jwk> = new_dlt_sim();

        let mut delegator_ids: Vec<String> = vec![];
        let mut credential_ids: Vec<String> = vec![];
        let mut delegators: Vec<PJVIssuerVerifier> = vec![];

        for i in 0..delegators_size {
            let id = format!("https://vc.example/delegators/d{i}");
            delegator_ids.push(id.clone());

            let credential_id = format!("http://delegation.example/credentials/{i}");
            credential_ids.push(credential_id.clone());

            let delegator =
                PJVIssuerVerifier::new(id, encryption_dlt.clone(), verification_dlt.clone())?;
            delegators.push(delegator);
        }

        let id = format!("https://vc.example/delegators/d{delegators_size}");
        delegator_ids.push(id);

        let valid_from = String::from("2026-01-01T00:00:00Z");
        let validity_period: Duration = Duration::new(3600, 0);

        let owner = Self::get(&delegator_ids, 0)?.clone();
        let resource_uri: String = String::from("https://vc.example/resources/r1");

        let context: Vec<String> = vec![String::from("https://www.w3.org/ns/credentials/v2")];

        Ok(PJVBenchmark {
            delegator_ids,
            credential_ids,
            delegators,
            context,
            valid_from,
            validity_period,
            owner,
            resource_uri,
        })
    }

    fn iterate_over_delegators(
        &self,
        total_permissions: usize,
        disclose: usize,
        iterations: u16,
    ) -> Result<BenchmarkResult, String> {
        let mut pjv_vps: Vec<String> = vec![];
        let mut pjv_vc_issuance_durations: Vec<Duration> = vec![];
        let mut pjv_vp_issuance_durations: Vec<Duration> = vec![];
        let mut pjv_vp_verification_durations: Vec<Duration> = vec![];

        let mut operations: Vec<String> = vec![];
        for i in 0..total_permissions {
            operations.push(format!("p{i}"));
        }

        let mut vc = None;
        for i in 0..self.delegators.len() {
            let delegator = Self::get(&self.delegators, i)?;
            let credential_id = Self::get(&self.credential_ids, i)?;
            let delegatee_id = Self::get(&self.delegator_ids, i + 1)?;

            let (duration, result_vc) = Self::benchmark_function(
                || {
                    delegator.issue_delegation_verifiable_credential(
                        self.context.clone(),
                        credential_id.clone(),
                        self.valid_from.clone(),
                        delegatee_id.clone(),
                        self.validity_period.clone(),
                        self.owner.clone(),
                        self.resource_uri.clone(),
                        operations.clone(),
                        vc.clone(),
                    )
                },
                iterations,
            )?;
            pjv_vc_issuance_durations.push(duration);

            let disclosures = match operations.get(0..disclose) {
                Some(disclosures) => disclosures,
                None => return Err(String::from("Could not get slice from operations")),
            }
            .to_vec();

            let (duration, result_vp) = Self::benchmark_function(
                || {
                    delegator.issue_delegation_verifiable_presentation(
                        result_vc.clone(),
                        disclosures.clone(),
                    )
                },
                iterations,
            )?;
            pjv_vp_issuance_durations.push(duration);

            pjv_vps.push(result_vp);

            vc = Some(result_vc);
        }

        let verifier = Self::get(&self.delegators, 0)?;

        for (i, vp) in pjv_vps.iter().enumerate() {
            let presenter_id = Self::get(&self.delegator_ids, i)?;
            let (duration, _) = Self::benchmark_function(
                || verifier.verify_verifiable_presentation(presenter_id.clone(), vp.clone()),
                iterations,
            )?;

            pjv_vp_verification_durations.push(duration);
        }

        Ok(BenchmarkResult::new(
            pjv_vps,
            pjv_vc_issuance_durations,
            pjv_vp_issuance_durations,
            pjv_vp_verification_durations,
        ))
    }

    fn iterate_over_permissions(
        &self,
        max_permissions: usize,
        iterations: u16,
    ) -> Result<BenchmarkResult, String> {
        let mut pjv_vps: Vec<String> = vec![];
        let mut pjv_vc_issuance_duration: Vec<Duration> = vec![];
        let mut pjv_vp_issuance_duration: Vec<Duration> = vec![];
        let mut pjv_vp_verification_duration: Vec<Duration> = vec![];

        let mut operations: Vec<String> = vec![];

        for i in 0..max_permissions {
            operations.push(format!("p{i}"));

            let mut vc = None;
            for i in 0..self.delegators.len() {
                let delegator = Self::get(&self.delegators, i)?;
                let credential_id = Self::get(&self.credential_ids, i)?;
                let delegatee_id = Self::get(&self.delegator_ids, i + 1)?;

                let (vc_duration, result_vc) = Self::benchmark_function(
                    || {
                        delegator.issue_delegation_verifiable_credential(
                            self.context.clone(),
                            credential_id.clone(),
                            self.valid_from.clone(),
                            delegatee_id.clone(),
                            self.validity_period.clone(),
                            self.owner.clone(),
                            self.resource_uri.clone(),
                            operations.clone(),
                            vc.clone(),
                        )
                    },
                    iterations,
                )?;

                let (vp_duration, vp) = Self::benchmark_function(
                    || {
                        delegator.issue_delegation_verifiable_presentation(
                            result_vc.clone(),
                            operations.clone(),
                        )
                    },
                    iterations,
                )?;

                if i == self.delegators.len() - 1 {
                    pjv_vc_issuance_duration.push(vc_duration);
                    pjv_vp_issuance_duration.push(vp_duration);
                    pjv_vps.push(vp);
                }

                vc = Some(result_vc);
            }
        }

        let verifier = Self::get(&self.delegators, 0)?;

        for vp in pjv_vps.iter() {
            let presenter_id = Self::get(&self.delegator_ids, self.delegators.len() - 1)?;
            let (duration, _) = Self::benchmark_function(
                || verifier.verify_verifiable_presentation(presenter_id.clone(), vp.clone()),
                iterations,
            )?;
            pjv_vp_verification_duration.push(duration);
        }

        Ok(BenchmarkResult::new(
            pjv_vps,
            pjv_vc_issuance_duration,
            pjv_vp_issuance_duration,
            pjv_vp_verification_duration,
        ))
    }

    fn retain_permissions(
        &self,
        permissions_size: usize,
        retain_amount: usize,
        iterations: u16,
    ) -> Result<BenchmarkResult, String> {
        let mut pjv_vps: Vec<String> = vec![];
        let mut pjv_vc_issuance_duration: Vec<Duration> = vec![];
        let mut pjv_vp_issuance_duration: Vec<Duration> = vec![];
        let mut pjv_vp_verification_duration: Vec<Duration> = vec![];

        let mut operations: Vec<String> = vec![];
        for i in 0..permissions_size {
            operations.push(format!("p{i}"));
        }

        let mut vc = None;
        for i in 0..self.delegators.len() {
            let delegator = Self::get(&self.delegators, i)?;
            let credential_id = Self::get(&self.credential_ids, i)?;
            let delegatee_id = Self::get(&self.delegator_ids, i + 1)?;

            let range = permissions_size - i * retain_amount;
            let operations_slice = match operations.get(0..range) {
                Some(operations_slice) => operations_slice,
                None => return Err(String::from("Could not get slice from operations")),
            }
            .to_vec();

            let (duration, result_vc) = Self::benchmark_function(
                || {
                    delegator.issue_delegation_verifiable_credential(
                        self.context.clone(),
                        credential_id.clone(),
                        self.valid_from.clone(),
                        delegatee_id.clone(),
                        self.validity_period.clone(),
                        self.owner.clone(),
                        self.resource_uri.clone(),
                        operations_slice.clone(),
                        vc.clone(),
                    )
                },
                iterations,
            )?;
            pjv_vc_issuance_duration.push(duration);

            let (duration, result_vp) = Self::benchmark_function(
                || {
                    delegator.issue_delegation_verifiable_presentation(
                        result_vc.clone(),
                        operations_slice.clone(),
                    )
                },
                iterations,
            )?;
            pjv_vp_issuance_duration.push(duration);

            pjv_vps.push(result_vp);

            vc = Some(result_vc);
        }

        let verifier = Self::get(&self.delegators, 0)?;

        for (i, vp) in pjv_vps.iter().enumerate() {
            let presenter_id = Self::get(&self.delegator_ids, i)?;
            let (duration, _) = Self::benchmark_function(
                || verifier.verify_verifiable_presentation(presenter_id.clone(), vp.clone()),
                iterations,
            )?;
            pjv_vp_verification_duration.push(duration);
        }

        Ok(BenchmarkResult::new(
            pjv_vps,
            pjv_vc_issuance_duration,
            pjv_vp_issuance_duration,
            pjv_vp_verification_duration,
        ))
    }
}
