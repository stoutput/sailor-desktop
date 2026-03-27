import React, { useEffect, useState } from 'react';
import { FiCheck, FiX, FiAlertCircle, FiLoader, FiAlertTriangle, FiTrash2, FiDownload, FiWifiOff } from 'react-icons/fi';
import { DependencyCheckResult, DependencyStatus, InstallProgress, UninstallResult } from '@common/types';
import AnchorIcon from './anchoricon';
import './setupwizard.scss';

interface SetupWizardProps {
    onComplete: () => void;
}

type WizardStep = 'checking' | 'no-internet' | 'conflicts' | 'install' | 'installing' | 'complete';

interface ConflictState {
    dockerDesktop: UninstallResult | null;
    nonHomebrewColima: UninstallResult | null;
    nonHomebrewDocker: UninstallResult | null;
}

const SetupWizard: React.FC<SetupWizardProps> = ({ onComplete }) => {
    const [step, setStep] = useState<WizardStep>('checking');
    const [checkResult, setCheckResult] = useState<DependencyCheckResult | null>(null);
    const [installProgress, setInstallProgress] = useState<Record<string, InstallProgress>>({});
    const [error, setError] = useState<string | null>(null);
    const [uninstalling, setUninstalling] = useState<string | null>(null);
    const [conflictResults, setConflictResults] = useState<ConflictState>({
        dockerDesktop: null,
        nonHomebrewColima: null,
        nonHomebrewDocker: null
    });
    const [selectedVersions, setSelectedVersions] = useState<Record<string, 'recommended' | 'latest'>>({
        colima: 'recommended',
        docker: 'recommended'
    });

    useEffect(() => {
        checkDependencies();

        const cleanup = window.api.onInstallProgress((_, progress) => {
            setInstallProgress(prev => ({
                ...prev,
                [progress.dependency]: progress
            }));
        });

        return cleanup;
    }, []);

    // Auto-retry when internet comes back while on no-internet step
    useEffect(() => {
        if (step !== 'no-internet') return;

        const handleOnline = async () => {
            const hasInternet = await checkInternetConnection();
            if (hasInternet) {
                setStep('install');
            }
        };

        window.addEventListener('online', handleOnline);
        return () => window.removeEventListener('online', handleOnline);
    }, [step]);

    // Poll for conflict changes while on conflicts step (in case user resolves manually)
    useEffect(() => {
        if (step !== 'conflicts') return;

        const pollInterval = setInterval(async () => {
            // Only poll if not currently uninstalling
            if (uninstalling) return;

            try {
                const result = await window.api.checkDependencies();
                const prevResult = checkResult;
                setCheckResult(result);

                // Update conflict results state based on what's actually resolved
                if (prevResult) {
                    setConflictResults(prev => ({
                        dockerDesktop: !result.conflicts.dockerDesktop.installed && prevResult.conflicts.dockerDesktop.installed
                            ? { success: true, message: 'Resolved' }
                            : prev.dockerDesktop,
                        nonHomebrewColima: !result.conflicts.nonHomebrewColima.installed && prevResult.conflicts.nonHomebrewColima.installed
                            ? { success: true, message: 'Resolved' }
                            : prev.nonHomebrewColima,
                        nonHomebrewDocker: !result.conflicts.nonHomebrewDocker.installed && prevResult.conflicts.nonHomebrewDocker.installed
                            ? { success: true, message: 'Resolved' }
                            : prev.nonHomebrewDocker,
                    }));
                }

                // If all conflicts resolved, auto-advance
                if (!result.conflicts.hasConflicts) {
                    if (result.allMet) {
                        await window.api.completeSetup();
                        onComplete();
                    } else {
                        setStep('install');
                    }
                }
            } catch {
                // Ignore polling errors
            }
        }, 2000);

        return () => clearInterval(pollInterval);
    }, [step, uninstalling, onComplete, checkResult]);

    const checkInternetConnection = async (): Promise<boolean> => {
        // Quick check first
        if (!navigator.onLine) {
            return false;
        }
        // Use main process to check actual connectivity (avoids CSP issues)
        return window.api.checkInternetConnection();
    };

    const checkDependencies = async () => {
        setStep('checking');
        setError(null);
        try {
            const result = await window.api.checkDependencies();
            setCheckResult(result);

            if (result.conflicts.hasConflicts) {
                setStep('conflicts');
            } else if (result.allMet) {
                await window.api.completeSetup();
                onComplete();
            } else {
                // Check internet before showing install step
                const hasInternet = await checkInternetConnection();
                if (hasInternet) {
                    setStep('install');
                } else {
                    setStep('no-internet');
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to check dependencies');
        }
    };

    const handleUninstallDockerDesktop = async () => {
        setUninstalling('dockerDesktop');
        setError(null);
        try {
            const result = await window.api.uninstallDockerDesktop();
            setConflictResults(prev => ({ ...prev, dockerDesktop: result }));
            if (!result.success) {
                setError(result.message);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Uninstallation failed');
        } finally {
            setUninstalling(null);
        }
    };

    const handleRemoveNonHomebrewColima = async () => {
        if (!checkResult?.conflicts.nonHomebrewColima.path) return;

        setUninstalling('colima');
        setError(null);
        try {
            const result = await window.api.removeNonHomebrewBinary(
                checkResult.conflicts.nonHomebrewColima.path,
                'Colima'
            );
            setConflictResults(prev => ({ ...prev, nonHomebrewColima: result }));
            if (!result.success) {
                setError(result.message);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Removal failed');
        } finally {
            setUninstalling(null);
        }
    };

    const handleRemoveNonHomebrewDocker = async () => {
        if (!checkResult?.conflicts.nonHomebrewDocker.path) return;

        setUninstalling('docker');
        setError(null);
        try {
            const result = await window.api.removeNonHomebrewBinary(
                checkResult.conflicts.nonHomebrewDocker.path,
                'Docker CLI'
            );
            setConflictResults(prev => ({ ...prev, nonHomebrewDocker: result }));
            if (!result.success) {
                setError(result.message);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Removal failed');
        } finally {
            setUninstalling(null);
        }
    };

    const allConflictsResolved = (): boolean => {
        if (!checkResult) return false;
        const { conflicts } = checkResult;

        const dockerDesktopOk = !conflicts.dockerDesktop.installed || conflictResults.dockerDesktop?.success;
        const colimaOk = !conflicts.nonHomebrewColima.installed || conflictResults.nonHomebrewColima?.success;
        const dockerOk = !conflicts.nonHomebrewDocker.installed || conflictResults.nonHomebrewDocker?.success;

        return dockerDesktopOk && colimaOk && dockerOk;
    };

    const handleInstall = async () => {
        if (!checkResult) return;

        // Verify internet connection before starting
        const hasInternet = await checkInternetConnection();
        if (!hasInternet) {
            setStep('no-internet');
            return;
        }

        setStep('installing');
        setError(null);
        setInstallProgress({});

        try {
            const { dependencies } = checkResult;

            // Install in order: homebrew first, then colima, then docker
            if (!dependencies.homebrew.installed) {
                await window.api.installDependency('homebrew');
            }
            if (!dependencies.colima.installed || !dependencies.colima.meetsMinimum) {
                await window.api.installDependency('colima', selectedVersions.colima);
            }
            if (!dependencies.docker.installed || !dependencies.docker.meetsMinimum) {
                await window.api.installDependency('docker', selectedVersions.docker);
            }

            setStep('complete');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Installation failed');
        }
    };

    const handleComplete = async () => {
        await window.api.completeSetup();
        onComplete();
    };

    const handleRetry = () => {
        setInstallProgress({});
        setError(null);
        checkDependencies();
    };

    const getStatusIcon = (dep: DependencyStatus, depName: string) => {
        const progress = installProgress[depName];

        if (progress?.phase === 'error') return <FiX />;
        if (progress?.phase === 'installing') return <FiLoader className="spinner" />;
        if (progress?.phase === 'complete' || (dep.installed && dep.meetsMinimum)) return <FiCheck />;
        return <FiDownload />;
    };

    const getStatusClass = (dep: DependencyStatus, depName: string) => {
        const progress = installProgress[depName];

        if (progress?.phase === 'error') return 'error';
        if (progress?.phase === 'installing') return 'installing';
        if (progress?.phase === 'complete' || (dep.installed && dep.meetsMinimum)) return 'installed';
        return 'missing';
    };

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
                    <li>Homebrew package manager (~20MB)</li>
                    <li>Colima container runtime (~50MB)</li>
                    <li>Docker CLI tools (~60MB)</li>
                </ul>
            </div>
        </div>
    );

    const renderConflictItem = (
        key: string,
        name: string,
        description: string,
        path: string,
        result: UninstallResult | null,
        onRemove: () => void,
        canAutoRemove = true
    ) => (
        <div key={key} className={`conflict-item ${result?.success ? 'removed' : ''}`}>
            <div className={`status-icon ${result?.success ? 'removed' : uninstalling === key ? 'removing' : 'conflict'}`}>
                {result?.success ? <FiCheck /> : uninstalling === key ? <FiLoader className="spinner" /> : <FiAlertCircle />}
            </div>
            <div className="conflict-info">
                <div className="conflict-name">{name}</div>
                <div className="conflict-description">{description}</div>
                <div className="conflict-path">{path}</div>
                {result && !result.success && (
                    <div className="conflict-error">{result.message}</div>
                )}
            </div>
            <div className="conflict-action">
                {result?.success ? (
                    <span className="removed-label">Removed</span>
                ) : canAutoRemove ? (
                    <button
                        className="uninstall-button"
                        onClick={onRemove}
                        disabled={uninstalling !== null}
                    >
                        {uninstalling === key ? <FiLoader className="spinner" /> : <FiTrash2 />}
                        {uninstalling === key ? 'Removing...' : 'Remove'}
                    </button>
                ) : (
                    <span className="manual-remove">Manual removal required</span>
                )}
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
                        The following software conflicts with Sailor and should be removed before continuing.
                        <strong> Sailor manages dependencies via Homebrew for consistency and easy updates.</strong>
                    </div>
                </div>

                <div className="conflict-list">
                    {hasDockerDesktop && renderConflictItem(
                        'dockerDesktop',
                        'Docker Desktop',
                        'Docker Desktop application',
                        '/Applications/Docker.app',
                        conflictResults.dockerDesktop,
                        handleUninstallDockerDesktop
                    )}
                    {hasNonBrewColima && renderConflictItem(
                        'colima',
                        'Colima (Non-Homebrew)',
                        'Colima installed outside of Homebrew',
                        conflicts.nonHomebrewColima.path || 'Unknown path',
                        conflictResults.nonHomebrewColima,
                        handleRemoveNonHomebrewColima,
                        conflicts.nonHomebrewColima.canAutoRemove
                    )}
                    {hasNonBrewDocker && renderConflictItem(
                        'docker',
                        'Docker CLI (Non-Homebrew)',
                        'Docker CLI installed outside of Homebrew',
                        conflicts.nonHomebrewDocker.path || 'Unknown path',
                        conflictResults.nonHomebrewDocker,
                        handleRemoveNonHomebrewDocker,
                        conflicts.nonHomebrewDocker.canAutoRemove
                    )}
                </div>

                {error && (
                    <div className="info-box warning" style={{ marginTop: '16px' }}>
                        <div className="info-title">
                            <FiAlertCircle className="icon" />
                            Error
                        </div>
                        <div className="info-text">{error}</div>
                    </div>
                )}

                <div className="step-notes">
                    <h4>Why remove these?</h4>
                    <ul>
                        {hasDockerDesktop && (
                            <li>Docker Desktop conflicts with Colima and uses a different VM system</li>
                        )}
                        {(hasNonBrewColima || hasNonBrewDocker) && (
                            <li>Non-Homebrew installations can cause version conflicts and update issues</li>
                        )}
                        <li>After removal, Sailor will install the correct versions via Homebrew</li>
                    </ul>
                </div>
            </div>
        );
    };

    const renderInstallStep = () => {
        if (!checkResult) return null;

        const { dependencies } = checkResult;
        const toInstall = [];

        if (!dependencies.homebrew.installed) {
            toInstall.push({ name: 'Homebrew', description: 'Package manager for macOS', command: 'brew', key: 'homebrew' });
        }
        if (!dependencies.colima.installed || !dependencies.colima.meetsMinimum) {
            toInstall.push({ name: 'Colima', description: 'Container runtime for macOS (includes Lima)', command: 'colima', key: 'colima' });
        }
        if (!dependencies.docker.installed || !dependencies.docker.meetsMinimum) {
            toInstall.push({ name: 'Docker CLI', description: 'Command-line interface for Docker', command: 'docker', key: 'docker' });
        }

        return (
            <div className="setup-content">
                <div className="info-box">
                    <div className="info-title">
                        <FiDownload className="icon" />
                        Install Dependencies
                    </div>
                    <div className="info-text">
                        The following components will be installed via Homebrew.
                    </div>
                </div>

                <div className="dependency-list">
                    {toInstall.map(item => {
                        const dep = dependencies[item.key as keyof typeof dependencies];
                        // Only show version select if latest differs from recommended
                        const showVersionSelect = (item.key === 'colima' || item.key === 'docker') &&
                            dep.latestVersion && dep.latestVersion !== dep.recommendedVersion;
                        return (
                            <div key={item.key} className="dependency-item">
                                <div className={`status-icon ${getStatusClass(dep, item.key)}`}>
                                    {getStatusIcon(dep, item.key)}
                                </div>
                                <div className="dep-info">
                                    <div className="dep-name">{item.name}</div>
                                    <div className="dep-description">{item.description}</div>
                                    <div className="dep-command">Also adds the <code>{item.command}</code> command to your terminal</div>
                                    {dep.version && (
                                        <div className="dep-version">
                                            Current: <span className={dep.meetsMinimum ? 'current' : 'outdated'}>{dep.version}</span>
                                            {!dep.meetsMinimum && <> (minimum: {dep.minimumVersion})</>}
                                        </div>
                                    )}
                                </div>
                                {showVersionSelect && (
                                    <div className="dep-action">
                                        <div className="version-select">
                                            <select
                                                value={selectedVersions[item.key] || 'recommended'}
                                                onChange={(e) => setSelectedVersions(prev => ({
                                                    ...prev,
                                                    [item.key]: e.target.value as 'recommended' | 'latest'
                                                }))}
                                            >
                                                <option value="recommended">Recommended ({dep.recommendedVersion})</option>
                                                <option value="latest">Latest ({dep.latestVersion})</option>
                                            </select>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

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

            {error && (
                <div className="info-box warning" style={{ marginTop: '16px' }}>
                    <div className="info-title">
                        <FiAlertCircle className="icon" />
                        Installation Error
                    </div>
                    <div className="info-text">{error}</div>
                </div>
            )}
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
            case 'installing': return renderInstallingStep();
            case 'complete': return renderCompleteStep();
        }
    };

    const handleRetryInternet = async () => {
        setStep('checking');
        const hasInternet = await checkInternetConnection();
        if (hasInternet) {
            setStep('install');
        } else {
            setStep('no-internet');
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
                            <button
                                className="primary"
                                onClick={checkDependencies}
                                disabled={uninstalling !== null || !allConflictsResolved()}
                            >
                                {allConflictsResolved() ? 'Continue' : 'Resolve conflicts to continue'}
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
                            <button className="primary" onClick={handleComplete}>
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
            case 'installing': return 'Installing dependencies...';
            case 'complete': return 'Ready to sail!';
        }
    };

    // During checking step, show full-screen bouncing anchor (same as app startup)
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
