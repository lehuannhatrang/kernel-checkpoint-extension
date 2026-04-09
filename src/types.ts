export interface ICheckpointFile {
  containerName: string;
  filePath: string;
  storagePath?: string;
  checkpointTime: string;
}

export interface IBuiltImage {
  containerName: string;
  imageName: string;
  buildTime: string;
  pushed: boolean;
}

export interface IPodRef {
  name: string;
  namespace: string;
}

export interface IResourceRef {
  apiVersion: string;
  kind: string;
  name: string;
  namespace: string;
}

export interface ICheckpoint {
  name: string;
  namespace: string;
  phase: string;
  message: string;
  schedule: string;
  buildImage?: boolean;
  podRef: IPodRef;
  resourceRef: IResourceRef;
  checkpointFiles?: ICheckpointFile[];
  builtImages?: IBuiltImage[];
  createdAt: string;
}

export interface ICheckpointListResponse {
  items: ICheckpoint[];
  totalCount: number;
}

export interface ICheckpointConfig {
  checkpointApiUrl: string;
  namespace: string;
}

export interface ICreateCheckpointRequest {
  name: string;
  namespace: string;
  kernelId: string;
  buildImage: boolean;
}

export interface ICheckpointPanelProps {
  namespace: string;
  kernelId: string;
  kernelSpecName: string;
  onRestore: (checkpointName: string) => Promise<void>;
}
