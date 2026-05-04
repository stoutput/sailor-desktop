# Sailor Desktop
[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/Y8Y81X7LER)

***Full-Rigged Container Management UI & Tooling for MacOS & Linux***

Aiming to be a full-featured, open-source, free alternative to Docker Desktop.

## Installation
Add the [Sailor homebrew tap](https://github.com/stoutput/homebrew-sailor) & install the Sailor cask:
```sh
brew tap stoutput/sailor && brew install --cask sailor
```
Once that completes, open the Sailor app and hoist ye sails!

To update, run:
```sh
brew update && brew upgrade sailor
```

## Features

**Container dashboard, grouped by compose project:**
<img width="803" height="602" alt="Screenshot 2026-05-04 at 4 48 24 PM" src="https://github.com/user-attachments/assets/99f6b05d-6b05-482d-b366-02534957d240" />

**Container info & control:**
<img width="820" height="596" alt="Screenshot 2026-05-04 at 4 51 27 PM" src="https://github.com/user-attachments/assets/7d0eb6a3-6759-4849-88a5-550ca1ee251e" />

**Network topology view:**
<img width="820" height="597" alt="Screenshot 2026-05-04 at 4 52 10 PM" src="https://github.com/user-attachments/assets/c6d3a96f-15c1-4439-a99e-2a8c840e17e1" />

**Interactive in-container terminal:**
<img width="822" height="594" alt="Screenshot 2026-05-04 at 4 52 59 PM" src="https://github.com/user-attachments/assets/fafb9e72-6f4a-4fa7-ab6f-8a4514ea0883" />

**Stats monitoring:**
<img width="818" height="905" alt="Screenshot 2026-05-04 at 4 54 51 PM" src="https://github.com/user-attachments/assets/fd9a88e1-0a64-4120-9fc0-43de40b10af9" />

...and more!

## Local Development
Ensure [asdf](https://asdf-vm.com/guide/getting-started.html) is installed, then execute `make run` to bootstrap your environment and run the app with debugging.

PRs are welcome and encouraged! Fork this repo, checkout a new branch, then open a PR with your changes from your fork into this one.
However, please do not distribute your own fork of this app.
