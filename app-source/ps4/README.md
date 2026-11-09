# PS4 homebrew projects for MediaChafa Beta

Beta can compile PS4 homebrew projects into installable PKG artifacts with the OpenOrbis PS4 Toolchain.

## Project layout

Create one directory per project:

```
app-source/ps4/<project-name>/
  src/
  assets/
  build.sh
  dist/                 # generated; do not commit build outputs
```

The autonomous agent writes the project source and a `build.sh` script. The script must use the pinned OpenOrbis SDK available in `OO_PS4_TOOLCHAIN`, compile the program, create the PS4 executable/package metadata, and write at least one non-empty `.pkg` file into `dist/`.

The GitHub Actions workflow runs only when the owner explicitly asks Beta to build. It checks out the current isolated `beta-agent/*` branch, uses read-only repository permissions, has no signing secrets, and uploads the generated PKG as a 30-day workflow artifact. It does not merge, publish to the website, or write to the repository.

## Scope and signing

This pipeline is for original PS4 homebrew applications and test packages for consoles with the appropriate jailbreak/homebrew environment. It does not create retail signatures, bypass DRM, repackage commercial games, or supply Sony signing keys. A generated homebrew PKG is not a retail-signed application.

The toolchain is OpenOrbis PS4 Toolchain v0.5.4. See https://github.com/OpenOrbis/OpenOrbis-PS4-Toolchain for its documentation and license.
