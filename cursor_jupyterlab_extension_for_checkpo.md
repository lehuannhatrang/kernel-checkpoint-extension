# JupyterLab extension for checkpoint management
_Exported on 4/9/2026 at 23:59:07 GMT+9 from Cursor (3.0.13)_

---

**User**

i am building a jupyterlab extension for checkpoint/restore pod kernel  ( kernel pod of jupyter enterprise gateway). TO do that , on the UI, we need a button "Saving points" to open a modal. In the modal, there are list of checkpoints which that user has taken before. User can choose one of them to restore. And also there is a button on the modal which will trigger checkpoint "Saving kernel state". When click the saving kernel state button, we allow user to type the name of checkpoint, and use that name to send to the API server. User also can get the status of a checkpoint, modify checkpoint name, delete a checkpoint. 
I has already implemented the API server. The API server endpoint should be got  from the configured jupyter env "CHECKPOINT_API_URL" . This is the example of api:
1. List checkpoints for a namespace: 
curl --location 'http://192.168.40.246:31809/api/v1/checkpoints?namespace=kubeflow-user-example-com'
response:
{
    "items": [
        {
            "name": "checkpoint-jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f-20260409-100748",
            "namespace": "kubeflow-user-example-com",
            "phase": "Completed",
            "message": "All containers checkpointed successfully",
            "schedule": "immediately",
            "podRef": {
                "name": "jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f",
                "namespace": "kubeflow-user-example-com"
            },
            "resourceRef": {
                "apiVersion": "v1",
                "kind": "Pod",
                "name": "jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f",
                "namespace": "kubeflow-user-example-com"
            },
            "checkpointFiles": [
                {
                    "containerName": "jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f",
                    "filePath": "checkpoint-jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f_kubeflow-user-example-com-jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f-2026-04-09T19:07:48+09:00.tar",
                    "checkpointTime": "2026-04-09T10:07:54Z"
                }
            ],
            "builtImages": [
                {
                    "containerName": "jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f",
                    "imageName": "localhost/checkpoint-jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f-jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f:20260409-100754",
                    "buildTime": "2026-04-09T10:08:01Z",
                    "pushed": false
                }
            ],
            "createdAt": "2026-04-09T10:07:48Z"
        },
        {
            "name": "test-checkpoint-1",
            "namespace": "kubeflow-user-example-com",
            "phase": "Completed",
            "message": "All containers checkpointed successfully",
            "schedule": "immediately",
            "buildImage": false,
            "podRef": {
                "name": "jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f",
                "namespace": "kubeflow-user-example-com"
            },
            "resourceRef": {
                "apiVersion": "v1",
                "kind": "Pod",
                "name": "jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f",
                "namespace": "kubeflow-user-example-com"
            },
            "checkpointFiles": [
                {
                    "containerName": "jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f",
                    "filePath": "checkpoint-jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f_kubeflow-user-example-com-jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f-2026-04-09T19:12:46+09:00.tar",
                    "storagePath": "kubeflow-user-example-com/checkpoint-jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f_kubeflow-user-example-com-jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f-2026-04-09T19:12:46+09:00.tar",
                    "checkpointTime": "2026-04-09T10:12:52Z"
                }
            ],
            "createdAt": "2026-04-09T10:12:46Z"
        }
    ],
    "totalCount": 2
}

2. get checkpoint status: curl --location 'http://192.168.40.246:31809/api/v1/checkpoints/kubeflow-user-example-com/test-checkpoint-1'
Response: 
{
    "name": "test-checkpoint-1",
    "namespace": "kubeflow-user-example-com",
    "phase": "Completed",
    "message": "All containers checkpointed successfully",
    "schedule": "immediately",
    "buildImage": false,
    "podRef": {
        "name": "jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f",
        "namespace": "kubeflow-user-example-com"
    },
    "resourceRef": {
        "apiVersion": "v1",
        "kind": "Pod",
        "name": "jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f",
        "namespace": "kubeflow-user-example-com"
    },
    "checkpointFiles": [
        {
            "containerName": "jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f",
            "filePath": "checkpoint-jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f_kubeflow-user-example-com-jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f-2026-04-09T19:12:46+09:00.tar",
            "storagePath": "kubeflow-user-example-com/checkpoint-jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f_kubeflow-user-example-com-jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f-2026-04-09T19:12:46+09:00.tar",
            "checkpointTime": "2026-04-09T10:12:52Z"
        }
    ],
    "createdAt": "2026-04-09T10:12:46Z"
}

3. Create checkpoint: 
curl --location 'http://192.168.40.246:31809/api/v1/checkpoints' \
--header 'Content-Type: application/json' \
--data '{
    "name": "test-checkpoint-1",
    "namespace": "kubeflow-user-example-com",
    "kernelId": "5df368c8-a92f-408e-8c7d-7ffdf345f86f",
    "buildImage": false
}'

response: 
{
    "name": "test-checkpoint-1",
    "namespace": "kubeflow-user-example-com",
    "schedule": "immediately",
    "buildImage": false,
    "podRef": {
        "name": "jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f",
        "namespace": "kubeflow-user-example-com"
    },
    "resourceRef": {
        "apiVersion": "v1",
        "kind": "Pod",
        "name": "jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f",
        "namespace": "kubeflow-user-example-com"
    },
    "createdAt": "2026-04-09T10:12:46Z"
}

