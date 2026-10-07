import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiCheck, FiX, FiAlertCircle, FiLoader, FiAlertTriangle, FiDownload, FiWifiOff, FiCopy, FiTerminal } from 'react-icons/fi';
import { DependencyCheckResult, DependencyStatus, DependencyName, DockerPluginKey, InstallProgress } from '@common/types';
import { DOCKER_PLUGINS } from '@common/versions';
import AnchorIcon from './anchoricon';
import './setupwizard.scss';

interface SetupWizardProps {
    onComplete: () => void;
}

type WizardStep = 'checking' | 'no-internet' | 'conflicts' | 'install' | 'awaiting-homebrew' | 'installing' | 'complete';

// A dependency needs installing if it's absent from PATH or too old to support
const needsInstall = (dep: DependencyStatus) => !dep.installed || !dep.meetsMinimum;

// "colima" / "colima and lima" / "a, b and c"
const renderCommandList = (commands: string[]) => commands.map((cmd, i) => (
    <React.Fragment key={cmd}>
        {i > 0 && (i === commands.length - 1 ? ' and ' : ', ')}
        <code>{cmd}</code>
    </React.Fragment>
));

const SetupWizard: React.FC<SetupWizardProps> = ({ onComplete }) => {
    const [step, setStep] = useState<WizardStep>('checking');
    const [checkResult, setCheckResult] = useState<DependencyCheckResult | null>(null);
    const [installProgress, setInstallProgress] = useState<Record<string, InstallProgress>>({});
    const [error, setError] = useState<string | null>(null);
    const [brewCommand, setBrewCommand] = useState('');
    const [scriptPath, setScriptPath] = useState('');
    const [copied, setCopied] = useState(false);
    // Which optional plugins to install; seeded from DOCKER_PLUGINS once the
    // dependency check tells us which are already present
    const [selectedPlugins, setSelectedPlugins] = useState<Set<DockerPluginKey>>(new Set());

    // Kept in refs so runInstalls stays stable — the Homebrew poll calls it, and
    // re-creating it on every selection change would re-subscribe the poll
    const checkResultRef = useRef<DependencyCheckResult | null>(null);
    checkResultRef.current = checkResult;
    const selectedPluginsRef = useRef<Set<DockerPluginKey>>(selectedPlugins);
    selectedPluginsRef.current = selectedPlugins;

    const checkInternetConnection = async (): Promise<boolean> => {
        // navigator.onLine only tells us about the interface; the main process
        // does the real reachability check (renderer CSP blocks it here)
        if (!navigator.onLine) return false;
        return window.api.checkInternetConnection();
    };

    const finishSetup = useCallback(async () => {
        await window.api.completeSetup();
        onComplete();
    }, [onComplete]);

    const goToInstall = useCallback(async () => {
        const hasInternet = await checkInternetConnection();
        setStep(hasInternet ? 'install' : 'no-internet');
    }, []);

    const runCheck = useCallback(async () => {
        setStep('checking');
        setError(null);
        try {
            const result = await window.api.checkDependencies();
            setCheckResult(result);

            // Pre-select the recommended plugins that aren't already installed
            setSelectedPlugins(new Set(
                DOCKER_PLUGINS
                    .filter(p => p.defaultSelected && needsInstall(result.dependencies[p.key]))
                    .map(p => p.key)
            ));

            const { colima, docker } = result.dependencies;
            if (!needsInstall(colima) && !needsInstall(docker)) {
                await finishSetup();
                return;
            }

            if (result.conflicts.hasConflicts) {
                setStep('conflicts');
                return;
            }

            await goToInstall();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to check dependencies');
            setStep('install');
        }
    }, [finishSetup, goToInstall]);

    useEffect(() => {
        runCheck();
        window.api.getHomebrewInstallCommand().then(setBrewCommand);

        return window.api.onInstallProgress((_, progress) => {
            setInstallProgress(prev => ({ ...prev, [progress.dependency]: progress }));
        });
    }, [runCheck]);

    // Retry automatically once the network comes back
    useEffect(() => {
        if (step !== 'no-internet') return;

        const handleOnline = async () => {
            if (await checkInternetConnection()) setStep('install');
        };

        window.addEventListener('online', handleOnline);
        return () => window.removeEventListener('online', handleOnline);
    }, [step]);

    const runInstalls = useCallback(async () => {
        const result = checkResultRef.current;
        if (!result) return;

        setStep('installing');
        setError(null);
        setInstallProgress({});

        try {
            const deps = result.dependencies;
            if (needsInstall(deps.colima)) {
                await window.api.installDependency('colima');
            }
            if (needsInstall(deps.docker)) {
                await window.api.installDependency('docker');
            }
            // Plugins come last: they're separate formulae from the docker CLI,
            // and installing them before it would leave nothing to plug into
            for (const plugin of DOCKER_PLUGINS) {
                if (selectedPluginsRef.current.has(plugin.key) && needsInstall(deps[plugin.key])) {
                    await window.api.installDependency(plugin.key);
                }
            }
            setStep('complete');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Installation failed');
        }
    }, []);

    // The Homebrew installer runs in Terminal, so poll until brew shows up
    useEffect(() => {
        if (step !== 'awaiting-homebrew') return;

        let cancelled = false;
        const poll = setInterval(async () => {
            try {
                if (await window.api.isHomebrewInstalled()) {
                    if (cancelled) return;
                    clearInterval(poll);
                    runInstalls();
                }
            } catch {
                // Ignore polling errors
            }
        }, 2000);

        return () => {
            cancelled = true;
            clearInterval(poll);
        };
    }, [step, runInstalls]);

    const handleInstall = async () => {
        if (!checkResult) return;

        // Everything below downloads from the internet
        if (!(await checkInternetConnection())) {
            setStep('no-internet');
            return;
        }

        setError(null);

        // Homebrew installs the rest, so it has to come first. Its installer is
        // interactive (confirmation + sudo password), so it runs in Terminal.
        if (!checkResult.dependencies.homebrew.installed) {
            try {
                setScriptPath(await window.api.openHomebrewInstaller());
                setStep('awaiting-homebrew');
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to open Terminal');
            }
            return;
        }

        runInstalls();
    };

    const handleRetry = () => {
        setInstallProgress({});
        setError(null);
        runCheck();
    };

    const handleRetryInternet = async () => {
        setStep('checking');
        const hasInternet = await checkInternetConnection();
        setStep(hasInternet ? 'install' : 'no-internet');
    };

    const handleCopyCommand = async () => {
        await navigator.clipboard.writeText(brewCommand);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const getStatusIcon = (dep: DependencyStatus, depName: string) => {
        const progress = installProgress[depName];

        if (progress?.phase === 'error') return <FiX />;
        if (progress?.phase === 'installing') return <FiLoader className="spinner" />;
        if (progress?.phase === 'complete' || !needsInstall(dep)) return <FiCheck />;
        return <FiDownload />;
    };

    const getStatusClass = (dep: DependencyStatus, depName: string) => {
        const progress = installProgress[depName];

        if (progress?.phase === 'error') return 'error';
        if (progress?.phase === 'installing') return 'installing';
        if (progress?.phase === 'complete' || !needsInstall(dep)) return 'installed';
        return dep.installed ? 'outdated' : 'missing';
    };

    const renderErrorBox = (title: string) => error && (
        <div className="info-box warning" style={{ marginTop: '16px' }}>
            <div className="info-title">
                <FiAlertCircle className="icon" />
                {title}
            </div>
            <div className="info-text">{error}</div>
        </div>
    );

    const renderCheckingStep = () => (
        <div className="setup-content checking-content">
            <AnchorIcon className="bouncing" size={64} />
        </div>
    );

    const renderNoInternetStep = () => (
        <div className="setup-content">
            <div className="info-box warning">
                <div className="info-title">
                    <FiWifiOff className="icon" />
                    Internet Connection Required
                </div>
                <div className="info-text">
                    Sailor needs to download dependencies from the internet to complete setup.
                    Please check your network connection and try again.
                </div>
            </div>

            <div className="step-notes">
                <h4>What will be downloaded?</h4>
                <ul>
                    <li>Homebrew package manager (if not already installed)</li>
                    <li>Colima container runtime (~50MB)</li>
                    <li>Docker CLI tools (~60MB)</li>
                </ul>
            </div>
        </div>
    );

    const renderConflictItem = (key: string, name: string, description: string, path: string) => (
        <div key={key} className="conflict-item">
            <div className="status-icon conflict">
                <FiAlertCircle />
            </div>
            <div className="conflict-info">
                <div className="conflict-name">{name}</div>
                <div className="conflict-description">{description}</div>
                <div className="conflict-path">{path}</div>
            </div>
        </div>
    );

    const renderConflictsStep = () => {
        if (!checkResult) return null;
        const { conflicts } = checkResult;

        const hasDockerDesktop = conflicts.dockerDesktop.installed;
        const hasNonBrewColima = conflicts.nonHomebrewColima.installed;
        const hasNonBrewDocker = conflicts.nonHomebrewDocker.installed;

        return (
            <div className="setup-content">
                <div className="info-box warning">
                    <div className="info-title">
                        <FiAlertTriangle className="icon" />
                        Conflicting Software Detected
                    </div>
                    <div className="info-text">
                        Sailor found container tooling it doesn&apos;t manage. Setup can continue, but
                        removing these first avoids version and PATH conflicts.
                        <strong> Sailor manages its dependencies via Homebrew for consistency and easy updates.</strong>
                    </div>
                </div>

                <div className="conflict-list">
                    {hasDockerDesktop && renderConflictItem(
                        'dockerDesktop',
                        'Docker Desktop',
                        'Uses its own VM and bundles a Docker CLI that can shadow Homebrew\'s',
                        '/Applications/Docker.app'
                    )}
                    {hasNonBrewColima && renderConflictItem(
                        'colima',
                        'Colima (Non-Homebrew)',
                        'Colima installed outside of Homebrew — Sailor can\'t manage its version',
                        conflicts.nonHomebrewColima.path || 'Unknown path'
                    )}
                    {hasNonBrewDocker && renderConflictItem(
                        'docker',
                        'Docker CLI (Non-Homebrew)',
                        'Docker CLI installed outside of Homebrew — Sailor can\'t manage its version',
                        conflicts.nonHomebrewDocker.path || 'Unknown path'
                    )}
                </div>

                <div className="step-notes">
                    <h4>How to remove them</h4>
                    <ul>
                        {hasDockerDesktop && (
                            <li>Quit Docker Desktop, then drag <code>Docker.app</code> to the Trash</li>
                        )}
                        {(hasNonBrewColima || hasNonBrewDocker) && (
                            <li>Delete the binaries listed above, e.g. <code>rm {conflicts.nonHomebrewColima.path || conflicts.nonHomebrewDocker.path}</code></li>
                        )}
                        <li>Then choose Continue — Sailor will install its own copies via Homebrew</li>
                    </ul>
                </div>
            </div>
        );
    };

    const renderInstallStep = () => {
        if (!checkResult) return null;

        const { dependencies } = checkResult;
        const toInstall: { name: string; description: string; commands: string[]; key: DependencyName }[] = [];

        if (!dependencies.homebrew.installed) {
            toInstall.push({ name: 'Homebrew', description: 'Package manager for macOS — installs the components below', commands: ['brew'], key: 'homebrew' });
        }
        if (needsInstall(dependencies.colima)) {
            // Colima's formula pulls in Lima, which is what runs the VM
            toInstall.push({ name: 'Colima', description: 'Container runtime for macOS (includes Lima)', commands: ['colima', 'lima'], key: 'colima' });
        }
        if (needsInstall(dependencies.docker)) {
            toInstall.push({ name: 'Docker CLI', description: 'Command-line interface for Docker', commands: ['docker'], key: 'docker' });
        }

        return (
            <div className="setup-content">
                <div className="info-box">
                    <div className="info-title">
                        <FiDownload className="icon" />
                        Install Dependencies
                    </div>
                    <div className="info-text">
                        Sailor needs Colima and the Docker CLI. The following components will be
                        installed via Homebrew.
                    </div>
                </div>

                <div className="dependency-list">
                    {toInstall.map(item => {
                        const dep = dependencies[item.key];
                        return (
                            <div key={item.key} className="dependency-item">
                                <div className={`status-icon ${getStatusClass(dep, item.key)}`}>
                                    {getStatusIcon(dep, item.key)}
                                </div>
                                <div className="dep-info">
                                    <div className="dep-name">{item.name}</div>
                                    <div className="dep-description">{item.description}</div>
                                    <div className="dep-command">
                                        Adds the {renderCommandList(item.commands)}
                                        {item.commands.length > 1 ? ' commands' : ' command'} to your terminal
                                    </div>
                                    {dep.version && (
                                        <div className="dep-version">
                                            Current: <span className={dep.meetsMinimum ? 'current' : 'outdated'}>{dep.version}</span>
                                            {!dep.meetsMinimum && <> (minimum: {dep.minimumVersion})</>}
                                        </div>
                                    )}
                                </div>
                                {dep.latestVersion && (
                                    <div className="dep-action">
                                        <span className="dep-target-version">{dep.latestVersion}</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {renderPluginSelector()}
                {renderErrorBox('Error')}
            </div>
        );
    };

    const togglePlugin = (key: DockerPluginKey) => {
        setSelectedPlugins(prev => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    };

    const renderPluginSelector = () => {
        if (!checkResult) return null;
        const { dependencies } = checkResult;

        return (
            <div className="plugin-selector">
                <div className="plugin-header">
                    <h4>Docker CLI plugins</h4>
                    <p>
                        Optional add-ons that extend the <code>docker</code> command. Recommended
                        ones are pre-selected — you can add or remove any of them later in Settings.
                    </p>
                </div>

                {DOCKER_PLUGINS.map(plugin => {
                    const dep = dependencies[plugin.key];
                    const alreadyInstalled = !needsInstall(dep);
                    const checked = alreadyInstalled || selectedPlugins.has(plugin.key);

                    return (
                        <label
                            key={plugin.key}
                            className={`plugin-option ${alreadyInstalled ? 'installed' : ''}`}
                        >
                            <input
                                type="checkbox"
                                checked={checked}
                                disabled={alreadyInstalled}
                                onChange={() => togglePlugin(plugin.key)}
                            />
                            <div className="plugin-info">
                                <div className="plugin-name">
                                    {plugin.displayName}
                                    <code>docker {plugin.subcommand}</code>
                                </div>
                                <div className="plugin-description">{plugin.description}</div>
                            </div>
                            <div className="plugin-status">
                                {alreadyInstalled ? (
                                    <span className="plugin-installed-label">
                                        <FiCheck /> {dep.version || 'Installed'}
                                    </span>
                                ) : dep.latestVersion ? (
                                    <span className="dep-target-version">{dep.latestVersion}</span>
                                ) : null}
                            </div>
                        </label>
                    );
                })}
            </div>
        );
    };

    const renderAwaitingHomebrewStep = () => (
        <div className="setup-content">
            <div className="info-box">
                <div className="info-title">
                    <FiTerminal className="icon" />
                    Finish Installing Homebrew
                </div>
                <div className="info-text">
                    Homebrew&apos;s installer needs a terminal — it asks for confirmation and your
                    password, and it refuses to run as root. Sailor opened it in Terminal so the
                    installer prompts you directly; Sailor never handles your password. Follow the
                    prompts there, then come back — setup continues automatically.
                </div>
            </div>

            <div className="command-box">
                <code>{brewCommand}</code>
                <button className="copy-button" onClick={handleCopyCommand}>
                    {copied ? <FiCheck /> : <FiCopy />}
                    {copied ? 'Copied' : 'Copy'}
                </button>
            </div>

            {scriptPath && (
                <p className="script-path">
                    Running from <code>{scriptPath}</code> — inspect it any time.
                </p>
            )}

            <div className="checking-content">
                <FiLoader className="spinner" size={24} />
                <p className="checking-message">Waiting for Homebrew...</p>
            </div>

            {renderErrorBox('Error')}
        </div>
    );

    const renderInstallingStep = () => (
        <div className="setup-content">
            <div className="info-box">
                <div className="info-title">
                    <FiLoader className="icon spinner" />
                    Installing Dependencies
                </div>
                <div className="info-text">
                    Installing components via Homebrew. This may take a few minutes...
                </div>
            </div>

            <div className="dependency-list">
                {Object.entries(installProgress).map(([key, progress]) => (
                    <div key={key} className="dependency-item">
                        <div className={`status-icon ${progress.phase === 'complete' ? 'installed' : progress.phase === 'error' ? 'error' : 'installing'}`}>
                            {progress.phase === 'complete' ? <FiCheck /> : progress.phase === 'error' ? <FiX /> : <FiLoader className="spinner" />}
                        </div>
                        <div className="dep-info">
                            <div className="dep-name">{progress.dependency}</div>
                            <div className="dep-description">{progress.message}</div>
                            {progress.error && (
                                <div className="dep-version" style={{ color: '#f44336' }}>{progress.error}</div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {renderErrorBox('Installation Error')}
        </div>
    );

    const renderCompleteStep = () => (
        <div className="setup-content">
            <div className="info-box">
                <div className="info-title">
                    <FiCheck className="icon" style={{ color: '#4caf50' }} />
                    Setup Complete
                </div>
                <div className="info-text">
                    All dependencies have been installed successfully. Sailor is ready to use!
                </div>
            </div>

            <div className="step-notes">
                <h4>Available terminal commands:</h4>
                <ul>
                    <li><code>colima start</code> - Start the container runtime</li>
                    <li><code>docker ps</code> - List running containers</li>
                    <li><code>docker build</code> - Build images</li>
                    <li><code>docker compose up</code> - Start compose projects</li>
                </ul>
            </div>
        </div>
    );

    const renderContent = () => {
        switch (step) {
            case 'checking': return renderCheckingStep();
            case 'no-internet': return renderNoInternetStep();
            case 'conflicts': return renderConflictsStep();
            case 'install': return renderInstallStep();
            case 'awaiting-homebrew': return renderAwaitingHomebrewStep();
            case 'installing': return renderInstallingStep();
            case 'complete': return renderCompleteStep();
        }
    };

    const renderFooter = () => {
        switch (step) {
            case 'checking':
                return null;
            case 'no-internet':
                return (
                    <div className="setup-footer">
                        <span></span>
                        <div className="action-buttons">
                            <button className="primary" onClick={handleRetryInternet}>
                                Retry Connection
                            </button>
                        </div>
                    </div>
                );
            case 'conflicts':
                return (
                    <div className="setup-footer">
                        <span></span>
                        <div className="action-buttons">
                            <button className="secondary" onClick={runCheck}>
                                Re-check
                            </button>
                            <button className="primary" onClick={goToInstall}>
                                Continue
                            </button>
                        </div>
                    </div>
                );
            case 'install':
                return (
                    <div className="setup-footer">
                        <span></span>
                        <div className="action-buttons">
                            <button className="primary" onClick={handleInstall}>
                                Install
                            </button>
                        </div>
                    </div>
                );
            case 'awaiting-homebrew':
                return (
                    <div className="setup-footer">
                        <span></span>
                        <div className="action-buttons">
                            <button className="secondary" onClick={() => setStep('install')}>
                                Back
                            </button>
                        </div>
                    </div>
                );
            case 'installing':
                return (
                    <div className="setup-footer">
                        <span></span>
                        <div className="action-buttons">
                            {error && (
                                <button className="secondary" onClick={handleRetry}>
                                    Retry
                                </button>
                            )}
                        </div>
                    </div>
                );
            case 'complete':
                return (
                    <div className="setup-footer">
                        <span></span>
                        <div className="action-buttons">
                            <button className="primary" onClick={finishSetup}>
                                Get Started
                            </button>
                        </div>
                    </div>
                );
        }
    };

    const getSubtitle = () => {
        switch (step) {
            case 'checking': return 'Checking system requirements...';
            case 'no-internet': return 'No internet connection';
            case 'conflicts': return 'Conflicting software detected';
            case 'install': return 'Ready to install dependencies';
            case 'awaiting-homebrew': return 'Waiting for Homebrew...';
            case 'installing': return 'Installing dependencies...';
            case 'complete': return 'Ready to sail!';
        }
    };

    // During checking, show the full-screen bouncing anchor (same as app startup)
    if (step === 'checking') {
        return (
            <div id="setup-wizard" className="checking-screen">
                {renderCheckingStep()}
            </div>
        );
    }

    return (
        <div id="setup-wizard">
            <div className="setup-header">
                <div className="logo">
                    <AnchorIcon size={40} />
                </div>
                <h1>Welcome to Sailor</h1>
                <p className="subtitle">{getSubtitle()}</p>
            </div>

            {renderContent()}
            {renderFooter()}
        </div>
    );
};

export default SetupWizard;
