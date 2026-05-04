export interface ContainerPort {
  privatePort: number;
  publicPort?: number;
  type: string;
}

export interface ContainerNetwork {
  name: string;
  ipAddress: string;
}

export interface ContainerData {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'paused' | 'created' | 'exited' | 'booting';
  ports: ContainerPort[];
  networks: ContainerNetwork[];
  created: number;
  composeProject?: string;
  composeService?: string;
}

export interface ColimaStats {
  cpu: number;
  memory: number;
  disk: number;
}

export interface ContainerStats {
  containerId: string;
  timestamp: number;
  cpu: number;
  memory: number;
  memoryLimit: number;
  networkRx: number;
  networkTx: number;
}

// Settings types
export interface SailorSettings {
  startOnLogin: boolean;
  stopOnExit: boolean;
  minimizeToTrayOnClose: boolean;
}

export interface ColimaInstance {
  name: string;
  cpu: number;
  memory: number;
  disk: number;
  runtime: 'docker' | 'containerd';
  arch: 'x86_64' | 'aarch64' | 'host';
  vmType: 'qemu' | 'vz';
  network: boolean;
  kubernetes: boolean;
  status: 'Running' | 'Stopped' | 'Unknown';
}

export interface ColimaSettings {
  activeInstance: string;
}

export interface DockerContext {
  name: string;
  description: string;
  dockerEndpoint: string;
  current: boolean;
}

export interface DockerSettings {
  activeContext: string;
}

export interface NotificationSettings {
  acknowledgedVersions: Record<string, string>; // notificationId -> version when acknowledged
}

export interface AppSettings {
  sailor: SailorSettings;
  colima: ColimaSettings;
  docker: DockerSettings;
  notifications: NotificationSettings;
}

// Dependency types
export type DependencyName = 'homebrew' | 'colima' | 'docker';

export interface DependencyStatus {
  name: string;
  installed: boolean;
  version: string | null;
  meetsMinimum: boolean;
  minimumVersion: string;
  recommendedVersion: string;
  latestVersion: string | null;
  path: string | null;
  installedViaHomebrew: boolean;
}

export interface NonHomebrewInstall {
  installed: boolean;
  path: string | null;
  canAutoRemove: boolean;
}

export interface ConflictInfo {
  hasConflicts: boolean;
  dockerDesktop: {
    installed: boolean;
    path: string | null;
    running: boolean;
  };
  nonHomebrewColima: NonHomebrewInstall;
  nonHomebrewDocker: NonHomebrewInstall;
}

export interface DependencyCheckResult {
  platform: 'mac-arm' | 'mac-intel';
  allMet: boolean;
  conflicts: ConflictInfo;
  dependencies: {
    homebrew: DependencyStatus;
    colima: DependencyStatus;
    docker: DependencyStatus;
  };
}

// Notification system types
export interface DependencyNotification {
  id: string;
  type: 'untested_version' | 'non_homebrew';
  dependency: DependencyName;
  version: string;
  message: string;
}

export interface NotificationState {
  notifications: DependencyNotification[];
  acknowledgedVersions: Record<string, string>; // dependency -> acknowledged version
}
