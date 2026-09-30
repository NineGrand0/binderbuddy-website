import { useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check } from 'lucide-react';
import { HomeAppShell } from '../components/Layout';
import { BinderCoverPreview } from '../components/BinderCoverPreview';
import { shareUrl } from '../lib/shareClient';
import { RequireAuth } from './Dashboard';
import { useStore } from '../store/Store';

export function SharePage() {
  return (
    <RequireAuth>
      <ShareInner />
    </RequireAuth>
  );
}

function ShareInner() {
  const { user } = useStore();
  const [copied, setCopied] = useState<string | null>(null);

  if (!user) return null;

  const shared = user.binders.filter((b) => b.share);

  function copy(url: string, key: string) {
    void navigator.clipboard.writeText(url);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1600);
  }

  return (
    <HomeAppShell>
      <div className="page-header">
        <div>
          <h1>Share</h1>
          <p>
            Each shared binder has its own private link. Anyone with a link can view that binder,
            with no sign-in needed.
          </p>
        </div>
      </div>

      {shared.length === 0 ? (
        <div className="empty-state">
          <p style={{ margin: '0 0 1rem' }}>You haven’t shared any binders yet.</p>
          {user.binders.length > 0 ? (
            <p style={{ margin: 0 }}>
              Open a binder and choose <strong>Create share link</strong>:{' '}
              {user.binders.map((b, i) => (
                <span key={b.id}>
                  {i > 0 && ' · '}
                  <Link to={`/binder/${b.id}`}>{b.name}</Link>
                </span>
              ))}
            </p>
          ) : (
            <Link to="/dashboard" className="btn btn-primary">
              Create a binder
            </Link>
          )}
        </div>
      ) : (
        <div className="grid-binders">
          {shared.map((b) => {
            const url = shareUrl(b.share!.token);
            return (
              <div key={b.id} className="binder-tile share-tile" style={{ cursor: 'default' }}>
                <BinderCoverPreview binder={b} />
                <strong style={{ fontFamily: 'Outfit, var(--font-display)' }}>{b.name}</strong>
                <p className="muted share-tile__notice">Anyone with this link can view your binder.</p>
                <div className="qr-box">
                  <QRCodeSVG value={url} size={160} level="M" includeMargin />
                </div>
                <div className="share-tile__actions">
                  <button type="button" className="btn btn-secondary" onClick={() => copy(url, b.id)}>
                    {copied === b.id ? <Check size={16} /> : <Copy size={16} />}
                    {copied === b.id ? 'Copied' : 'Copy link'}
                  </button>
                  <Link to={`/binder/${b.id}`} className="btn btn-ghost">
                    Manage
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </HomeAppShell>
  );
}
