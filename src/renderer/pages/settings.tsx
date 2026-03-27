import React, { useEffect, useState } from 'react';
import { FiAnchor, FiServer, FiBox, FiPlus, FiCheck, FiAlertCircle, FiRefreshCw, FiLoader } from 'react-icons/fi';
import { SailorSettings, ColimaInstance, DockerContext, ColimaStats, DependencyCheckResult, DependencyStatus, InstallProgress, DependencyName } from '@common/types';
import { ColimaCreateOptions } from '../../api/colima';
import './settings.scss';

const formatBytes = (gb: number): string => {
    if (gb >= 1024) {
        return (gb / 1024).toFixed(1) + ' TB';
    }
    return gb + ' GB';
};

interface CreateInstanceModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (options: ColimaCreateOptions) => Promise<void>;
    editInstance?: ColimaInstance | null;
}

const CreateInstanceModal: React.FC<CreateInstanceModalProps> = ({ isOpen, onClose, onSubmit, editInstance }) => {
    const [name, setName] = useState('');
    const [cpu, setCpu] = useState(2);
    const [memory, setMemory] = useState(4);
    const [disk, setDisk] = useState(60);
    const [runtime, setRuntime] = useState<'docker' | 'containerd'>('docker');
    const [vmType, setVmType] = useState<'qemu' | 'vz'>('qemu');
    const [arch, setArch] = useState<'x86_64' | 'aarch64' | 'host'>('host');
    const [kubernetes, setKubernetes] = useState(false);
    const [network, setNetwork] = useState(false);
    const [mountType, setMountType] = useState<'9p' | 'sshfs' | 'virtiofs'>('sshfs');
    const [sshAgent, setSshAgent] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const isEditing = !!editInstance;

    useEffect(() => {
        if (editInstance) {
            setName(editInstance.name);
            setCpu(editInstance.cpu);
            setMemory(editInstance.memory);
            setDisk(editInstance.disk);
            setRuntime(editInstance.runtime);
            setVmType(editInstance.vmType);
            setArch(editInstance.arch);
            setKubernetes(editInstance.kubernetes);
            setNetwork(editInstance.network);
        } else {
            // Reset form
            setName('');
            setCpu(2);
            setMemory(4);
            setDisk(60);
            setRuntime('docker');
            setVmType('qemu');
            setArch('host');
            setKubernetes(false);
            setNetwork(false);
            setMountType('sshfs');
            setSshAgent(false);
        }
        setError('');
    }, [editInstance, isOpen]);

    const handleSubmit = async () => {
        setSubmitting(true);
        setError('');
        try {
            await onSubmit({
                name: isEditing ? editInstance.name : (name || undefined),
                cpu,
                memory,
                disk,
                runtime,
                vmType,
                arch: isEditing ? undefined : arch,
                kubernetes: isEditing ? undefined : kubernetes,
                network: isEditing ? undefined : network,
                mountType: isEditing ? undefined : mountType,
                sshAgent: isEditing ? undefined : sshAgent
            });
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>{isEditing ? `Edit Instance: ${editInstance.name}` : 'Create New Instance'}</h3>
                    <button className="close-button" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body">
                    {!isEditing && (
                        <div className="form-group">
                            <label>Instance Name</label>
                            <input
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="default"
                            />
                            <div className="form-hint">Leave empty for default instance</div>
                        </div>
                    )}

                    <div className="form-group">
                        <label>Resources</label>
                        <div className="form-row">
                            <div className="form-col">
                                <label>CPU Cores</label>
                                <input
                                    type="number"
                                    value={cpu}
                                    onChange={e => setCpu(parseInt(e.target.value) || 1)}
                                    min={1}
                                    max={32}
                                />
                            </div>
                            <div className="form-col">
                                <label>Memory (GB)</label>
                                <input
                                    type="number"
                                    value={memory}
                                    onChange={e => setMemory(parseInt(e.target.value) || 1)}
                                    min={1}
                                    max={64}
                                />
                            </div>
                            <div className="form-col">
                                <label>Disk (GB)</label>
                                <input
                                    type="number"
                                    value={disk}
                                    onChange={e => setDisk(parseInt(e.target.value) || 10)}
                                    min={10}
                                    max={500}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="form-group">
                        <div className="form-row">
                            <div className="form-col">
                                <label>Runtime</label>
                                <select value={runtime} onChange={e => setRuntime(e.target.value as 'docker' | 'containerd')}>
                                    <option value="docker">Docker</option>
                                    <option value="containerd">containerd</option>
                                </select>
                            </div>
                            <div className="form-col">
                                <label>VM Type</label>
                                <select value={vmType} onChange={e => setVmType(e.target.value as 'qemu' | 'vz')}>
                                    <option value="qemu">QEMU</option>
                                    <option value="vz">Virtualization.framework</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {!isEditing && (
                        <>
                            <div className="form-group">
                                <div className="form-row">
                                    <div className="form-col">
                                        <label>Architecture</label>
                                        <select value={arch} onChange={e => setArch(e.target.value as 'x86_64' | 'aarch64' | 'host')}>
                                            <option value="host">Host (Auto)</option>
                                            <option value="aarch64">ARM64 (aarch64)</option>
                                            <option value="x86_64">x86_64</option>
                                        </select>
                                    </div>
                                    <div className="form-col">
                                        <label>Mount Type</label>
                                        <select value={mountType} onChange={e => setMountType(e.target.value as '9p' | 'sshfs' | 'virtiofs')}>
                                            <option value="sshfs">SSHFS</option>
                                            <option value="9p">9P</option>
                                            <option value="virtiofs">VirtioFS</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className="form-group">
                                <label>Options</label>
                                <div className="form-row">
                                    <div className="form-col">
                                        <label className="checkbox-label">
                                            <input
                                                type="checkbox"
                                                checked={kubernetes}
                                                onChange={e => setKubernetes(e.target.checked)}
                                            />
                                            Enable Kubernetes
                                        </label>
                                    </div>
                                    <div className="form-col">
                                        <label className="checkbox-label">
                                            <input
                                                type="checkbox"
                                                checked={network}
                                                onChange={e => setNetwork(e.target.checked)}
                                            />
                                            Reachable Network Address
                                        </label>
                                    </div>
                                </div>
                                <div className="form-row" style={{ marginTop: '8px' }}>
                                    <div className="form-col">
                                        <label className="checkbox-label">
                                            <input
                                                type="checkbox"
                                                checked={sshAgent}
                                                onChange={e => setSshAgent(e.target.checked)}
                                            />
                                            Forward SSH Agent
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {error && <div className="error-message">{error}</div>}
                </div>
                <div className="modal-footer">
                    <button className="cancel" onClick={onClose}>Cancel</button>
                    <button
                        className="submit"
                        onClick={handleSubmit}
                        disabled={submitting}
                    >
                        {submitting ? 'Processing...' : (isEditing ? 'Save Changes' : 'Create Instance')}
                    </button>
                </div>
            </div>
        </div>
    );
};

const Settings: React.FC = () => {
    // Sailor settings
    const [sailorSettings, setSailorSettings] = useState<SailorSettings>({
        startOnLogin: false,
        stopOnExit: false
    });

    // Colima state
    const [instances, setInstances] = useState<ColimaInstance[]>([]);
    const [activeInstance, setActiveInstance] = useState('default');
    const [colimaStats, setColimaStats] = useState<ColimaStats | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingInstance, setEditingInstance] = useState<ColimaInstance | null>(null);

    // Docker state
    const [contexts, setContexts] = useState<DockerContext[]>([]);
    const [activeContext, setActiveContext] = useState('');

    // Version state
    const [dependencyInfo, setDependencyInfo] = useState<DependencyCheckResult | null>(null);
    const [upgrading, setUpgrading] = useState<string | null>(null);
    const [upgradeProgress, setUpgradeProgress] = useState<InstallProgress | null>(null);
    const [showRestartPrompt, setShowRestartPrompt] = useState(false);
    const [selectedVersions, setSelectedVersions] = useState<Record<string, 'recommended' | 'latest'>>({
        colima: 'recommended',
        docker: 'recommended'
    });

    // Loading states
    const [loadingInstances, setLoadingInstances] = useState(true);
    const [loadingContexts, setLoadingContexts] = useState(true);
    const [loadingVersions, setLoadingVersions] = useState(true);

    // Load initial data
    useEffect(() => {
        loadSailorSettings();
        loadColimaData();
        loadDockerContexts();
        loadVersionInfo();

        // Listen for install progress
        const cleanup = window.api.onInstallProgress((_, progress) => {
            setUpgradeProgress(progress);
            if (progress.phase === 'complete') {
                setUpgrading(null);
                setShowRestartPrompt(true);
                loadVersionInfo(); // Refresh version info
            } else if (progress.phase === 'error') {
                setUpgrading(null);
            }
        });

        return cleanup;
    }, []);

    // Poll for stats
    useEffect(() => {
        const interval = setInterval(() => {
            window.api.getColimaStats().then(setColimaStats);
        }, 10000);

        window.api.getColimaStats().then(setColimaStats);
        return () => clearInterval(interval);
    }, []);

    const loadSailorSettings = async () => {
        const settings = await window.api.getSailorSettings();
        setSailorSettings(settings);
    };

    const loadColimaData = async () => {
        setLoadingInstances(true);
        try {
            const [instanceList, colimaSettings] = await Promise.all([
                window.api.getColimaInstances(),
                window.api.getColimaSettings()
            ]);
            setInstances(instanceList);
            setActiveInstance(colimaSettings.activeInstance);
        } finally {
            setLoadingInstances(false);
        }
    };

    const loadDockerContexts = async () => {
        setLoadingContexts(true);
        try {
            const [contextList, dockerSettings] = await Promise.all([
                window.api.getDockerContexts(),
                window.api.getDockerSettings()
            ]);
            setContexts(contextList);
            setActiveContext(dockerSettings.activeContext);
        } finally {
            setLoadingContexts(false);
        }
    };

    const loadVersionInfo = async () => {
        setLoadingVersions(true);
        try {
            const info = await window.api.checkDependencies();
            setDependencyInfo(info);
        } finally {
            setLoadingVersions(false);
        }
    };

    const handleUpgrade = async (name: DependencyName, version?: 'recommended' | 'latest') => {
        setUpgrading(name);
        setUpgradeProgress(null);
        try {
            await window.api.installDependency(name, version || selectedVersions[name] || 'recommended');
        } catch (err) {
            console.error('Upgrade failed:', err);
            setUpgrading(null);
        }
    };

    const renderVersionItem = (depName: DependencyName, displayName: string, dep: DependencyStatus | undefined) => {
        if (!dep) return null;

        const isUpgrading = upgrading === depName;
        const isOutdated = dep.installed && !dep.meetsMinimum;
        // Show version select if latest differs from recommended
        const showVersionSelect = dep.latestVersion && dep.latestVersion !== dep.recommendedVersion;
        // Check if installed version differs from selected target version
        const selectedVersion = selectedVersions[depName] || 'recommended';
        const targetVersion = selectedVersion === 'recommended' ? dep.recommendedVersion : dep.latestVersion;
        const canChange = dep.installed && dep.version !== targetVersion;

        return (
            <div className="setting-item version-item">
                <div className="setting-info">
                    <div className="setting-label">{displayName} Version</div>
                    <div className="setting-description">
                        {dep.installed ? (
                            <>
                                <span className={`version-current ${isOutdated ? 'outdated' : ''}`}>{dep.version}</span>
                                {isOutdated && (
                                    <span className="version-available"> (minimum: {dep.minimumVersion})</span>
                                )}
                                {!isOutdated && dep.recommendedVersion !== 'any' && (
                                    <span className="version-available"> (recommended: {dep.recommendedVersion})</span>
                                )}
                            </>
                        ) : (
                            <span className="version-missing">Not installed</span>
                        )}
                    </div>
                    {isUpgrading && upgradeProgress && (
                        <div className="upgrade-progress">
                            <span className="progress-text">{upgradeProgress.message}</span>
                        </div>
                    )}
                </div>
                <div className="setting-control version-control">
                    {isUpgrading ? (
                        <span className="upgrading-text">
                            <FiRefreshCw className="spin" /> Installing...
                        </span>
                    ) : (
                        <>
                            {showVersionSelect && (
                                <div className="version-select">
                                    <select
                                        value={selectedVersion}
                                        onChange={(e) => setSelectedVersions(prev => ({
                                            ...prev,
                                            [depName]: e.target.value as 'recommended' | 'latest'
                                        }))}
                                    >
                                        <option value="recommended">Recommended ({dep.recommendedVersion})</option>
                                        <option value="latest">Latest ({dep.latestVersion})</option>
                                    </select>
                                </div>
                            )}
                            {isOutdated ? (
                                <button
                                    className="upgrade-button recommended"
                                    onClick={() => handleUpgrade(depName)}
                                >
                                    <FiAlertCircle /> Upgrade
                                </button>
                            ) : canChange ? (
                                <button
                                    className="upgrade-button"
                                    onClick={() => handleUpgrade(depName)}
                                >
                                    Change Version
                                </button>
                            ) : dep.installed ? (
                                <span className="up-to-date">
                                    <FiCheck /> Up to date
                                </span>
                            ) : null}
                        </>
                    )}
                </div>
            </div>
        );
    };

    const handleSailorSettingChange = async (key: keyof SailorSettings, value: boolean) => {
        const updated = await window.api.setSailorSettings({ [key]: value });
        setSailorSettings(updated);
    };

    const handleSwitchInstance = async (name: string) => {
        await window.api.switchColimaInstance(name);
        setActiveInstance(name);
        loadColimaData();
    };

    const handleStartInstance = async (name: string) => {
        await window.api.startColimaInstance(name);
        loadColimaData();
    };

    const handleStopInstance = async (name: string) => {
        await window.api.stopColimaInstance(name);
        loadColimaData();
    };

    const handleDeleteInstance = async (name: string) => {
        if (confirm(`Are you sure you want to delete instance "${name}"?`)) {
            await window.api.deleteColimaInstance(name);
            loadColimaData();
        }
    };

    const handleCreateInstance = async (options: ColimaCreateOptions) => {
        await window.api.createColimaInstance(options);
        loadColimaData();
    };

    const handleEditInstance = async (options: ColimaCreateOptions) => {
        if (editingInstance) {
            await window.api.editColimaInstance(editingInstance.name, options);
            loadColimaData();
        }
    };

    const handleSwitchContext = async (name: string) => {
        await window.api.switchDockerContext(name);
        setActiveContext(name);
        loadDockerContexts();
    };

    return (
        <div id="settings-page">
            <h1>Settings</h1>

            {/* Sailor Settings */}
            <div className="settings-section">
                <div className="section-header">
                    <FiAnchor className="section-icon" />
                    <h2>Sailor</h2>
                </div>
                <div className="section-content">
                    <div className="setting-item">
                        <div className="setting-info">
                            <div className="setting-label">Start on Login</div>
                            <div className="setting-description">Automatically launch Sailor when you log in</div>
                        </div>
                        <div className="setting-control">
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={sailorSettings.startOnLogin}
                                    onChange={e => handleSailorSettingChange('startOnLogin', e.target.checked)}
                                />
                                <span className="slider"></span>
                            </label>
                        </div>
                    </div>
                    <div className="setting-item">
                        <div className="setting-info">
                            <div className="setting-label">Stop VM on Exit</div>
                            <div className="setting-description">Stop the VM and containers when closing Sailor</div>
                        </div>
                        <div className="setting-control">
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={sailorSettings.stopOnExit}
                                    onChange={e => handleSailorSettingChange('stopOnExit', e.target.checked)}
                                />
                                <span className="slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            {/* VM (Colima) Settings */}
            <div className="settings-section">
                <div className="section-header">
                    <FiServer className="section-icon" />
                    <h2>VM (Colima)</h2>
                </div>
                <div className="section-content">
                    {colimaStats && (
                        <div className="vm-stats">
                            <div className="stat-item">
                                <span className="stat-value">{colimaStats.cpu}</span>
                                <span className="stat-label">CPU</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-value">{formatBytes(colimaStats.memory)}</span>
                                <span className="stat-label">Memory</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-value">{formatBytes(colimaStats.disk)}</span>
                                <span className="stat-label">Disk</span>
                            </div>
                        </div>
                    )}

                    {/* Colima Version */}
                    {!loadingVersions && dependencyInfo && renderVersionItem('colima', 'Colima', dependencyInfo.dependencies.colima)}

                    <div className="setting-item">
                        <div className="setting-info">
                            <div className="setting-label">Instances</div>
                            <div className="setting-description">Manage Colima VM instances</div>
                        </div>
                    </div>

                    {loadingInstances ? (
                        <div className="loading"><FiLoader className="spinner" /> Loading instances...</div>
                    ) : (
                        <div className="instance-list">
                            {instances.map(instance => (
                                <div
                                    key={instance.name}
                                    className={`instance-item ${instance.name === activeInstance ? 'active' : ''}`}
                                >
                                    <div className={`instance-status ${instance.status.toLowerCase()}`}></div>
                                    <div className="instance-info">
                                        <div className="instance-name">
                                            {instance.name}
                                            {instance.name === activeInstance && ' (active)'}
                                        </div>
                                        <div className="instance-specs">
                                            {instance.cpu} CPU &bull; {instance.memory}GB RAM &bull; {instance.disk}GB Disk &bull; {instance.runtime}
                                        </div>
                                    </div>
                                    <div className="instance-actions">
                                        {instance.status === 'Running' ? (
                                            <button onClick={() => handleStopInstance(instance.name)}>Stop</button>
                                        ) : (
                                            <button onClick={() => handleStartInstance(instance.name)}>Start</button>
                                        )}
                                        {instance.name !== activeInstance && (
                                            <button className="primary" onClick={() => handleSwitchInstance(instance.name)}>
                                                Use
                                            </button>
                                        )}
                                        <button onClick={() => { setEditingInstance(instance); setShowCreateModal(true); }}>
                                            Edit
                                        </button>
                                        {instance.name !== 'default' && (
                                            <button className="danger" onClick={() => handleDeleteInstance(instance.name)}>
                                                Delete
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                            <button className="add-button" onClick={() => { setEditingInstance(null); setShowCreateModal(true); }}>
                                <FiPlus /> Add Instance
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Docker Settings */}
            <div className="settings-section">
                <div className="section-header">
                    <FiBox className="section-icon" />
                    <h2>Docker</h2>
                </div>
                <div className="section-content">
                    {/* Docker CLI Version */}
                    {!loadingVersions && dependencyInfo && renderVersionItem('docker', 'Docker CLI', dependencyInfo.dependencies.docker)}

                    <div className="setting-item">
                        <div className="setting-info">
                            <div className="setting-label">Context</div>
                            <div className="setting-description">Select the Docker context to use</div>
                        </div>
                    </div>

                    {loadingContexts ? (
                        <div className="loading"><FiLoader className="spinner" /> Loading contexts...</div>
                    ) : (
                        <div className="context-list">
                            {contexts.map(context => (
                                <div
                                    key={context.name}
                                    className={`context-item ${context.current ? 'active' : ''}`}
                                    onClick={() => handleSwitchContext(context.name)}
                                >
                                    <div className={`context-indicator ${context.current ? 'current' : ''}`}></div>
                                    <div className="context-info">
                                        <div className="context-name">
                                            {context.name}
                                            {context.current && ' (current)'}
                                        </div>
                                        <div className="context-endpoint">{context.dockerEndpoint || 'No endpoint'}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <CreateInstanceModal
                isOpen={showCreateModal}
                onClose={() => { setShowCreateModal(false); setEditingInstance(null); }}
                onSubmit={editingInstance ? handleEditInstance : handleCreateInstance}
                editInstance={editingInstance}
            />

            {/* Restart Prompt Modal */}
            {showRestartPrompt && (
                <div className="modal-overlay" onClick={() => setShowRestartPrompt(false)}>
                    <div className="modal restart-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Update Complete</h3>
                            <button className="close-button" onClick={() => setShowRestartPrompt(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <p>
                                The component has been updated successfully. Please restart Sailor for the changes to take effect.
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button className="cancel" onClick={() => setShowRestartPrompt(false)}>Later</button>
                            <button className="submit" onClick={() => window.close()}>Quit Now</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Settings;
