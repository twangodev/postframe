use clap::Parser;

#[derive(Parser)]
#[command(name = "postframe", version, about, long_about = None)]
struct Cli {}

fn main() -> anyhow::Result<()> {
    let Cli {} = Cli::parse();
    Ok(())
}
