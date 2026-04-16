import React, { useState, useEffect, useCallback } from 'react';
import { ICheckpoint, ICheckpointPanelProps } from './types';
import { CheckpointAPI } from './api';

const CHECKPOINT_REFRESH_INTERVAL = 3;

function mapPhaseDisplay(phase: string): string {
  return phase === 'Completed' ? 'Ready' : 'Pending';
}

function PhaseIndicator({ phase }: { phase: string }): JSX.Element {
  const display = mapPhaseDisplay(phase);
  const cls = display.toLowerCase().replace(/\s+/g, '-');
  return <span className={`kc-phase kc-phase-${cls}`}>{display}</span>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function CheckpointPanel(props: ICheckpointPanelProps): JSX.Element {
  const { namespace, kernelId, kernelSpecName, notebookName, onRestore } = props;

  const [checkpoints, setCheckpoints] = useState<ICheckpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const [restoring, setRestoring] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<ICheckpoint | null>(null);

  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [flash, setFlash] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

  /* ------------------------------------------------------------------ */
  /*  Data fetching                                                      */
  /* ------------------------------------------------------------------ */

  const fetchCheckpoints = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await CheckpointAPI.listCheckpoints(namespace);
      setCheckpoints(result.items ?? []);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load checkpoints');
    } finally {
      setLoading(false);
    }
  }, [namespace]);

  useEffect(() => {
    fetchCheckpoints();
  }, [fetchCheckpoints]);

  useEffect(() => {
    const id = setInterval(fetchCheckpoints, CHECKPOINT_REFRESH_INTERVAL * 1000);
    return () => clearInterval(id);
  }, [fetchCheckpoints]);

  /* ------------------------------------------------------------------ */
  /*  Actions                                                            */
  /* ------------------------------------------------------------------ */

  const handleCreate = async () => {
    if (!newName.trim()) {
      return;
    }
    setCreating(true);
    setFlash(null);
    try {
      await CheckpointAPI.createCheckpoint({
        name: newName.trim(),
        namespace,
        kernelId,
        buildImage: false,
        metadata: {
          kernelId,
          kernelName: kernelSpecName,
          notebookName
        }
      });
      setNewName('');
      setShowCreateForm(false);
      setFlash({ type: 'success', text: 'Checkpoint created successfully.' });
      await fetchCheckpoints();
    } catch (err: any) {
      setFlash({
        type: 'error',
        text: err.message ?? 'Failed to create checkpoint'
      });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (name: string) => {
    setFlash(null);
    setConfirmDelete(null);
    try {
      await CheckpointAPI.deleteCheckpoint(namespace, name);
      setFlash({ type: 'success', text: `Checkpoint "${name}" deleted.` });
      if (expandedDetail === name) {
        setExpandedDetail(null);
        setDetailData(null);
      }
      await fetchCheckpoints();
    } catch (err: any) {
      setFlash({
        type: 'error',
        text: err.message ?? 'Failed to delete checkpoint'
      });
    }
  };

  const handleViewStatus = async (name: string) => {
    if (expandedDetail === name) {
      setExpandedDetail(null);
      setDetailData(null);
      return;
    }
    try {
      const detail = await CheckpointAPI.getCheckpoint(namespace, name);
      setDetailData(detail);
      setExpandedDetail(name);
    } catch (err: any) {
      setFlash({
        type: 'error',
        text: err.message ?? 'Failed to get checkpoint details'
      });
    }
  };

  const handleRestore = async (checkpointName: string) => {
    setConfirmRestore(null);
    setRestoring(checkpointName);
    setFlash(null);
    try {
      const detail = await CheckpointAPI.getCheckpoint(namespace, checkpointName);
      const checkpointFile = detail.checkpointFiles?.[0];
      if (!checkpointFile?.storagePath) {
        throw new Error('No checkpoint file path available for this checkpoint');
      }
      const cpKernelId = detail.metadata?.kernelId ?? '';
      if (!cpKernelId) {
        throw new Error('No kernel ID found in checkpoint metadata');
      }
      await onRestore(checkpointName, checkpointFile.storagePath, checkpointFile.containerName, cpKernelId);
      setFlash({
        type: 'success',
        text: `Kernel restored from "${checkpointName}". The kernel is restarting.`
      });
    } catch (err: any) {
      setFlash({
        type: 'error',
        text: err.message ?? 'Failed to restore checkpoint'
      });
    } finally {
      setRestoring(null);
    }
  };

  const handleRename = async (oldName: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === oldName) {
      setRenamingName(null);
      return;
    }
    setFlash(null);
    try {
      await CheckpointAPI.updateCheckpoint(namespace, oldName, {
        name: trimmed
      });
      setRenamingName(null);
      setFlash({ type: 'success', text: `Checkpoint renamed to "${trimmed}".` });
      await fetchCheckpoints();
    } catch (err: any) {
      setFlash({
        type: 'error',
        text: err.message ?? 'Failed to rename checkpoint'
      });
    }
  };

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <div className="kc-panel">
      {/* Flash message */}
      {flash && (
        <div className={`kc-flash kc-flash-${flash.type}`}>
          <span>{flash.text}</span>
          <button
            className="kc-flash-close"
            onClick={() => setFlash(null)}
          >
            &times;
          </button>
        </div>
      )}

      {/* Create checkpoint */}
      <div className="kc-create-section">
        {!showCreateForm ? (
          <button
            className="kc-btn kc-btn-primary"
            onClick={() => setShowCreateForm(true)}
          >
            Save Kernel State
          </button>
        ) : (
          <div className="kc-create-form">
            <input
              className="kc-input"
              type="text"
              placeholder="Enter checkpoint name…"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleCreate();
                }
              }}
              autoFocus
              disabled={creating}
            />
            <button
              className="kc-btn kc-btn-primary"
              disabled={creating || !newName.trim()}
              onClick={handleCreate}
            >
              {creating ? 'Saving…' : 'Save'}
            </button>
            <button
              className="kc-btn"
              onClick={() => {
                setShowCreateForm(false);
                setNewName('');
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Checkpoint list */}
      <div className="kc-list">
        {loading && checkpoints.length === 0 ? (
          <div className="kc-placeholder">Loading checkpoints…</div>
        ) : error ? (
          <div className="kc-placeholder kc-placeholder-error">{error}</div>
        ) : checkpoints.length === 0 ? (
          <div className="kc-placeholder">
            No checkpoints found. Click &ldquo;Save Kernel State&rdquo; to
            create one.
          </div>
        ) : (
          checkpoints.map(cp => (
            <div key={cp.name} className="kc-item">
              {/* Header row */}
              <div className="kc-item-header">
                <div className="kc-item-info">
                  {renamingName === cp.name ? (
                    <div className="kc-rename-form">
                      <input
                        className="kc-input kc-input-sm"
                        type="text"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            handleRename(cp.name);
                          }
                          if (e.key === 'Escape') {
                            setRenamingName(null);
                          }
                        }}
                        autoFocus
                      />
                      <button
                        className="kc-btn kc-btn-xs"
                        onClick={() => handleRename(cp.name)}
                      >
                        OK
                      </button>
                      <button
                        className="kc-btn kc-btn-xs"
                        onClick={() => setRenamingName(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <span className="kc-item-name" title={cp.name}>
                      {cp.name}
                    </span>
                  )}
                  <div className="kc-item-meta">
                    <PhaseIndicator phase={cp.phase} />
                    <span className="kc-item-date">
                      {formatDate(cp.createdAt)}
                    </span>
                  </div>
                </div>

                <div className="kc-item-actions">
                  <button
                    className="kc-btn kc-btn-xs"
                    onClick={() => handleViewStatus(cp.name)}
                  >
                    {expandedDetail === cp.name ? 'Hide' : 'Details'}
                  </button>
                  <button
                    className="kc-btn kc-btn-xs"
                    onClick={() => {
                      setRenamingName(cp.name);
                      setRenameValue(cp.name);
                    }}
                  >
                    Rename
                  </button>
                  {confirmDelete === cp.name ? (
                    <>
                      <span className="kc-confirm-label">Delete?</span>
                      <button
                        className="kc-btn kc-btn-xs kc-btn-danger"
                        onClick={() => handleDelete(cp.name)}
                      >
                        Yes
                      </button>
                      <button
                        className="kc-btn kc-btn-xs"
                        onClick={() => setConfirmDelete(null)}
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <button
                      className="kc-btn kc-btn-xs kc-btn-danger"
                      onClick={() => setConfirmDelete(cp.name)}
                    >
                      Delete
                    </button>
                  )}
                  {confirmRestore === cp.name ? (
                    <>
                      <span className="kc-confirm-label">Restore?</span>
                      <button
                        className="kc-btn kc-btn-xs kc-btn-restore"
                        onClick={() => handleRestore(cp.name)}
                      >
                        Yes
                      </button>
                      <button
                        className="kc-btn kc-btn-xs"
                        onClick={() => setConfirmRestore(null)}
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <button
                      className="kc-btn kc-btn-xs kc-btn-restore"
                      disabled={
                        restoring !== null || cp.phase !== 'Completed'
                      }
                      title={
                        cp.phase !== 'Completed'
                          ? 'Checkpoint must be completed to restore'
                          : 'Restore from this checkpoint'
                      }
                      onClick={() => setConfirmRestore(cp.name)}
                    >
                      {restoring === cp.name ? 'Restoring…' : 'Restore'}
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded detail */}
              {expandedDetail === cp.name && detailData && (
                <div className="kc-detail">
                  <div className="kc-detail-row">
                    <span className="kc-detail-label">Status</span>
                    <span>{mapPhaseDisplay(detailData.phase)}</span>
                  </div>
                  <div className="kc-detail-row">
                    <span className="kc-detail-label">Message</span>
                    <span>{detailData.message}</span>
                  </div>
                  {detailData.podRef && (
                    <div className="kc-detail-row">
                      <span className="kc-detail-label">Pod</span>
                      <span>{detailData.podRef.name}</span>
                    </div>
                  )}
                  {detailData.checkpointFiles &&
                    detailData.checkpointFiles.length > 0 && (
                      <div className="kc-detail-section">
                        <span className="kc-detail-label">
                          Checkpoint Files
                        </span>
                        {detailData.checkpointFiles.map((f, i) => (
                          <div key={i} className="kc-detail-file">
                            <span>{f.containerName}</span>
                            <span className="kc-detail-time">
                              {formatDate(f.checkpointTime)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  {detailData.builtImages &&
                    detailData.builtImages.length > 0 && (
                      <div className="kc-detail-section">
                        <span className="kc-detail-label">Built Images</span>
                        {detailData.builtImages.map((img, i) => (
                          <div key={i} className="kc-detail-file">
                            <span className="kc-detail-image-name">
                              {img.imageName}
                            </span>
                            <span className="kc-detail-time">
                              {formatDate(img.buildTime)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

    </div>
  );
}
