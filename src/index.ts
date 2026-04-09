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
import { ICheckpointPanelProps } from './types';

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

        const onRestore = async (checkpointName: string): Promise<void> => {
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
                  CHECKPOINT_RESTORE_NAME: checkpointName
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
        };

        const body = new CheckpointDialogBody({
          namespace: config.namespace,
          kernelId,
          kernelSpecName,
          onRestore
        });

        await showDialog({
          title: 'Kernel Checkpoints',
          body,
          buttons: [Dialog.cancelButton({ label: 'Close' })]
        });

        body.dispose();
      }
    });

    // Inject a toolbar button into every notebook panel
    notebookTracker.widgetAdded.connect(
      (_sender: INotebookTracker, panel: NotebookPanel) => {
        const button = new ToolbarButton({
          label: 'Saving Points',
          tooltip: 'Open kernel checkpoint manager',
          onClick: () => {
            app.commands.execute(COMMAND_ID);
          }
        });
        panel.toolbar.insertItem(10, 'kernel-checkpoint', button);
      }
    );
  }
};

export default plugin;
