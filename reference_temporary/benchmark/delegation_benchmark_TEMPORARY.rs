use crate::benchmark::benchmark::Benchmark;
use crate::benchmark::benchmark_result::BenchmarkResult;
use crate::benchmark::our_benchmark::OurBenchmark;
#[cfg(feature = "efficient")]
use crate::benchmark::our_efficient_benchmark::OurEfficientBenchmark;
use crate::benchmark::pjvs_benchmark::PJVBenchmark;
use crate::benchmark::sdjwt_benchmark::SdJWTBenchmark;
#[cfg(feature = "efficient")]
use crate::benchmark::sdjwt_efficient_benchmark::SdJWTEfficientBenchmark;
use crate::csv_writer::CSVWriter;
use ark_ec::pairing::Pairing;
use serde::Serialize;
use std::fmt::Debug;

fn iterate_and_write_results<T: Serialize + Debug>(
    our_data: &Vec<T>,
    #[cfg(feature = "efficient")] our_efficient_data: &Vec<T>,
    pjv_data: &Vec<T>,
    sdjwt_data: &Vec<T>,
    #[cfg(feature = "efficient")] sdjwt_efficient_data: &Vec<T>,
    writer: &mut CSVWriter,
    filename: &String,
) -> Result<(), String> {
    #[cfg(feature = "efficient")]
    assert!(
        our_data.len() == our_efficient_data.len()
            && our_data.len() == pjv_data.len()
            && our_data.len() == sdjwt_data.len()
            && our_data.len() == sdjwt_efficient_data.len()
    );
    #[cfg(not(feature = "efficient"))]
    assert!(our_data.len() == pjv_data.len() && our_data.len() == sdjwt_data.len());

    for i in 0..our_data.len() {
        writer.write_record_to_file(
            filename,
            (
                &our_data[i],
                #[cfg(feature = "efficient")]
                &our_efficient_data[i],
                &pjv_data[i],
                &sdjwt_data[i],
                #[cfg(feature = "efficient")]
                &sdjwt_efficient_data[i],
            ),
        )?;
    }

    Ok(())
}

fn write_results(
    vc_issuance_filename: String,
    vp_length_filename: String,
    vp_issuance_filename: String,
    vp_verification_filename: String,
    our_results: BenchmarkResult,
    #[cfg(feature = "efficient")] our_efficient_results: BenchmarkResult,
    pjv_results: BenchmarkResult,
    sdjwt_results: BenchmarkResult,
    #[cfg(feature = "efficient")] sdjwt_efficient_results: BenchmarkResult,
) -> Result<(), String> {
    let mut writer = CSVWriter::new(vec![
        String::from("Ours"),
        #[cfg(feature = "efficient")]
        String::from("OursEfficient"),
        String::from("PJVs"),
        String::from("SdJWT"),
        #[cfg(feature = "efficient")]
        String::from("SdJWTEfficient"),
    ])?;
    writer.add_file(&vc_issuance_filename)?;
    writer.add_file(&vp_length_filename)?;
    writer.add_file(&vp_issuance_filename)?;
    writer.add_file(&vp_verification_filename)?;

    iterate_and_write_results(
        &our_results.vc_issuance_durations(),
        #[cfg(feature = "efficient")]
        &our_efficient_results.vc_issuance_durations(),
        &pjv_results.vc_issuance_durations(),
        &sdjwt_results.vc_issuance_durations(),
        #[cfg(feature = "efficient")]
        &sdjwt_efficient_results.vc_issuance_durations(),
        &mut writer,
        &vc_issuance_filename,
    )?;

    iterate_and_write_results(
        &our_results.vp_lengths(),
        #[cfg(feature = "efficient")]
        &our_efficient_results.vp_lengths(),
        &pjv_results.vp_lengths(),
        &sdjwt_results.vp_lengths(),
        #[cfg(feature = "efficient")]
        &sdjwt_efficient_results.vp_lengths(),
        &mut writer,
        &vp_length_filename,
    )?;

    iterate_and_write_results(
        &our_results.vp_issuance_durations(),
        #[cfg(feature = "efficient")]
        &our_efficient_results.vp_issuance_durations(),
        &pjv_results.vp_issuance_durations(),
        &sdjwt_results.vp_issuance_durations(),
        #[cfg(feature = "efficient")]
        &sdjwt_efficient_results.vp_issuance_durations(),
        &mut writer,
        &vp_issuance_filename,
    )?;

    iterate_and_write_results(
        &our_results.vp_verification_durations(),
        #[cfg(feature = "efficient")]
        &our_efficient_results.vp_verification_durations(),
        &pjv_results.vp_verification_durations(),
        &sdjwt_results.vp_verification_durations(),
        #[cfg(feature = "efficient")]
        &sdjwt_efficient_results.vp_verification_durations(),
        &mut writer,
        &vp_verification_filename,
    )?;

    Ok(())
}

