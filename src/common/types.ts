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
