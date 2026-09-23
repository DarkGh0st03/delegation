use std::time::Duration;

pub struct BenchmarkResult {
    vp_lengths: Vec<String>,
    vc_issuance_durations: Vec<Duration>,
    vp_issuance_durations: Vec<Duration>,
    vp_verification_durations: Vec<Duration>,
}

impl BenchmarkResult {
    pub fn new(
        vp_lengths: Vec<String>,
        vc_issuance_durations: Vec<Duration>,
        vp_issuance_durations: Vec<Duration>,
        vp_verification_durations: Vec<Duration>,
    ) -> Self {
        BenchmarkResult {
            vp_lengths,
            vc_issuance_durations,
            vp_issuance_durations,
            vp_verification_durations,
        }
    }

    pub fn vp_lengths(&self) -> Vec<usize> {
        self.vp_lengths.iter().map(|l| l.len()).collect()
    }

    pub fn vc_issuance_durations(&self) -> Vec<u128> {
        self.vc_issuance_durations
            .iter()
            .map(Duration::as_micros)
            .collect()
    }

    pub fn vp_issuance_durations(&self) -> Vec<u128> {
        self.vp_issuance_durations
            .iter()
            .map(Duration::as_micros)
            .collect()
    }

    pub fn vp_verification_durations(&self) -> Vec<u128> {
        self.vp_verification_durations
            .iter()
            .map(Duration::as_micros)
            .collect()
    }
}
