import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import {
  Dialog,
  ReactWidget,
  showDialog,
  ToolbarButton
} from '@jupyterlab/apputils';
import { URLExt } from '@jupyterlab/coreutils';
import { KernelAPI, ServerConnection } from '@jupyterlab/services';
import React from 'react';

import { CheckpointPanel } from './checkpoint-panel';
import { CheckpointAPI } from './api';
import { IBusyCellRecord, ICheckpointPanelProps } from './types';
import { planRestore } from './restore-collision';
import {
  CellExecutionTracker,
  RestoreHandler,
  scanBusyCells
} from './restore-handler';

/**
 * Shut down the kernel with the given id and wait until Enterprise Gateway has
 * fully removed it before returning. Used to free a checkpoint's kernel id
 * before recreating a restored kernel under the same id.
 */
async function shutdownKernelAndWait(
  id: string,
  settings: ServerConnection.ISettings,
  timeoutMs = 20000
): Promise<void> {
  await KernelAPI.shutdownKernel(id, settings);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const running = await KernelAPI.listRunning(settings);
    if (!running.some(k => k.id === id)) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(
    `Timed out waiting for kernel ${id} to shut down before restore.`
  );
}

/**
 * ReactWidget wrapper that hosts the CheckpointPanel React tree inside a
 * JupyterLab Dialog body.
 */
class CheckpointDialogBody extends ReactWidget {
  private _props: ICheckpointPanelProps;

  constructor(props: ICheckpointPanelProps) {
    super();
    this._props = props;
    this.addClass('kc-dialog-body');
  }

  protected render(): React.ReactElement {
    return React.createElement(CheckpointPanel, this._props);
  }
}

