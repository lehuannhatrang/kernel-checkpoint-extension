import { NotebookPanel } from '@jupyterlab/notebook';
import { CodeCell } from '@jupyterlab/cells';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { IBusyCellRecord } from './types';

/**
 * Safely extracts `msg_id` from a kernel message's `parent_header`.
 * Returns undefined when the parent_header is empty (e.g. unsolicited
 * kernel-status broadcasts at startup).
 */
function getParentMsgId(
  msg: KernelMessage.IMessage
): string | undefined {
  const ph = msg.parent_header;
  return ph && 'msg_id' in ph
    ? (ph as KernelMessage.IHeader).msg_id
    : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock save / load helpers.
// These demonstrate the checkpoint-metadata persistence contract.
// Replace the bodies with real API calls (e.g. CheckpointAPI.updateCheckpoint)
// when wiring to your backend.
// ─────────────────────────────────────────────────────────────────────────────

export async function saveCheckpointCellMetadata(
  _checkpointName: string,
  _namespace: string,
  busyCells: IBusyCellRecord[]
): Promise<void> {
  console.log(
    `[RestoreHandler] Would persist ${busyCells.length} busy-cell record(s)`,
    busyCells
  );
}

export async function loadCheckpointCellMetadata(
  _checkpointName: string,
  _namespace: string
): Promise<IBusyCellRecord[]> {
  console.log('[RestoreHandler] Would load busy-cell records from backend');
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// CellExecutionTracker
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Continuously monitors a kernel's iopub channel to maintain a live map of
 * **in-flight** execute requests:  `msg_id → execution_count`.
 *
 * When the kernel broadcasts `execute_input`, the tracker records the
 * execution count assigned by the kernel (this is the number that will
 * eventually be shown as `[N]` in the cell prompt).  When `status: idle`
 * arrives for that same `msg_id`, the entry is removed.
 *
 * The tracker must be connected to the kernel **before** any cells are
 * executed so that the execution count is available at checkpoint time.
 */
export class CellExecutionTracker {
  private _pendingExecutions = new Map<string, number>();
  private _kernel: Kernel.IKernelConnection | null = null;

  get pendingExecutions(): ReadonlyMap<string, number> {
    return this._pendingExecutions;
  }

  connectToKernel(kernel: Kernel.IKernelConnection): void {
    this.disconnectFromKernel();
    this._kernel = kernel;
    kernel.iopubMessage.connect(this._onIopubMessage, this);
  }

  disconnectFromKernel(): void {
    if (this._kernel) {
      this._kernel.iopubMessage.disconnect(this._onIopubMessage, this);
      this._kernel = null;
    }
    this._pendingExecutions.clear();
  }

  private _onIopubMessage(
    _sender: Kernel.IKernelConnection,
    msg: KernelMessage.IIOPubMessage
  ): void {
    const parentMsgId = getParentMsgId(msg);
    if (!parentMsgId) {
      return;
    }

    if (msg.header.msg_type === 'execute_input') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const execCount = (msg.content as any).execution_count as number;
      this._pendingExecutions.set(parentMsgId, execCount);
    }

    if (
      msg.header.msg_type === 'status' &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (msg.content as any).execution_state === 'idle'
    ) {
      this._pendingExecutions.delete(parentMsgId);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// scanBusyCells  (Step 1 of the Catch-and-Render architecture)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scans the active notebook for cells that are currently executing (`[*]`
 * prompt) and extracts the `msg_id` of each in-flight execution request.
 *
 * ### How the msg_id is obtained
 *
 * When JupyterLab executes a cell it calls `kernel.requestExecute()` and
 * stores the resulting `IShellFuture` on the cell's `OutputArea`:
 *
 *   `codeCell.outputArea.future = kernel.requestExecute({ code })`
 *
 * JupyterLab exposes `future` as a **write-only** setter on `OutputArea`.
 * The underlying field is `OutputArea._future` (private).  We read it here
 * because no public getter exists, and the `msg_id` it contains is the only
 * reliable link between the cell widget and the kernel message stream.
 *
 * ### Why we also need the CellExecutionTracker
 *
 * The `_future.msg.header.msg_id` gives us the execute-request id, but not
 * the **execution count** the kernel assigned (the `[N]` prompt number).
 * During execution the cell's `model.executionCount` is `null` (that is
 * what produces the `[*]` display).  The actual count was broadcast earlier
 * in an `execute_input` iopub message which the `CellExecutionTracker`
 * recorded.  We look it up here so that the restore phase can set the
 * correct prompt after the cell finishes.
 */
export function scanBusyCells(
  panel: NotebookPanel,
  tracker: CellExecutionTracker
): IBusyCellRecord[] {
  const records: IBusyCellRecord[] = [];
  const cells = panel.content.widgets;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.model.type !== 'code') {
      continue;
    }

    const codeCell = cell as CodeCell;

    // `executionCount === null` is the canonical indicator for a busy cell
    // (the prompt renders `[*]`).  Fresh cells also have `null`, so we
    // additionally require an active future below.
    if (codeCell.model.executionCount !== null) {
      continue;
    }

    // Read the private `_future` field.  This is an `IShellFuture` whose
    // `.msg.header.msg_id` is the id the kernel uses in `parent_header`
    // for every message belonging to this execution.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const future = (codeCell.outputArea as any)._future;
    if (!future?.msg?.header?.msg_id) {
      continue;
    }

    const msgId: string = future.msg.header.msg_id;
    const executionCount = tracker.pendingExecutions.get(msgId) ?? null;

    records.push({
      cellIndex: i,
      cellId: cell.model.id,
      msgId,
      executionCount
    });
  }

  return records;
}

