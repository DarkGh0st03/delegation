use crate::benchmark::benchmark::Benchmark;
use crate::benchmark::benchmark_result::BenchmarkResult;
use crate::delegation::entities::dtl_sim::{DLTSim, new_dlt_sim};
use crate::delegation::entities::issuer::Issuer;
use crate::delegation::entities::ours::dlt_efficient_acc_entry::DLTSimEfficientAccEntry;
use crate::delegation::entities::ours::our_efficient_issuer::OurEfficientIssuer;
use crate::delegation::entities::ours::our_efficient_verifier::OurEfficientVerifier;
use crate::delegation::entities::verifier::Verifier;
use ark_ec::pairing::Pairing;
use josekit::jwk::Jwk;
use std::time::Duration;

pub struct OurEfficientBenchmark<E: Pairing> {
    issuer_dlt: DLTSim<DLTSimEfficientAccEntry<E>>,
    holder_dlt: DLTSim<Jwk>,
    delegator_ids: Vec<String>,
    credential_ids: Vec<String>,
    delegators: Vec<OurEfficientIssuer<E>>,
    context: Vec<String>,
    valid_from: String,
    validity_period: Duration,
}

// TODO: Documentation
impl<E: Pairing> Benchmark for OurEfficientBenchmark<E> {
    fn new(delegators_size: usize) -> Result<OurEfficientBenchmark<E>, String> {
        let issuer_dlt: DLTSim<DLTSimEfficientAccEntry<E>> = new_dlt_sim();
        let holder_dlt: DLTSim<Jwk> = new_dlt_sim();

        let mut delegator_ids: Vec<String> = vec![];
        let mut credential_ids: Vec<String> = vec![];
        let mut delegators: Vec<OurEfficientIssuer<E>> = vec![];

        for i in 0..delegators_size {
            let id = format!("https://vc.example/delegators/d{i}");
            delegator_ids.push(id.clone());

            let credential_id = format!("http://delegation.example/credentials/{i}");
            credential_ids.push(credential_id.clone());

            let delegator = OurEfficientIssuer::new(id, issuer_dlt.clone(), holder_dlt.clone())?;
            delegators.push(delegator);
        }

        let id = format!("https://vc.example/delegators/d{delegators_size}");
        delegator_ids.push(id);

        let context: Vec<String> = vec![String::from("https://www.w3.org/ns/credentials/v2")];

        let valid_from = String::from("2026-01-01T00:00:00Z");
        let validity_period: Duration = Duration::new(3600, 0);

        Ok(OurEfficientBenchmark {
            issuer_dlt,
            holder_dlt,
            delegator_ids,
            credential_ids,
            delegators,
            context,
            valid_from,
            validity_period,
        })
    }

