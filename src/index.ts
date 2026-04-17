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
import { ServerConnection } from '@jupyterlab/services';
import React from 'react';

import { CheckpointPanel } from './checkpoint-panel';
import { CheckpointAPI } from './api';
import { IBusyCellRecord, ICheckpointPanelProps } from './types';
import {
  CellExecutionTracker,
  RestoreHandler,
  scanBusyCells
} from './restore-handler';

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

        const sessionContext = panel.sessionContext;
        await sessionContext.ready;

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

        const kernel = sessionContext.session?.kernel;
        if (!kernel) {
          await showDialog({
            title: 'No Kernel',
            body: 'No kernel is connected. Please start a kernel first.',
            buttons: [Dialog.okButton()]
          });
          return;
        }

        const kernelId = kernel.id;
        const kernelSpecName = kernel.name || 'python_kubernetes';
        const notebookName = panel.title.label || '';

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
          busyCells: IBusyCellRecord[]
        ): Promise<void> => {
          const settings = ServerConnection.makeSettings();
          const kernelUrl = URLExt.join(settings.baseUrl, 'api', 'kernels');

          const response = await ServerConnection.makeRequest(
            kernelUrl,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: kernelSpecName,
                env: {
                  KERNEL_CHECKPOINT_NAME: checkpointName,
                  KERNEL_CHECKPOINT_FILE_PATH: checkpointFilePath,
                  KERNEL_CHECKPOINT_CONTAINER_NAME: containerName,
                  KERNEL_ID: cpKernelId
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
          await sessionContext.changeKernel({ id: kernelData.id });

          // ── Activate Catch-and-Render (Steps 3-6) ──────────────────
          //
          // The restored kernel is now connected.  If there were busy
          // cells at checkpoint time, spin up a RestoreHandler that
          // hooks iopub and intercepts orphaned messages.

          if (busyCells.length > 0) {
            console.log(
              `[kernel-checkpoint] Restore detected ${busyCells.length} ` +
                'busy cell(s). Activating RestoreHandler.'
            );
            const handler = new RestoreHandler();
            handler.hookRestoredKernel(panel, busyCells);
          }
        };

        // ── Dialog construction ──────────────────────────────────────

        const body = new CheckpointDialogBody({
          namespace: config.namespace,
          kernelId,
          kernelSpecName,
          notebookName,
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
