ARG DENO_VERSION=""
ARG FEDORA_VERSION="latest"
ARG HANSEL_VERSION="latest"

FROM ghcr.io/shopify/hansel:$HANSEL_VERSION AS hansel
FROM denoland/deno:bin$DENO_VERSION AS deno
FROM fedora:$FEDORA_VERSION AS fedora
RUN dnf update -y

# Update the release info to show that this is especially modified for WSL.
RUN sed -i -e 's/Container/WSL/g' -e 's/container/wsl/g' /etc/os-release

# Give Fedora access to our hosts font library
COPY ./etc/fonts/local.conf /etc/fonts/local.conf

# Install systemd
#
# NB: There are in fact 1 or 2 extra things that if not installed make our
# rootless containers setup not work & I am yet to figure out which packages
# they are, hence this is before we instruct dnf to not bother weak deps.
RUN dnf install -y systemd
RUN printf "[boot]\nsystemd=true\n" > /etc/wsl.conf

# Stop dnf from installing shit we don't need
RUN echo "install_weak_deps=false" >> /etc/dnf/dnf.conf

# Install everything else
RUN dnf install -y \
  bash-completion \
  bind-utils \
  cracklib-dicts \
  dbus-daemon \
  dnf5-plugins \
  git \
  glibc-langpack-en \
  gpg \
  iproute \
  iptables \
  iputils \
  neovim \
  shadow-utils \
  sudo \
  tar \
  tree \
  unzip \
  wget \
  which

# Fixes: Failed to set locale, defaulting to "C.UTF-8"
ENV LANG=en_AU.UTF-8
RUN echo "LANG=en_AU.UTF-8" > /etc/locale.conf

# Install WSL Utils
# see: https://wslutiliti.es/wslu/
RUN dnf copr enable -y wslutilities/wslu
RUN dnf install -y wslu
RUN ln -s /usr/bin/wslview /usr/bin/xdg-open

# Free Up Memory
# see: <https://gist.github.com/hucsmn/da1dbc2eb5903cb3143c35313623e7b0#optimize-memory-usage>
COPY ./usr/bin/wslfree /usr/bin/wslfree
COPY ./usr/lib/systemd/system/wslfree.timer /usr/lib/systemd/system/wslfree.timer
COPY ./usr/lib/systemd/system/wslfree.service /usr/lib/systemd/system/wslfree.service
RUN chmod +x /usr/bin/wslfree
RUN systemctl enable wslfree.timer

# Allow rootless containers to ping & bind to low ports
# see: https://rootlesscontaine.rs/getting-started/common/sysctl/
COPY ./etc/sysctl.d/99-rootless.conf /etc/sysctl.d/99-rootless.conf

# Allows rootless containers to set limits to various resources
# see: <https://rootlesscontaine.rs/getting-started/common/cgroup2/#enabling-cpu-cpuset-and-io-delegation>
COPY ./etc/systemd/system/user@.service.d/delegate.conf /etc/systemd/system/user@.service.d/delegate.conf

# Solves permissions issue with rootless containers.
# [rootlesskit:parent] error: failed to setup UID/GID map:
# newuidmap 307 [0 1000 1 1 65536000 65536] failed:
# newuidmap: write to uid_map failed: Operation not permitted
RUN chmod 4755 /usr/bin/newuidmap
RUN chmod 4755 /usr/bin/newgidmap

# Install deno
COPY --from=deno /deno /usr/local/bin/deno

# Install gum, we use it in our firstboot script
# TODO: Create deno module that auto installs on the fly
# And wraps all the gum commands. Then I can use gum anywhere.
COPY ./etc/yum.repos.d/charm.repo /etc/yum.repos.d/charm.repo
RUN rpm --import https://repo.charm.sh/yum/gpg.key
RUN dnf install -y gum

# Install our firstboot experience
COPY ./root/.bash_profile /root/.bash_profile
COPY ./usr/local /usr/local
RUN deno install -e /usr/local/firstboot/main.ts --lock /usr/local/firstboot/deno.lock
RUN chmod +x /usr/local/bin/firstboot

# Add some hints for sbom generation
# see: https://github.com/Shopify/hansel
COPY --from=hansel /usr/bin/hansel /usr/bin/hansel
RUN hansel --name deno --version "$(deno --version | head -n 1 | grep -Po '\d+\.\d+\.\d+')" --install
RUN rm /usr/bin/hansel
