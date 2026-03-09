# Deploying Anvish Web to GitHub Pages

1. Create a dedicated repository for the website, for example `anvish-web`.
2. Push this directory as the default branch of that repository.
3. In GitHub, open `Settings -> Pages` and set `Source` to `GitHub Actions`.
4. Open `Settings -> Actions -> General` and allow workflows to run.
5. If the main Anvish repository is not `nE0sIghT/anvish`, edit `.github/workflows/pages.yml` and change `repository:` in the `Check out anvish core` step.
6. Push to `main`. The `Pages` workflow will:
   - check out the website repo,
   - check out the core Anvish repo,
   - build the wasm bundle,
   - publish the static site to GitHub Pages.
7. The site will appear at `https://<user>.github.io/<repo>/`.

## Local build

The build script looks for the core repo in one of these locations:
- `./anvish-core`
- `/workspace/anvish`
- `../anvish`

Then run:

```bash
./scripts/build-site.sh
```

The output goes to `dist/`.
