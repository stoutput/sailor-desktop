#!/bin/bash

brew tap homebrew/core --force
brew extract --version=$(brew info --json=v2 docker | jq -r '.[].[].versions.stable') docker stoutput/homebrew-sailor
brew extract --version=$(brew info --json=v2 colima | jq -r '.[].[].versions.stable') colima stoutput/homebrew-sailor
cd /opt/homebrew/Library/Taps/stoutput/homebrew-sailor && git add . && git commit -m "Update dependency versions" && git push