// ─────────────────────────────────────────────────────────────────────────────
// RestoreHandler  (Steps 3–6 of the Catch-and-Render architecture)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hooks into a **restored** kernel's iopub channel and intercepts "orphaned"
 * messages whose `parent_header.msg_id` matches a cell that was busy at
 * checkpoint time.
 *
 * For each intercepted message the handler manually injects the output into
 * the cell's `OutputArea`, replicating what JupyterLab would normally do
 * if the original execution future were still alive.
 *
 * ### Output injection mechanism
 *
 * `codeCell.outputArea.model` implements `IOutputAreaModel`.  Calling
 * `.add(output)` with an `nbformat.IOutput`-shaped object triggers the
 * following internal chain:
 *
 *  1. The model wraps the raw JSON in an `OutputModel` instance.
 *  2. It appends the model to its internal list.
 *     – For `stream` outputs with the same `name` (stdout / stderr) as the
 *       preceding entry, the text is **merged** instead of creating a new
 *       item.  This matches standard notebook behavior.
 *  3. A Lumino `changed` signal fires.
 *  4. The `OutputArea` widget reacts and creates the visual renderer
 *     (e.g. `<pre>` for streams, a MIME renderer for display_data).
 *
 * Because all of this happens through the model's public API the rendered
 * output is indistinguishable from one produced by the normal future-based
 * routing.
 */
export class RestoreHandler {
  private _activeMsgIds = new Map<string, IBusyCellRecord>();
  private _panel: NotebookPanel | null = null;
  private _kernel: Kernel.IKernelConnection | null = null;

  /**
   * Begin intercepting orphaned messages for the given busy cells.
   * Call immediately after `sessionContext.changeKernel()` resolves.
   */
  hookRestoredKernel(
    panel: NotebookPanel,
    busyCells: IBusyCellRecord[]
  ): void {
    if (busyCells.length === 0) {
      return;
    }

    this.dispose();
    this._panel = panel;

    for (const record of busyCells) {
      this._activeMsgIds.set(record.msgId, record);
    }

    // Re-apply the busy indicator ([*]) so the user sees the cells as
    // still running while output continues to stream in.
    for (const record of busyCells) {
      const cell = this._findCell(panel, record);
      if (cell) {
        cell.model.executionCount = null;
      }
    }

    const kernel = panel.sessionContext.session?.kernel;
    if (!kernel) {
      console.warn(
        '[RestoreHandler] No kernel on panel after changeKernel(); ' +
          'cannot hook iopub. Orphaned outputs will be lost.'
      );
      return;
    }

    this._kernel = kernel;
    kernel.iopubMessage.connect(this._onIopubMessage, this);

    console.log(
      `[RestoreHandler] Hooked into restored kernel iopub. ` +
        `Tracking ${busyCells.length} busy cell(s):`,
      busyCells.map(r => `cell[${r.cellIndex}] (${r.cellId}) → ${r.msgId}`)
    );
  }

