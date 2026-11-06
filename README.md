# ExhibitOS public demo

This repository builds the approved reference exhibition for demo.exhibitos.org. The locked output includes the Viewer, cover, Studio entry and existing editor assets.

Use Node 24.21.0, npm 11.19.0 and Git. Run `node build.mjs` from a fresh checkout. The build fetches the pinned public Platform commit, installs its locked dependencies without lifecycle scripts and runs Platform's reference demo build. It verifies the exact output file inventory and SHA-256 digests before placing the site in `dist-demo`. Serve that directory as the preview root.

The lock records the source and toolchain, publication revision, public index and manifest, and all approved output digests. A content or shared dependency update requires an explicit lock update and verification. Deployment configuration is managed separately.

Platform source is available at [ExhibitOS/platform](https://github.com/ExhibitOS/platform) under AGPL-3.0-or-later. The build carries through the pinned publication rights records and generated third-party notices. Those records govern the individual assets.
