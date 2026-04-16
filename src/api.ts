import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';
import {
  ICheckpointConfig,
  ICheckpointListResponse,
  ICheckpoint,
  ICreateCheckpointRequest
} from './types';

const API_NAMESPACE = 'kernel-checkpoint';

function makeRequest(
  endpoint: string,
  init: RequestInit = {}
): Promise<Response> {
  const settings = ServerConnection.makeSettings();
  const url = URLExt.join(settings.baseUrl, API_NAMESPACE, endpoint);
  return ServerConnection.makeRequest(url, init, settings);
}

function jsonInit(method: string, data: any): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  };
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.message || body.error || JSON.stringify(body);
    } catch {
      // use statusText
    }
    throw new Error(detail);
  }
  return response.json();
}

export namespace CheckpointAPI {
  export async function getConfig(): Promise<ICheckpointConfig> {
    const resp = await makeRequest('config');
    return handleResponse<ICheckpointConfig>(resp);
  }

  export async function listCheckpoints(
    namespace: string
  ): Promise<ICheckpointListResponse> {
    const resp = await makeRequest(
      `checkpoints?namespace=${encodeURIComponent(namespace)}`
    );
    return handleResponse<ICheckpointListResponse>(resp);
  }

  export async function getCheckpoint(
    namespace: string,
    name: string
  ): Promise<ICheckpoint> {
    const resp = await makeRequest(
      `checkpoints/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`
    );
    return handleResponse<ICheckpoint>(resp);
  }

  export async function createCheckpoint(
    request: ICreateCheckpointRequest
  ): Promise<ICheckpoint> {
    const resp = await makeRequest(
      'checkpoints',
      jsonInit('POST', request)
    );
    return handleResponse<ICheckpoint>(resp);
  }

  export async function deleteCheckpoint(
    namespace: string,
    name: string
  ): Promise<void> {
    const resp = await makeRequest(
      `checkpoints/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
      { method: 'DELETE' }
    );
    if (!resp.ok) {
      let detail = resp.statusText;
      try {
        const body = await resp.json();
        detail = body.message || body.error || JSON.stringify(body);
      } catch {
        // use statusText
      }
      throw new Error(detail);
    }
  }

  export async function updateCheckpoint(
    namespace: string,
    name: string,
    data: Record<string, any>
  ): Promise<ICheckpoint> {
    const resp = await makeRequest(
      `checkpoints/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
      jsonInit('PUT', data)
    );
    return handleResponse<ICheckpoint>(resp);
  }
}
