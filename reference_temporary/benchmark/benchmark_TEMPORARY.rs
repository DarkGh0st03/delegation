use crate::benchmark::benchmark_result::BenchmarkResult;
use std::time::{Duration, Instant};
// TODO: Documentation

/// A trait that defines methods to retrieve the duration of the execution of a given function and
/// the length of the results.
pub trait Benchmark {
    fn get<I>(vector: &Vec<I>, i: usize) -> Result<&I, String> {
        match vector.get(i) {
            Some(item) => Ok(item),
            None => Err(format!("No item found at index {i}")),
        }
    }

    fn new(delegators_size: usize) -> Result<Self, String>
    where
        Self: Sized;

    fn iterate_over_delegators(
        &self,
        total_permissions: usize,
        disclose: usize,
        iterations: u16,
    ) -> Result<BenchmarkResult, String>;

    fn iterate_over_permissions(
        &self,
        max_permissions: usize,
        iterations: u16,
    ) -> Result<BenchmarkResult, String>;

    fn retain_permissions(
        &self,
        permissions_size: usize,
        retain_amount: usize,
        iterations: u16,
    ) -> Result<BenchmarkResult, String>;

    /// Benchmarks a function by executing it several times and averaging the results
    ///
    /// # Arguments
    /// * `func` - Function to be executed.
    /// * `iterations` - Amount of times that the function needs to be executed for average.
    ///
    /// # Returns
    /// A result containing either the averaged duration or a string containing an error.
    fn benchmark_function<F, T>(func: F, iterations: u16) -> Result<(Duration, T), String>
    where
        F: Fn() -> Result<T, String>,
    {
        let mut start: Instant;
        let mut result = None;
        let mut total: f64 = 0f64;

        for _ in 0..iterations {
            start = Instant::now();
            match func() {
                Ok(inner) => result = Some(inner),
                Err(err) => {
                    println!("Benchmarked function returned error [{err}]")
                }
            }

            total = total + start.elapsed().as_secs_f64();
        }

        let average_duration: Duration = Duration::from_secs_f64(total / (iterations as f64));
        match result {
            Some(result) => Ok((average_duration, result)),
            None => Err("Function did not return a result".to_string()),
        }
    }
}