const COMMAND_ID = 'kernel-checkpoint:open';

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'kernel-checkpoint:plugin',
  description:
    'An extension for saving and restoring kernel pod state with jupyter enterprise gateway',
  autoStart: true,
  requires: [INotebookTracker],
  activate: (app: JupyterFrontEnd, notebookTracker: INotebookTracker) => {
    console.log('JupyterLab extension kernel-checkpoint is activated!');

    // ── Per-notebook execution tracking ──────────────────────────────
    //
    // Each open notebook gets its own CellExecutionTracker that
    // continuously records in-flight msg_id → execution_count pairs
    // from the kernel's iopub channel.  At checkpoint time this map
    // is consulted to capture the execution counts for busy cells.

    const trackerMap = new Map<string, CellExecutionTracker>();

    function ensureTracker(panel: NotebookPanel): CellExecutionTracker {
      let cellTracker = trackerMap.get(panel.id);
      if (!cellTracker) {
        cellTracker = new CellExecutionTracker();
        trackerMap.set(panel.id, cellTracker);
      }
      return cellTracker;
    }

    function connectTrackerToKernel(panel: NotebookPanel): void {
      const kernel = panel.sessionContext.session?.kernel;
      if (kernel) {
        ensureTracker(panel).connectToKernel(kernel);
      }
    }

    // ── Command ──────────────────────────────────────────────────────

    app.commands.addCommand(COMMAND_ID, {
      label: 'Saving Points',
      caption: 'Manage kernel checkpoints',
      execute: async () => {
        const panel = notebookTracker.currentWidget;
        if (!panel) {
          return;
        }

        // Do not await `sessionContext.ready` here: it blocks until the kernel
        // has finished starting, which would prevent the panel from opening on
        // a freshly loaded notebook. The panel works without a live kernel
        // (browse/restore); the create flow is gated on `kernelId` instead.
        const sessionContext = panel.sessionContext;

        let config;
        try {
          config = await CheckpointAPI.getConfig();
        } catch (err) {
          await showDialog({
            title: 'Configuration Error',
            body: 'Failed to load checkpoint configuration. Ensure CHECKPOINT_API_URL is set.',
            buttons: [Dialog.okButton()]
          });
          return;
        }

        if (!config.namespace) {
          await showDialog({
            title: 'Configuration Error',
            body: 'Namespace not configured. Set CHECKPOINT_NAMESPACE environment variable or deploy in Kubernetes.',
            buttons: [Dialog.okButton()]
          });
          return;
        }

        // The panel may be opened without a running kernel so the user can
        // browse and restore checkpoints. Kernel-derived values are therefore
        // optional; the create flow is gated on `kernelId` in the panel.
        const kernel = sessionContext.session?.kernel;
        const kernelId = kernel?.id ?? '';
        const kernelSpecName = kernel?.name || 'python_kubernetes';
        const notebookName = panel.title.label || '';
        const sessionId = sessionContext.session?.id || '';

        // ── Restore callback ─────────────────────────────────────────
        //
        // Called by the CheckpointPanel when the user confirms a restore.
        // Creates a new kernel seeded with the checkpoint environment
        // variables, switches the notebook session to it, and then
        // activates the RestoreHandler to catch orphaned iopub messages.

        const onRestore = async (
          checkpointName: string,
          checkpointFilePath: string,
          containerName: string,
          cpKernelId: string,
          cpSessionId: string,
          cpKernelName: string,
          busyCells: IBusyCellRecord[]
        ): Promise<void> => {
          const settings = ServerConnection.makeSettings();

          // ── Reconcile kernel-id collision ──────────────────────────
          //
          // The restored kernel re-announces itself to JEG under the id it
          // was checkpointed with, so `KERNEL_ID` below MUST equal that id
          // for the reconnect to land. Because only one live kernel may hold
          // that id, resolve any existing holder first.
          const running = await KernelAPI.listRunning(settings);
          const plan = planRestore(
            running.map(k => k.id),
            cpKernelId,
            sessionContext.session?.kernel?.id
          );

          if (plan.action === 'refuse') {
            throw new Error(
              `Checkpoint kernel id ${plan.conflictKernelId} is already in use ` +
                'by another running kernel. Concurrent restore of the same ' +
                'checkpoint is not supported; shut that kernel down first.'
            );
          }

          if (plan.action === 'replace') {
            const confirm = await showDialog({
              title: 'Kernel Already Running',
              body:
                `A kernel with id ${cpKernelId} is running in this notebook. ` +
                'It will be shut down and replaced by the restored kernel.',
              buttons: [
                Dialog.cancelButton(),
                Dialog.warnButton({ label: 'Shut Down & Restore' })
              ]
            });
            if (!confirm.button.accept) {
              return;
            }
            await shutdownKernelAndWait(cpKernelId, settings);
          }

          // ── Create the restored kernel ─────────────────────────────
          const kernelUrl = URLExt.join(settings.baseUrl, 'api', 'kernels');

          const response = await ServerConnection.makeRequest(
            kernelUrl,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: cpKernelName || kernelSpecName,
                env: {
                  KERNEL_CHECKPOINT_NAME: checkpointName,
                  KERNEL_CHECKPOINT_FILE_PATH: checkpointFilePath,
                  KERNEL_CHECKPOINT_CONTAINER_NAME: containerName,
                  KERNEL_ID: cpKernelId,
                  KERNEL_SESSION_ID: cpSessionId
                }
              })
            },
            settings
          );

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Failed to create restored kernel: ${errText}`);
          }

          const kernelData = await response.json();

          // ── Activate Catch-and-Render (Steps 3-6) ──────────────────
          //
          // Arm the RestoreHandler BEFORE switching the kernel so its iopub
          // listener is attached the moment the new KernelConnection is
          // created — before the websocket opens and the server replays the
          // in-flight cell's buffered output (which would otherwise be missed).

          let handler: RestoreHandler | null = null;
          if (busyCells.length > 0) {
            console.log(
              `[kernel-checkpoint] Restore detected ${busyCells.length} ` +
                'busy cell(s). Arming RestoreHandler.'
            );
            handler = new RestoreHandler();
            handler.arm(sessionContext, panel, busyCells);
          }

          await sessionContext.changeKernel({ id: kernelData.id });

          // Fallback: if `kernelChanged` did not fire (e.g. the restored
          // kernel was already attached), hook the current kernel directly.
          if (handler && !handler.isHooked) {
            const restoredKernel = sessionContext.session?.kernel;
            if (restoredKernel) {
              handler.hookKernel(restoredKernel);
            }
          }
        };

        // ── Dialog construction ──────────────────────────────────────

        const body = new CheckpointDialogBody({
          namespace: config.namespace,
          kernelId,
          kernelSpecName,
          notebookName,
          sessionId,
          onRestore,
          onBeforeCreate: () => {
            const cellTracker = trackerMap.get(panel.id);
            if (!cellTracker) {
              return [];
            }
            const busyCells = scanBusyCells(panel, cellTracker);
            if (busyCells.length > 0) {
              console.log(
                `[kernel-checkpoint] Scanned ${busyCells.length} busy cell(s) ` +
                  'before checkpoint:',
                busyCells
              );
            }
            return busyCells;
          }
        });

        await showDialog({
          title: 'Kernel Checkpoints',
          body,
          buttons: [Dialog.cancelButton({ label: 'Close' })]
        });

        body.dispose();
      }
    });

    // ── Notebook lifecycle wiring ────────────────────────────────────

    notebookTracker.widgetAdded.connect(
      (_sender: INotebookTracker, panel: NotebookPanel) => {
        // Toolbar button
        const button = new ToolbarButton({
          label: 'Saving Points',
          tooltip: 'Open kernel checkpoint manager',
          onClick: () => {
            app.commands.execute(COMMAND_ID);
          }
        });
        panel.toolbar.insertItem(10, 'kernel-checkpoint', button);

        // Execution tracker setup — connect once the session is ready,
        // and reconnect whenever the kernel is swapped.

        panel.sessionContext.ready.then(() => {
          connectTrackerToKernel(panel);
        });

        panel.sessionContext.kernelChanged.connect(() => {
          connectTrackerToKernel(panel);
        });

        panel.disposed.connect(() => {
          const cellTracker = trackerMap.get(panel.id);
          if (cellTracker) {
            cellTracker.disconnectFromKernel();
            trackerMap.delete(panel.id);
          }
        });
      }
    );
  }
};

export default plugin;
