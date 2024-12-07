# Fedora as a WSL rootfs

To install:

- Download tarball from releases: `https://github.com/brad-jones/wsl-rootfs-fedora/releases/download/<TAG>/wsl-rootfs-fedora_<TAG>.tar.gz`
- Optionally verify your download with: `gh attestation verify --owner brad-jones ./wsl-rootfs-fedora_<TAG>.tar.gz`
  - see: <https://github.blog/changelog/2024-06-25-artifact-attestations-is-generally-available/>
- Create WSL VM: `wsl --import fedora ~/.wsl/fedora ~/Downloads/wsl-rootfs-fedora_<TAG>.tar.gz`
