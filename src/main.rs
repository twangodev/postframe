use std::path::{Path, PathBuf};

use anyhow::Context;
use clap::Parser;

#[derive(Parser)]
#[command(name = "postframe", version, about)]
enum Cli {
    Probe {
        raf: PathBuf,
        jpeg: Option<PathBuf>,
    },
    Merge {
        rafs: Vec<PathBuf>,
        #[arg(short, long)]
        output: PathBuf,
        #[arg(long, default_value_t = 0.0)]
        ev: f32,
        #[arg(long)]
        tone: bool,
    },
}

fn main() -> anyhow::Result<()> {
    match Cli::parse() {
        Cli::Probe { raf, jpeg } => probe(&raf, jpeg.as_deref()),
        Cli::Merge {
            rafs,
            output,
            ev,
            tone,
        } => merge(&rafs, &output, ev, tone),
    }
}

fn probe(raf: &Path, jpeg: Option<&Path>) -> anyhow::Result<()> {
    let (transfer, report) = postframe::measure(raf, jpeg)?;
    print_fit(&report);
    print_mix(&transfer);
    Ok(())
}

fn merge(rafs: &[PathBuf], output: &Path, ev: f32, tone: bool) -> anyhow::Result<()> {
    let jpegs: Vec<Option<PathBuf>> = rafs.iter().map(|raf| sibling_jpeg(raf)).collect();
    let pairs: Vec<(&Path, Option<&Path>)> = rafs
        .iter()
        .zip(&jpegs)
        .map(|(raf, jpeg)| (raf.as_path(), jpeg.as_deref()))
        .collect();

    let merged = postframe::merge(&pairs)?;

    let jpeg_out = output
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("jpg") || e.eq_ignore_ascii_case("jpeg"));
    if jpeg_out && !tone {
        let encoded = postframe::hdr::encode(&merged)?;
        std::fs::write(output, &encoded.bytes)?;
        println!(
            "hdr headroom    {:.2} stops above SDR white",
            encoded.boost_stops
        );
    } else {
        let rendered = if tone {
            merged.render_tone_mapped(ev)
        } else {
            merged.render(ev)
        };
        if jpeg_out {
            let mut bytes = Vec::new();
            jpeg_encoder::Encoder::new(&mut bytes, 92).encode(
                &rendered.rgb8,
                rendered.width as u16,
                rendered.height as u16,
                jpeg_encoder::ColorType::Rgb,
            )?;
            std::fs::write(output, &bytes)?;
        } else {
            image::RgbImage::from_raw(rendered.width as u32, rendered.height as u32, rendered.rgb8)
                .context("rendered buffer size mismatch")?
                .save(output)?;
        }
    }

    let report = &merged.report;
    println!("exposures       {:?} s", report.exposures);
    println!("shifts          {:?} binned px", report.shifts);
    println!(
        "radiance max    {:.2}x reference white",
        report.radiance_max
    );
    print_fit(&report.fit);
    println!();
    println!("wrote {}", output.display());
    Ok(())
}

fn sibling_jpeg(raf: &Path) -> Option<PathBuf> {
    ["JPG", "jpg", "JPEG", "jpeg"]
        .iter()
        .map(|ext| raf.with_extension(ext))
        .find(|p| p.is_file())
}

fn print_fit(report: &postframe::Report) {
    println!("working space   {:?}", report.space);
    println!(
        "tiles           {} accepted, {} rejected",
        report.accepted, report.rejected
    );
    println!();
    println!("channel   rms     flat rms   corr(|residual|, gradient)");
    for (name, c) in ["R", "G", "B"].into_iter().zip(0..) {
        println!(
            "{name}         {:<8.3}{:<11.3}{:.3}",
            report.rms[c], report.flat_rms[c], report.grad_corr[c]
        );
    }
}

fn print_mix(transfer: &postframe::Transfer) {
    println!();
    println!("cross-channel mix");
    for (name, row) in ["R", "G", "B"].into_iter().zip(transfer.mix) {
        println!("{name}   [{:+.4} {:+.4} {:+.4}]", row[0], row[1], row[2]);
    }
}
