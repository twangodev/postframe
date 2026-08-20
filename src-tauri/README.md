# Postframe desktop

The desktop shell packages the existing SvelteKit workspace and its Web Worker compute pipeline with Tauri 2. Native Rust owns the managed photo library; derived renders and downloaded models remain disposable OPFS caches.

## Platform support

| Platform | Target | Support | CI output |
| --- | --- | --- | --- |
| Windows x64 | `x86_64-pc-windows-msvc` | Release | Unsigned installers and bundles |
| macOS Intel and Apple silicon | `universal-apple-darwin` | Release | Unsigned universal bundles |
| Linux x64 | `x86_64-unknown-linux-gnu` | Preview | Ubuntu 24.04 bundles |

Other architectures and Linux distributions are not release targets yet. Linux requires WebKitGTK 4.1 at build and runtime.

## Managed library

A library is a user-chosen folder containing a marker, SQLite catalog, copied originals, thumbnails, edit documents, and mask rasters. Postframe remembers and reopens one library. The storage dialog can reveal it, switch libraries, or clear disposable caches; library deletion remains an explicit file-manager operation.

Browser and desktop libraries are intentionally independent. There is no automatic migration in either direction.

## Local development

Install Rust, Bun, `wasm-pack`, the Tauri prerequisites for the host OS, and the web dependencies. From `web/`:

```sh
bun install --frozen-lockfile
bun run desktop:dev
bun run desktop:build --no-sign
```

From the repository root, the native storage core can be validated without host GUI libraries:

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo clippy --manifest-path src-tauri/Cargo.toml --no-default-features --all-targets
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
cargo deny --manifest-path src-tauri/Cargo.toml --config src-tauri/deny.toml --all-features check
```
