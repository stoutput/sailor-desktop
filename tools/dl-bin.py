import os
import stat

import requests


class ansi:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    NC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'

urls = {
    'abiosoft/colima': {
        'mac-arm': 'colima-Darwin-arm64',
        'mac-intel': 'colima-Darwin-x86_64',
    },
    'docker/buildx': {
        'mac-arm': 'buildx-[VERSION].darwin-arm64',
        'mac-intel': 'buildx-[VERSION].darwin-amd64',
    },
    'docker/compose': {
        'mac-arm': 'docker-compose-darwin-aarch64',
        'mac-intel': 'docker-compose-darwin-x86_64',
    }
}

versions = dict()

for owner_repo, files in urls.items():
    (owner, repo) = tuple(owner_repo.split('/'))
    ftarget = f'{owner}-{repo}' if owner == 'docker' else repo

    # Get latest repo version
    response = requests.get(f'https://api.github.com/repos/{owner_repo}/releases/latest')
    version = response.json()['tag_name']
    versions[ftarget] = version

    print(f'Downloading {ftarget} {ansi.OKBLUE}{version}{ansi.NC}...')

    for platform, fname in files.items():
        path = f'bin/{platform}'
        fpath = f'{path}/{ftarget}'
        fname = fname.replace('[VERSION]', version)

        # Create directory structure
        os.makedirs(path, exist_ok=True)

        # Download binary
        response = requests.get(f'https://github.com/{owner_repo}/releases/download/{version}/{fname}', allow_redirects=True)
        with open(fpath, 'wb') as f:
            f.write(response.content)

        # Make dl'ed bin executable
        os.chmod(fpath, os.stat(fpath).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

# Update .versions file
with open('bin/.versions', 'w') as f:
    for name, version in versions.items():
        f.write(f'{name}={version}\n')