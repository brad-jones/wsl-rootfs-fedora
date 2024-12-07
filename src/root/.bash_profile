# .bash_profile

# Get the aliases and functions
if [ -f ~/.bashrc ]; then
  . ~/.bashrc
fi

# User specific environment and startup programs
if ! [ -f ~/.first-boot ]; then
  firstboot
fi
