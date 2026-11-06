# ExhibitOS public demo

This repository builds the approved reference exhibition for demo.exhibitos.org. The locked output includes the Viewer, cover, Studio entry and existing editor assets.

Use Node 24.21.0, npm 11.19.0 and Git. Run `node build.mjs` from a fresh checkout. The build fetches the pinned public Platform commit, installs its locked dependencies without lifecycle scripts and runs Platform's reference demo build. It verifies the exact output file inventory and SHA-256 digests before placing the site in `dist-demo`. Serve that directory as the preview root.

The lock records the source and toolchain, publication revision, public index and manifest, and all approved output digests. A content or shared dependency update requires an explicit lock update and verification. Deployment configuration is managed separately.

Platform source is available at [ExhibitOS/platform](https://github.com/ExhibitOS/platform) under AGPL-3.0-or-later. The build carries through the pinned publication rights records and generated third-party notices. Those records govern the individual assets.

## Cloudflare non-production preview

Delivery configures the approved isolated Worker before running these commands. Use an explicit `DEMO_PREVIEW_WORKER` ending in `-preview`, a unique `DEMO_PREVIEW_NAME`, `CLOUDFLARE_ACCOUNT_ID` and a scoped `CLOUDFLARE_API_TOKEN` supplied through the provider's secret settings. The Worker must have an approved preview URL and scope, with no production routes or bindings.

Use `node build.mjs --prepare-preview` as the build command and `node preview.mjs` as the preview command in the same fresh workspace. The build installs the Platform lock once and retains its Wrangler 4.147.0 in ignored local tooling. The preview verifies the same `dist-demo` again, writes a one-use config and calls only Wrangler Preview. No second build or additional dependency installation is needed.

Keep the build and preview receipts on failure. If the upload result is uncertain, check the named Preview and deployment history before retrying. Delivery can remove its own Preview after verifying the exact account, Worker and Preview name. Discard the isolated workspace when its receipts are retained. Production settings and rollback are managed separately.