pub fn iterate_over_delegators<E: Pairing>(
    max_delegators: usize,
    total_permissions: usize,
    disclose: usize,
    iterations: u16,
) -> Result<(), String> {
    if disclose > total_permissions {
        return Err(format!(
            "Cannot disclose more permissions than those included in the credential [{disclose} > {total_permissions}]"
        ));
    } else if disclose < 1 {
        return Err(format!(
            "Permissions to disclose must be at least 1 [{disclose}]"
        ));
    }

    let iod_vc_issuance_filename = format!("iod_vc_issuance_{}", disclose);
    let iod_vp_length_filename = format!("iod_vp_length_{}", disclose);
    let iod_vp_issuance_filename = format!("iod_vp_issuance_{}", disclose);
    let iod_vp_verification_filename = format!("iod_vp_verification_{}", disclose);

    let our_benchmark = OurBenchmark::<E>::new(max_delegators)?;
    #[cfg(feature = "efficient")]
    let our_efficient_benchmark = OurEfficientBenchmark::<E>::new(max_delegators)?;
    let pjv_benchmark = PJVBenchmark::new(max_delegators)?;
    let sdjwt_benchmark = SdJWTBenchmark::new(max_delegators)?;
    #[cfg(feature = "efficient")]
    let sdjwt_efficient_benchmark = SdJWTEfficientBenchmark::new(max_delegators)?;

    let our_results =
        our_benchmark.iterate_over_delegators(total_permissions, disclose, iterations)?;
    #[cfg(feature = "efficient")]
    let our_efficient_results =
        our_efficient_benchmark.iterate_over_delegators(total_permissions, disclose, iterations)?;
    let pjv_results =
        pjv_benchmark.iterate_over_delegators(total_permissions, disclose, iterations)?;
    let sdjwt_results =
        sdjwt_benchmark.iterate_over_delegators(total_permissions, disclose, iterations)?;
    #[cfg(feature = "efficient")]
    let sdjwt_efficient_results = sdjwt_efficient_benchmark.iterate_over_delegators(
        total_permissions,
        disclose,
        iterations,
    )?;

    write_results(
        iod_vc_issuance_filename,
        iod_vp_length_filename,
        iod_vp_issuance_filename,
        iod_vp_verification_filename,
        our_results,
        #[cfg(feature = "efficient")]
        our_efficient_results,
        pjv_results,
        sdjwt_results,
        #[cfg(feature = "efficient")]
        sdjwt_efficient_results,
    )
}

