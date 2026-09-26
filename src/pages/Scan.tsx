import { useState } from 'react';
import { HomeAppShell } from '../components/Layout';
import { PageScanFlow } from '../components/PageScanFlow';
import { RequireAuth } from './Dashboard';
import { useStore } from '../store/Store';

type Mode = 'page' | 'card';

export function ScanPage() {
  return (
    <RequireAuth>
      <ScanInner />
    </RequireAuth>
  );
}

function ScanInner() {
  const { user } = useStore();
  const [mode, setMode] = useState<Mode>('card');

  if (!user) return null;

  return (
    <HomeAppShell>
      <div className="page-header">
        <div>
          <h1>Scan &amp; upload</h1>
          <p>
            Upload one card or a binder page. Adjust crops, fill in details, then save to your
            collection. Binder placement stays manual.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`btn ${mode === 'card' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setMode('card')}
        >
          Single card
        </button>
        <button
          type="button"
          className={`btn ${mode === 'page' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setMode('page')}
        >
          Full binder page
        </button>
      </div>

      <PageScanFlow
        key={mode}
        mode={mode}
        defaultCols={mode === 'card' ? 1 : 3}
        defaultRows={mode === 'card' ? 1 : 3}
      />
    </HomeAppShell>
  );
}
