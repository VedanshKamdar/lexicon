import { useRef, useState } from 'react';
import { downloadBackup, restoreBackup } from '../db/backup';
import type { SyncState } from '../hooks/useSync';

function ago(at: number): string {
  if (!at) return 'never';
  const mins = Math.floor((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; message: string } | { kind: 'error'; message: string };

export function BackupControls({
  sync,
  onSyncNow,
}: {
  sync: SyncState;
  onSyncNow: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function onExport() {
    setStatus({ kind: 'busy' });
    try {
      const count = await downloadBackup();
      setStatus({ kind: 'done', message: `Exported ${count} ${count === 1 ? 'word' : 'words'}.` });
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message });
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset immediately so picking the same file twice still fires a change event.
    e.target.value = '';
    if (!file) return;

    setStatus({ kind: 'busy' });
    try {
      const r = await restoreBackup(await file.text());
      setStatus({
        kind: 'done',
        message: `Added ${r.added}, updated ${r.updated}, already current ${r.skipped}.`,
      });
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    }
  }

  return (
    <div className="mt-6 border-t border-rule pt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          onClick={() => void onExport()}
          disabled={status.kind === 'busy'}
          className="text-[12px] text-ink-3 hover:text-ink disabled:opacity-50"
        >
          Export backup
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={status.kind === 'busy'}
          className="text-[12px] text-ink-3 hover:text-ink disabled:opacity-50"
        >
          Restore from file
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          onChange={(e) => void onFile(e)}
          className="hidden"
        />

        {sync.status !== 'disabled' && (
          <button
            onClick={onSyncNow}
            disabled={sync.status === 'syncing'}
            className="text-[12px] text-ink-3 hover:text-ink disabled:opacity-50"
          >
            {sync.status === 'syncing' ? 'Syncing…' : 'Sync now'}
          </button>
        )}
      </div>

      {sync.status === 'idle' && (
        <p className="mt-2 text-[11px] text-ink-3">Synced {ago(sync.at)}</p>
      )}
      {sync.status === 'error' && (
        <p className="mt-2 text-[11px] text-warn">Sync failed — {sync.message}</p>
      )}

      {status.kind === 'done' && (
        <p className="mt-2 text-[12px] text-ink-2">{status.message}</p>
      )}
      {status.kind === 'error' && (
        <p className="mt-2 text-[12px] text-warn">{status.message}</p>
      )}
    </div>
  );
}
