# postframe

Merges an exposure bracket into a single HDR image while preserving the camera's
own rendering. Given a raw file and its paired straight-out-of-camera JPEG, that
rendering is recovered as a measurable transfer function and applied to the
merged radiance.

## Layout

Single crate. The library is the pipeline; the binary is a thin shell over it.

```
src/lib.rs    library root. One file per pipeline stage alongside it.
src/main.rs   bin "postframe", behind the `cli` feature.
```

Add subfolders when a group earns one; flat until then.

## Style

Self-documenting code. Prefer a clear name over a comment explaining an unclear
one. Comments earn their place by saying *why*, never *what*.

Non-obvious camera behaviour is the exception worth commenting, because it reads
as a bug otherwise.

## Boundaries

`core` does not print, does not exit, and does not write files. It returns typed
errors and bytes. Progress, previews, and cancellation go through the `Observer`
trait; diagnostics go through `tracing`.

CLI-only dependencies (clap, image encoding, progress bars) live behind the
`cli` feature, so `cargo build --no-default-features` fails if the library
reaches for one. That is what keeps the boundary honest, and why a GUI can be
added later without disturbing the pipeline.

## Commands

```
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo deny check
```

## Repo conventions

`docs/` holds local working notes. Never stage or commit it, and never add it to
`.gitignore`. A permanent `?? docs/` in `git status` is intended. Stage explicit
paths; no `git add -A`.
