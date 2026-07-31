# postframe

Post-processing built on your JPEGs.

## Layout

Single crate. The library is the pipeline; the binary is a thin shell over it.

```
src/lib.rs    library root. Pipeline stages in modules alongside it.
src/main.rs   bin "postframe", behind the `cli` feature.
```

## Style

Self-documenting: highly abstracted code that reads well. Comments only when
truly necessary — very rare.

## Boundaries

The library does not print, exit, or write files; it returns typed errors and
bytes. CLI-only dependencies stay behind the `cli` feature, so
`cargo build --no-default-features` fails if the library reaches for one.

## Commands

```
cargo fmt --all
cargo clippy --all-targets --all-features
cargo test
cargo deny check
```
