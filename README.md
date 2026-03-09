# Anvish Web

Static website for Anvish.

It ships a browser editor built with Monaco, runs Anvish locally in a WebAssembly worker, shows inline diagnostics, and links back to the main GitHub repository.

License: GPL-3.0. See [`LICENSE`](./LICENSE).

## What is in this repo

- `site/`: static frontend assets
- `runner/`: small WASI wrapper binary that reads shell code from stdin and prints JSON diagnostics
- `vendor/tree-sitter-0.22.6/`: local patch used only for the browser build target
- `scripts/build-site.sh`: local build entrypoint
- `.github/workflows/pages.yml`: GitHub Pages build and deploy workflow

## Local build

The build script looks for the Anvish core repository in one of these locations:

- `./anvish-core`
- `/workspace/anvish`
- `../anvish`

Then run:

```bash
./scripts/build-site.sh
```

The output goes to `dist/`.

## GitHub Pages

Deployment instructions are in [`docs-github-io.md`](./docs-github-io.md).
