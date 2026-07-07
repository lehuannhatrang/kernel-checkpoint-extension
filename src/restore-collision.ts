/**
 * Restore collision planning.
 *
 * A CRIU-restored kernel always re-announces itself to Jupyter Enterprise
 * Gateway under the kernel id it was checkpointed with (that id is frozen in
 * the launcher's process memory). Therefore at most one live kernel may hold
 * that id at any time. This helper decides how to proceed when a kernel with
 * the checkpoint's id is already running.
 */
export type RestorePlan =
  | { action: 'create' }
  | { action: 'replace' }
  | { action: 'refuse'; conflictKernelId: string };

/**
 * Decide how to restore given the currently running kernels.
 *
 * - `create`  — no kernel holds the checkpoint id; create it directly.
 * - `replace` — the checkpoint id is held by the notebook's own current kernel
 *               (a revert). The caller should confirm, shut it down, recreate.
 * - `refuse`  — the checkpoint id is held by a different kernel (e.g. another
 *               notebook already restored this checkpoint). Concurrent restore
 *               of the same checkpoint is unsupported under the current
 *               launcher because both pods would announce the same id.
 */
export function planRestore(
  runningKernelIds: readonly string[],
  checkpointKernelId: string,
  currentKernelId: string | undefined
): RestorePlan {
  if (!runningKernelIds.includes(checkpointKernelId)) {
    return { action: 'create' };
  }
  if (currentKernelId && currentKernelId === checkpointKernelId) {
    return { action: 'replace' };
  }
  return { action: 'refuse', conflictKernelId: checkpointKernelId };
}
