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

/**
 * Snapshot of a single busy cell captured at checkpoint time.
 * Maps the kernel's in-flight `msg_id` to the notebook cell so that
 * orphaned iopub messages can be routed after a restore.
 */
export interface IBusyCellRecord {
  cellIndex: number;
  cellId: string;
  msgId: string;
  executionCount: number | null;
}

export interface ICheckpointMetadata {
  kernelId: string;
  kernelName: string;
  notebookName: string;
  busyCells?: IBusyCellRecord[];
}

export interface ICheckpoint {
  name: string;
  namespace: string;
  phase: string;
  message: string;
  schedule: string;
  buildImage?: boolean;
  metadata?: ICheckpointMetadata;
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
  metadata: ICheckpointMetadata;
}

export interface ICheckpointPanelProps {
  namespace: string;
  kernelId: string;
  kernelSpecName: string;
  notebookName: string;
  onRestore: (
    checkpointName: string,
    checkpointFilePath: string,
    containerName: string,
    kernelId: string,
    busyCells: IBusyCellRecord[]
  ) => Promise<void>;
  onBeforeCreate?: () => IBusyCellRecord[];
}