4. Delete checkpoint:
curl --location --request DELETE 'http://192.168.40.246:31809/api/v1/checkpoints/kubeflow-user-example-com/checkpoint-jovyan-5df368c8-a92f-408e-8c7d-7ffdf345f86f-20260409-100748'

Note that the jupyter notebook i deployed by kubeflow, when sending request we should get the namespace (and kernel id in the create scenario)

And When user choose 1 saving point to restore, we will use Local Jupyter Server to create kernel  with extra env so that the next step in our system will know to handle. for example this is my asumption how to handle, please recheck and implement
const initRequest = {
    method: 'POST',
    body: JSON.stringify({
      name: 'python_kubernetes', // kernel spec , should match with checkpoint kernel. 
      env: {
        'CHECKPOINT_RESTORE_NAME': checkpointName, // checkpoint name
      }
    })
  };
const response = await ServerConnection.makeRequest(url, initRequest, settings);
...

---

**Cursor**

Let me start by exploring the existing codebase structure.

Now I have a clear picture of the scaffold. It's a JupyterLab 4 extension with only a stub plugin. I need to build: a Python server extension to proxy the checkpoint API, and a React-based frontend with a toolbar button, modal dialog, and checkpoint management UI.

Let me implement everything.

Now let me implement the TypeScript frontend. I'll create the types, API client, React component, update the plugin, add dependencies, and write styles.

Now update `src/index.ts` with the plugin that wires everything together, including the restore flow:

Now let me update the CSS, `package.json`, and `tsconfig.json`:

Now update `package.json` to add the required frontend dependencies and server extension discovery:

Update `tsconfig.json` to handle `.tsx` files in subdirectories:

Now let's install dependencies and build to verify everything compiles:

Dependencies installed. Now let's build the TypeScript:

TypeScript compiled cleanly. Let's also build the full lab extension:

Everything compiles and builds successfully. Let me also verify the Python server extension works:

Everything builds successfully. Here's a summary of what was implemented:

---

## Architecture Overview

### Python Server Extension (`kernel_checkpoint/`)

**`handlers.py`** — Tornado request handlers that proxy all calls to the external checkpoint API (read from `CHECKPOINT_API_URL` env var). This avoids CORS issues and keeps the API URL server-side:

| Endpoint | Method | Description |
|---|---|---|
| `/kernel-checkpoint/config` | GET | Returns `{checkpointApiUrl, namespace}` to the frontend |
| `/kernel-checkpoint/checkpoints` | GET | Lists checkpoints for a namespace (proxies `?namespace=`) |
| `/kernel-checkpoint/checkpoints` | POST | Creates a new checkpoint |
| `/kernel-checkpoint/checkpoints/<ns>/<name>` | GET | Gets checkpoint status/details |
| `/kernel-checkpoint/checkpoints/<ns>/<name>` | DELETE | Deletes a checkpoint |
| `/kernel-checkpoint/checkpoints/<ns>/<name>` | PATCH | Updates/renames a checkpoint |

**Namespace resolution** — Reads `CHECKPOINT_NAMESPACE` env var, falling back to the Kubernetes service account namespace at `/var/run/secrets/kubernetes.io/serviceaccount/namespace`.

### TypeScript Frontend (`src/`)

**`types.ts`** — Interfaces for `ICheckpoint`, `ICheckpointListResponse`, `ICheckpointConfig`, `ICreateCheckpointRequest`, etc.

**`api.ts`** — `CheckpointAPI` namespace wrapping `ServerConnection.makeRequest` calls to the server extension proxy endpoints.

**`checkpoint-panel.tsx`** — The main React component rendered inside the dialog:
- **Save Kernel State** button at top, which reveals an inline form to name the checkpoint
- **Checkpoint list** showing each checkpoint with name, phase badge (Completed/Failed/In Progress), and creation date
- **Per-checkpoint actions**: Details (expand status info), Rename (inline edit), Delete (with inline confirmation), Restore (with inline confirmation)
- **Auto-refresh** every 5s when any checkpoint is still in progress
- **Flash messages** for success/error feedback

**`index.ts`** — Main plugin:
- Registers the `kernel-checkpoint:open` command
- Adds a **"Saving Points" toolbar button** to every notebook panel
- On click: fetches config, validates namespace + kernel connection, then opens a `showDialog` modal with the `CheckpointPanel`

### Restore Flow

When a user clicks **Restore** on a completed checkpoint:
1. A new kernel is created via `POST /api/kernels` with:

```json
{
  "name": "<current_kernel_spec_name>",
  "env": {
    "CHECKPOINT_RESTORE_NAME": "<checkpoint_name>"
  }
}
```

2. The notebook session is switched to the new kernel via `sessionContext.changeKernel({ id: newKernelId })`
3. The old kernel is shut down automatically by the session manager

### Configuration

Two environment variables are needed on the Jupyter server pod:
- **`CHECKPOINT_API_URL`** — Base URL of the checkpoint API server (e.g. `http://192.168.40.246:31809`)
- **`CHECKPOINT_NAMESPACE`** — Kubernetes namespace (optional if running in-cluster, will auto-detect from service account)

### Build & Install

```bash
# Development install
pip install -e ".[dev]"
jupyter labextension develop . --overwrite
jupyter server extension enable kernel_checkpoint

# Or simply build
jlpm install && jlpm build
```

