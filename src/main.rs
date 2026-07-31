use std::path::{Path, PathBuf};

use anstream::println;
use anstyle::{AnsiColor, Style};
use anyhow::Context;
use clap::Parser;

const LABEL: Style = Style::new().dimmed();
const HEADER: Style = Style::new().bold();
const OK: Style = AnsiColor::Green.on_default();
const WARN: Style = AnsiColor::Yellow.on_default();
const FAIL: Style = AnsiColor::Red.on_default().bold();
const CHANNEL: [Style; 3] = [
    AnsiColor::Red.on_default().bold(),
    AnsiColor::Green.on_default().bold(),
    AnsiColor::Blue.on_default().bold(),
];

#[derive(Parser)]
#[command(
    name = "postframe",
    version,
    about,
    args_conflicts_with_subcommands = true
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
    /// Bracket to open in the gui
    #[arg(value_name = "RAF")]
    rafs: Vec<PathBuf>,
}

#[derive(clap::Subcommand)]
enum Command {
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
    Batch {
        dir: PathBuf,
        #[arg(short, long)]
        output: PathBuf,
        #[arg(long)]
        tone: bool,
    },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Some(Command::Probe { raf, jpeg }) => probe(&raf, jpeg.as_deref()),
        Some(Command::Merge {
            rafs,
            output,
            ev,
            tone,
        }) => merge(&rafs, &output, ev, tone),
        Some(Command::Batch { dir, output, tone }) => batch(&dir, &output, tone),
        None => anyhow::bail!("the web ui is not wired up yet; use a subcommand (see --help)"),
    }
}

fn batch(dir: &Path, output: &Path, tone: bool) -> anyhow::Result<()> {
    let mut rafs: Vec<PathBuf> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("raf")))
        .collect();
    rafs.sort();
    if rafs.is_empty() {
        anyhow::bail!("no RAF files in {}", dir.display());
    }
    std::fs::create_dir_all(output)?;

    let mut brackets: Vec<Vec<PathBuf>> = Vec::new();
    for raf in rafs {
        let bias = postframe::bracket::exposure_bias(&raf, sibling_jpeg(&raf).as_deref())?;
        let base_frame = bias.is_none_or(|b| b.abs() < 0.01);
        match brackets.last_mut() {
            Some(current) if !base_frame => current.push(raf),
            _ => brackets.push(vec![raf]),
        }
    }

    let mut failures = 0;
    for bracket in &brackets {
        let stem = bracket[0].file_stem().unwrap_or_default().to_string_lossy();
        if bracket.len() < 2 {
            println!("{WARN}{stem}: skipped, single frame{WARN:#}\n");
            continue;
        }
        println!(
            "{HEADER}{stem}{HEADER:#} {LABEL}({} frames){LABEL:#}",
            bracket.len()
        );
        let target = output.join(format!("{stem}.jpg"));
        match merge(bracket, &target, 0.0, tone) {
            Ok(()) => println!(),
            Err(error) => {
                failures += 1;
                println!("{FAIL}{stem}: FAILED{FAIL:#} — {error:#}\n");
            }
        }
    }
    if failures > 0 {
        anyhow::bail!("{failures} bracket(s) failed");
    }
    Ok(())
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
            "{LABEL}hdr headroom{LABEL:#}    {HEADER}{:.2}{HEADER:#} stops above SDR white",
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
    println!("{LABEL}exposures{LABEL:#}       {:?} s", report.exposures);
    println!("{LABEL}shifts{LABEL:#}          {:?} px", report.shifts);
    println!(
        "{LABEL}radiance max{LABEL:#}    {:.2}x reference white",
        report.radiance_max
    );
    print_fit(&report.fit);
    println!();
    println!("{LABEL}wrote{LABEL:#} {OK}{}{OK:#}", output.display());
    Ok(())
}

fn sibling_jpeg(raf: &Path) -> Option<PathBuf> {
    ["JPG", "jpg", "JPEG", "jpeg"]
        .iter()
        .map(|ext| raf.with_extension(ext))
        .find(|p| p.is_file())
}

fn print_fit(report: &postframe::Report) {
    println!("{LABEL}working space{LABEL:#}   {:?}", report.space);
    println!(
        "{LABEL}tiles{LABEL:#}           {} accepted, {} rejected",
        report.accepted, report.rejected
    );
    println!();
    println!("{LABEL}channel   rms     flat rms   corr(|residual|, gradient){LABEL:#}");
    for (name, c) in ["R", "G", "B"].into_iter().zip(0..) {
        let style = CHANNEL[c];
        println!(
            "{style}{name}{style:#}         {:<8.3}{:<11.3}{:.3}",
            report.rms[c], report.flat_rms[c], report.grad_corr[c]
        );
    }
}

fn print_mix(transfer: &postframe::Transfer) {
    println!();
    println!("{LABEL}cross-channel mix{LABEL:#}");
    for ((name, row), style) in ["R", "G", "B"].into_iter().zip(transfer.mix).zip(CHANNEL) {
        println!(
            "{style}{name}{style:#}   [{:+.4} {:+.4} {:+.4}]",
            row[0], row[1], row[2]
        );
    }
}
