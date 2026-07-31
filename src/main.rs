use std::path::{Path, PathBuf};

use clap::Parser;

#[derive(Parser)]
#[command(name = "postframe", version, about)]
enum Cli {
    Probe { raf: PathBuf },
}

fn main() -> anyhow::Result<()> {
    match Cli::parse() {
        Cli::Probe { raf } => probe(&raf),
    }
}

fn probe(raf: &Path) -> anyhow::Result<()> {
    let (_, report) = postframe::measure(raf)?;
    println!("working space   {:?}", report.space);
    println!(
        "tiles           {} accepted, {} rejected",
        report.accepted, report.rejected
    );
    println!();
    println!("channel   rms (8-bit codes)   corr(|residual|, gradient)");
    for (name, c) in ["R", "G", "B"].into_iter().zip(0..) {
        println!(
            "{name}         {:<20.3}{:.3}",
            report.rms[c], report.grad_corr[c]
        );
    }
    Ok(())
}
