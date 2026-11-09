# PS4 homebrew projects for MediaChafa Beta

Beta can compile original PS4 homebrew projects into installable PKG artifacts with the OpenOrbis PS4 Toolchain.

## Required project layout

```
app-source/ps4/<project-name>/
  build.sh
  Makefile                 # optional; OpenOrbis hello_world sample is copied if missing
  <project-name>/
    main.cpp               # or one or more .c/.cpp files
  sce_sys/
    icon0.png              # optional; sample icon is copied if missing
    about/right.sprx       # sample notice module is copied if missing
  sce_module/              # sample libc modules copied if missing
  assets/
  dist/                    # generated PKG output
```

Use the official OpenOrbis sample Makefile as the build template:
https://raw.githubusercontent.com/OpenOrbis/OpenOrbis-PS4-Toolchain/v0.5.4/samples/hello_world/Makefile

The sample Makefile expects source files under a subdirectory whose name matches the project folder name. It compiles an Orbis ELF, creates `eboot.bin`, generates `param.sfo` and a GP4 project, then calls OpenOrbis `PkgTool.Core` to produce a PKG. Set a unique homebrew `TITLE_ID`, `CONTENT_ID`, and `TITLE` in the Makefile. The workflow supplies the sample icon, notice module, and basic sample PRX modules when those files are not included in the project.

The required `build.sh` can be as simple as:

```bash
#!/usr/bin/env bash
set -euo pipefail
make
mkdir -p dist
mv ./*.pkg dist/
```

The owner explicitly starts the build through Beta. GitHub Actions checks out the isolated `beta-agent/*` branch, installs pinned OpenOrbis PS4 Toolchain v0.5.4, uses read-only repository permissions, and uploads the generated PKG as a 30-day artifact. It does not merge, publish to the website, or write to the repository.

## Scope and signing

This pipeline is for original PS4 homebrew applications and test packages for consoles with the appropriate jailbreak/homebrew environment. It does not create retail signatures, bypass DRM, repackage commercial games, or supply Sony signing keys. A generated homebrew PKG is not a retail-signed application.

See https://github.com/OpenOrbis/OpenOrbis-PS4-Toolchain for the toolchain documentation and license.
