# postframe

Merges an exposure bracket into a single HDR image while preserving the camera's
own rendering. Given a raw file and its paired straight-out-of-camera JPEG, that
rendering is recovered as a measurable transfer function and applied to the
merged radiance.

## Layout

```
core/      GPL-3.0-or-later, lib. The pipeline. One file per stage.
cli/       GPL-3.0-or-later, bin "postframe".
crates/    MIT OR Apache-2.0 only. Extraction candidates.
```

## Licensing firewall

**Nothing in `crates/` may depend on `core/`, `cli/`, or on any GPL/LGPL
dependency.** Permissive crates are implemented from published papers, never
transcribed from GPL codebases; carry the citation and DOI at the top of the
module. Never vendor papers.

## Style

Self-documenting code. Prefer a clear name over a comment explaining an unclear
one. Comments earn their place by saying *why*, never *what*.

Non-obvious camera behaviour is the exception worth commenting, because it reads
as a bug otherwise.

## Boundaries

`core` does not print, does not exit, and does not write files. It returns typed
errors and bytes. Progress, previews, and cancellation go through the `Observer`
trait; diagnostics go through `tracing`. Image encoding is a `cli` dependency —
that is what keeps the boundary honest, and why a GUI can be added later without
touching `core`.

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