  dispose(): void {
    if (this._kernel) {
      this._kernel.iopubMessage.disconnect(this._onIopubMessage, this);
      this._kernel = null;
    }
    this._activeMsgIds.clear();
    this._panel = null;
  }

  /**
   * Locate the CodeCell for a given record.  We first try the saved index
   * (fast path) and verify by cell ID, then fall back to a linear scan.
   * This handles the case where the user inserted or deleted cells between
   * checkpoint and restore.
   */
  private _findCell(
    panel: NotebookPanel,
    record: IBusyCellRecord
  ): CodeCell | null {
    const cells = panel.content.widgets;

    if (record.cellIndex < cells.length) {
      const candidate = cells[record.cellIndex];
      if (
        candidate.model.type === 'code' &&
        candidate.model.id === record.cellId
      ) {
        return candidate as CodeCell;
      }
    }

    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.model.id === record.cellId && c.model.type === 'code') {
        return c as CodeCell;
      }
    }

    return null;
  }

  // ── iopub signal handler ──────────────────────────────────────────────

  private _onIopubMessage(
    _sender: Kernel.IKernelConnection,
    msg: KernelMessage.IIOPubMessage
  ): void {
    const parentMsgId = getParentMsgId(msg);
    if (!parentMsgId) {
      return;
    }

    const record = this._activeMsgIds.get(parentMsgId);
    if (!record) {
      // Not one of our tracked orphaned executions — let JupyterLab's
      // normal future-based routing handle this message.
      return;
    }

    if (!this._panel) {
      return;
    }

    const codeCell = this._findCell(this._panel, record);
    if (!codeCell) {
      return;
    }

    const msgType = msg.header.msg_type;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any = msg.content;

    // ── Step 5: Inject output into the cell's OutputArea ────────────
    //
    // We construct an nbformat-compatible output object and pass it to
    // `outputArea.model.add()`.  The model validates the shape, wraps it
    // in an OutputModel, and emits a `changed` signal that causes the
    // OutputArea widget to render the new entry.

    switch (msgType) {
      case 'stream':
        codeCell.outputArea.model.add({
          output_type: 'stream',
          name: content.name,
          text: content.text
        });
        break;

      case 'error':
        codeCell.outputArea.model.add({
          output_type: 'error',
          ename: content.ename,
          evalue: content.evalue,
          traceback: content.traceback
        });
        break;

      case 'execute_result':
        codeCell.outputArea.model.add({
          output_type: 'execute_result',
          data: content.data,
          metadata: content.metadata,
          execution_count: content.execution_count
        });
        break;

      case 'display_data':
        codeCell.outputArea.model.add({
          output_type: 'display_data',
          data: content.data,
          metadata: content.metadata
        });
        break;

      // ── Step 6: Lifecycle Cleanup ─────────────────────────────────
      //
      // A `status: idle` message with our tracked msg_id means the
      // kernel finished executing this cell.  We:
      //   a) Set the cell's execution count  →  prompt changes [*] → [N]
      //   b) Remove the msg_id from the tracking map
      //   c) Disconnect from iopub when no busy cells remain

      case 'status':
        if (content.execution_state === 'idle') {
          if (record.executionCount !== null) {
            codeCell.model.executionCount = record.executionCount;
          }

          this._activeMsgIds.delete(parentMsgId);

          console.log(
            `[RestoreHandler] Cell[${record.cellIndex}] execution ` +
              `complete (exec count: ${record.executionCount}). ` +
              `${this._activeMsgIds.size} cell(s) still pending.`
          );

          if (this._activeMsgIds.size === 0) {
            console.log(
              '[RestoreHandler] All restored cells complete. ' +
                'Disconnecting iopub hook.'
            );
            this.dispose();
          }
        }
        break;

      default:
        break;
    }
  }
}
