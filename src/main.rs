use std::path::{Path, PathBuf};

use clap::Parser;

#[derive(Parser)]
#[command(name = "postframe", version, about)]
enum Cli {
    Probe { raf: PathBuf, jpeg: Option<PathBuf> },
}

fn main() -> anyhow::Result<()> {
    match Cli::parse() {
        Cli::Probe { raf, jpeg } => probe(&raf, jpeg.as_deref()),
    }
}

fn probe(raf: &Path, jpeg: Option<&Path>) -> anyhow::Result<()> {
    let (_, report) = postframe::measure(raf, jpeg)?;
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
    Ok(())
}
