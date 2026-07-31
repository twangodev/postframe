# postframe

Merges a Fujifilm exposure bracket into a single HDR image while preserving the
in-camera film simulation. Given a RAF and its paired SOOC JPEG, the film
simulation is recovered as a measurable transfer function and applied to the
merged radiance.

## Layout

```
core/      GPL-3.0-or-later, lib. The pipeline. One file per stage.
cli/       GPL-3.0-or-later, bin "postframe". clap + indicatif.
crates/    MIT OR Apache-2.0 only. Extraction candidates.
```

## Licensing firewall

**Nothing in `crates/` may depend on `core/`, `cli/`, or on any GPL/LGPL
dependency.** `rawler` is LGPL-2.1, so it belongs to `core/` and can never
become a `crates/*` dependency — that would make the permissive extraction
non-extractable.

Permissive crates are implemented from published papers, never transcribed from
GPL codebases. `cargo deny check` enforces the dependency side in CI; the
clean-room side is on you.

## Style

Self-documenting code. Prefer a clear name over a comment explaining an unclear
one. Comments earn their place by saying *why*, never *what*.

Two exceptions, both load-bearing:

- Modules in `crates/` carry a paper citation with DOI at the top. Six months on
  that comment is the only durable evidence of clean-room provenance.
- Non-obvious camera behaviour gets a note, because it reads as a bug otherwise
  (e.g. Fuji AE-BKT writes frames as 0, −2, +2, so the reference frame is
  selected by sorting on `ExposureTime`, not by taking the middle index).

Never vendor papers. IEEE and ACM PDFs are not redistributable. Cite by DOI.

## Boundaries

`core` does not print, does not exit, and does not write files. It returns typed
errors and bytes. Progress, previews, and cancellation go through the `Observer`
trait. PNG encoding is a `cli` dependency — that is what keeps the boundary
honest, and it is the reason a GUI can be added later without touching `core`.

## Commands

```
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo deny check
```

## Repo conventions

- `rawler` does not follow SemVer. Pin it exactly (`=0.7.2`).
- `docs/superpowers/` holds local working notes. Never stage or commit it, and
  never add it to `.gitignore`. A permanent `?? docs/` in `git status` is
  intended. Stage explicit paths; no `git add -A`.