pub fn iterate_over_permissions<E: Pairing>(
    total_delegators: usize,
    max_permissions: usize,
    iterations: u16,
) -> Result<(), String> {
    let iop_vc_issuance_filename = String::from("iop_vc_issuance");
    let iop_vp_length_filename = String::from("iop_vp_length");
    let iop_vp_issuance_filename = String::from("iop_vp_issuance");
    let iop_vp_verification_filename = String::from("iop_vp_verification");

    let our_benchmark = OurBenchmark::<E>::new(total_delegators)?;
    #[cfg(feature = "efficient")]
    let our_efficient_benchmark = OurEfficientBenchmark::<E>::new(total_delegators)?;
    let pjv_benchmark = PJVBenchmark::new(total_delegators)?;
    let sdjwt_benchmark = SdJWTBenchmark::new(total_delegators)?;
    #[cfg(feature = "efficient")]
    let sdjwt_efficient_benchmark = SdJWTEfficientBenchmark::new(total_delegators)?;

    let our_results = our_benchmark.iterate_over_permissions(max_permissions, iterations)?;
    #[cfg(feature = "efficient")]
    let our_efficient_results =
        our_efficient_benchmark.iterate_over_permissions(max_permissions, iterations)?;
    let pjv_results = pjv_benchmark.iterate_over_permissions(max_permissions, iterations)?;
    let sdjwt_results = sdjwt_benchmark.iterate_over_permissions(max_permissions, iterations)?;
    #[cfg(feature = "efficient")]
    let sdjwt_efficient_results =
        sdjwt_efficient_benchmark.iterate_over_permissions(max_permissions, iterations)?;

    write_results(
        iop_vc_issuance_filename,
        iop_vp_length_filename,
        iop_vp_issuance_filename,
        iop_vp_verification_filename,
        our_results,
        #[cfg(feature = "efficient")]
        our_efficient_results,
        pjv_results,
        sdjwt_results,
        #[cfg(feature = "efficient")]
        sdjwt_efficient_results,
    )
}

pub fn retain_permissions<E: Pairing>(
    delegators_size: usize,
    permissions_size: usize,
    retain_amount: usize,
    iterations: u16,
) -> Result<(), String> {
    let retain_check = permissions_size / delegators_size;
    if retain_check != retain_amount {
        return Err(format!(
            "Retain amount [{retain_amount}] must be equal to Permissions [{permissions_size}] / Delegators [{delegators_size}]"
        ));
    }

    let rp_vc_issuance_filename = String::from("rp_vc_issuance");
    let rp_vp_length_filename = String::from("rp_vp_length");
    let rp_vp_issuance_filename = String::from("rp_vp_issuance");
    let rp_vp_verification_filename = String::from("rp_vp_verification");

    let our_benchmark = OurBenchmark::<E>::new(delegators_size)?;
    #[cfg(feature = "efficient")]
    let our_efficient_benchmark = OurEfficientBenchmark::<E>::new(delegators_size)?;
    let pjv_benchmark = PJVBenchmark::new(delegators_size)?;
    let sdjwt_benchmark = SdJWTBenchmark::new(delegators_size)?;
    #[cfg(feature = "efficient")]
    let sdjwt_efficient_benchmark = SdJWTEfficientBenchmark::new(delegators_size)?;

    let our_results =
        our_benchmark.retain_permissions(permissions_size, retain_amount, iterations)?;
    #[cfg(feature = "efficient")]
    let our_efficient_results =
        our_efficient_benchmark.retain_permissions(permissions_size, retain_amount, iterations)?;
    let pjv_results =
        pjv_benchmark.retain_permissions(permissions_size, retain_amount, iterations)?;
    let sdjwt_results =
        sdjwt_benchmark.retain_permissions(permissions_size, retain_amount, iterations)?;
    #[cfg(feature = "efficient")]
    let sdjwt_efficient_results = sdjwt_efficient_benchmark.retain_permissions(
        permissions_size,
        retain_amount,
        iterations,
    )?;

    write_results(
        rp_vc_issuance_filename,
        rp_vp_length_filename,
        rp_vp_issuance_filename,
        rp_vp_verification_filename,
        our_results,
        #[cfg(feature = "efficient")]
        our_efficient_results,
        pjv_results,
        sdjwt_results,
        #[cfg(feature = "efficient")]
        sdjwt_efficient_results,
    )
}