    fn iterate_over_delegators(
        &self,
        total_permissions: usize,
        disclose: usize,
        iterations: u16,
    ) -> Result<BenchmarkResult, String> {
        let mut our_vps: Vec<String> = vec![];
        let mut our_vc_issuance_durations: Vec<Duration> = vec![];
        let mut our_vp_issuance_durations: Vec<Duration> = vec![];
        let mut our_vp_verification_durations: Vec<Duration> = vec![];

        let mut permissions: Vec<String> = vec![];
        for i in 0..total_permissions {
            permissions.push(format!("https://vc.example/resources/r1:p{i}"));
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
                        permissions.clone(),
                        vc.clone(),
                    )
                },
                iterations,
            )?;
            our_vc_issuance_durations.push(duration);

            let disclosures = match permissions.get(0..disclose) {
                Some(disclosures) => disclosures,
                None => return Err(String::from("Could not get slice from permissions")),
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
            our_vp_issuance_durations.push(duration);
            our_vps.push(result_vp);
            vc = Some(result_vc);
        }

        let verifier: OurEfficientVerifier<E> =
            OurEfficientVerifier::new(self.issuer_dlt.clone(), self.holder_dlt.clone())?;

        for (i, vp) in our_vps.iter().enumerate() {
            let presenter_id = Self::get(&self.delegator_ids, i)?;
            let (duration, _) = Self::benchmark_function(
                || verifier.verify_verifiable_presentation(presenter_id.clone(), vp.clone()),
                iterations,
            )?;
            our_vp_verification_durations.push(duration);
        }

        Ok(BenchmarkResult::new(
            our_vps,
            our_vc_issuance_durations,
            our_vp_issuance_durations,
            our_vp_verification_durations,
        ))
    }

    fn iterate_over_permissions(
        &self,
        max_permissions: usize,
        iterations: u16,
    ) -> Result<BenchmarkResult, String> {
        let mut our_vps: Vec<String> = vec![];
        let mut our_vc_issuance_duration: Vec<Duration> = vec![];
        let mut our_vp_issuance_duration: Vec<Duration> = vec![];
        let mut our_vp_verification_duration: Vec<Duration> = vec![];

        let mut permissions: Vec<String> = vec![];

        for i in 0..max_permissions {
            permissions.push(format!("https://vc.example/resources/r1:p{i}"));

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
                            permissions.clone(),
                            vc.clone(),
                        )
                    },
                    iterations,
                )?;

                let (vp_duration, vp) = Self::benchmark_function(
                    || {
                        delegator.issue_delegation_verifiable_presentation(
                            result_vc.clone(),
                            permissions.clone(),
                        )
                    },
                    iterations,
                )?;

                if i == self.delegators.len() - 1 {
                    our_vc_issuance_duration.push(vc_duration);
                    our_vp_issuance_duration.push(vp_duration);
                    our_vps.push(vp);
                }

                vc = Some(result_vc);
            }
        }

        let verifier: OurEfficientVerifier<E> =
            OurEfficientVerifier::new(self.issuer_dlt.clone(), self.holder_dlt.clone())?;

        for vp in our_vps.iter() {
            let presenter_id = Self::get(&self.delegator_ids, self.delegators.len() - 1)?;
            let (duration, _) = Self::benchmark_function(
                || verifier.verify_verifiable_presentation(presenter_id.clone(), vp.clone()),
                iterations,
            )?;
            our_vp_verification_duration.push(duration);
        }

        Ok(BenchmarkResult::new(
            our_vps,
            our_vc_issuance_duration,
            our_vp_issuance_duration,
            our_vp_verification_duration,
        ))
    }

    fn retain_permissions(
        &self,
        permissions_size: usize,
        retain_amount: usize,
        iterations: u16,
    ) -> Result<BenchmarkResult, String> {
        let mut our_vps: Vec<String> = vec![];
        let mut our_vc_issuance_duration: Vec<Duration> = vec![];
        let mut our_vp_issuance_duration: Vec<Duration> = vec![];
        let mut our_vp_verification_duration: Vec<Duration> = vec![];

        let mut permissions: Vec<String> = vec![];
        for i in 0..permissions_size {
            permissions.push(format!("https://vc.example/resources/r1:p{i}"));
        }

        let mut vc = None;
        for i in 0..self.delegators.len() {
            let delegator = Self::get(&self.delegators, i)?;
            let credential_id = Self::get(&self.credential_ids, i)?;
            let delegatee_id = Self::get(&self.delegator_ids, i + 1)?;

            let range = permissions_size - i * retain_amount;
            let permissions_slice = match permissions.get(0..range) {
                Some(permissions_slice) => permissions_slice,
                None => return Err(String::from("Could not get slice from permissions")),
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
                        permissions_slice.clone(),
                        vc.clone(),
                    )
                },
                iterations,
            )?;
            our_vc_issuance_duration.push(duration);

            let (duration, result_vp) = Self::benchmark_function(
                || {
                    delegator.issue_delegation_verifiable_presentation(
                        result_vc.clone(),
                        permissions_slice.clone(),
                    )
                },
                iterations,
            )?;
            our_vp_issuance_duration.push(duration);

            our_vps.push(result_vp);

            vc = Some(result_vc);
        }

        let verifier: OurEfficientVerifier<E> =
            OurEfficientVerifier::new(self.issuer_dlt.clone(), self.holder_dlt.clone())?;

        for (i, vp) in our_vps.iter().enumerate() {
            let presenter_id = Self::get(&self.delegator_ids, i)?;
            let (duration, _) = Self::benchmark_function(
                || verifier.verify_verifiable_presentation(presenter_id.clone(), vp.clone()),
                iterations,
            )?;
            our_vp_verification_duration.push(duration);
        }

        Ok(BenchmarkResult::new(
            our_vps,
            our_vc_issuance_duration,
            our_vp_issuance_duration,
            our_vp_verification_duration,
        ))
    }
}
