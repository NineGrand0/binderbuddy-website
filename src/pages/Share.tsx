import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check } from 'lucide-react';
import { HomeAppShell } from '../components/Layout';
import { InteractiveBinder } from '../components/InteractiveBinder';
import { BinderCoverPreview } from '../components/BinderCoverPreview';
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
  const [selectedBinderId, setSelectedBinderId] = useState<string>('all');

  if (!user) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const accountUrl = `${origin}/u/${user.shareCode}`;
  const binderUrl =
    selectedBinderId !== 'all'
      ? `${origin}/u/${user.shareCode}/binder/${selectedBinderId}`
      : accountUrl;

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
            Friends scan your QR code to browse public binders with the same page-turn
            experience.
          </p>
        </div>
      </div>

        <div className="share-layout">
          <div className="panel" style={{ display: 'grid', gap: '1rem' }}>
            <div className="field">
              <label htmlFor="share-target">What to share</label>
              <select
                id="share-target"
                value={selectedBinderId}
                onChange={(e) => setSelectedBinderId(e.target.value)}
              >
                <option value="all">All public binders</option>
                {user.binders
                  .filter((b) => b.isPublic)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="qr-box">
              <QRCodeSVG value={binderUrl} size={200} level="M" includeMargin />
              <p>{binderUrl}</p>
            </div>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => copy(binderUrl, 'main')}
            >
              {copied === 'main' ? <Check size={16} /> : <Copy size={16} />}
              {copied === 'main' ? 'Copied' : 'Copy link'}
            </button>

            <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
                      Your share code: <strong style={{ color: '#171717' }}>{user.shareCode}</strong>
            </p>
          </div>

          <div>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '0.85rem' }}>Public binders</h2>
            {user.binders.filter((b) => b.isPublic).length === 0 ? (
              <div className="empty-state">
                Make a binder public from its detail page to share it.
              </div>
            ) : (
              <div className="grid-binders">
                {user.binders
                  .filter((b) => b.isPublic)
                  .map((b) => {
                    const url = `${origin}/u/${user.shareCode}/binder/${b.id}`;
                    return (
                      <div key={b.id} className="binder-tile" style={{ cursor: 'default' }}>
                        <BinderCoverPreview binder={b} />
                        <strong style={{ fontFamily: 'Outfit, var(--font-display)' }}>{b.name}</strong>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ justifySelf: 'start', padding: '0.4rem 0.75rem' }}
                          onClick={() => copy(url, b.id)}
                        >
                          {copied === b.id ? 'Copied' : 'Copy binder link'}
                        </button>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
    </HomeAppShell>
  );
}

export function PublicProfilePage() {
  const { code } = useParams();
  const { findUserByShareCode } = useStore();
  const owner = useMemo(
    () => (code ? findUserByShareCode(code) : null),
    [code, findUserByShareCode],
  );

  if (!owner) {
    return (
      <HomeAppShell>
        <div className="home-app-empty">Share link not found.</div>
      </HomeAppShell>
    );
  }

  const publicBinders = owner.binders.filter((b) => b.isPublic);

  return (
    <HomeAppShell>
      <div className="page-header">
        <div>
          <h1>{owner.displayName}&apos;s binders</h1>
          <p>Interactive view — flip pages just like the owner does.</p>
        </div>
      </div>
      {publicBinders.length === 0 ? (
        <div className="empty-state">No public binders yet.</div>
      ) : (
        <div className="grid-binders">
          {publicBinders.map((b) => {
            return (
              <Link
                key={b.id}
                to={`/u/${owner.shareCode}/binder/${b.id}`}
                className="binder-tile binder-tile__link"
              >
                <BinderCoverPreview binder={b} />
                <strong style={{ fontFamily: 'Outfit, var(--font-display)' }}>{b.name}</strong>
                <span className="muted" style={{ fontSize: '0.85rem' }}>
                  {b.pages.length} pages · {b.size}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </HomeAppShell>
  );
}

export function PublicBinderPage() {
  const { code, binderId } = useParams();
  const { findPublicBinder } = useStore();
  const result = useMemo(
    () => (code && binderId ? findPublicBinder(code, binderId) : null),
    [code, binderId, findPublicBinder],
  );

  if (!result) {
    return (
      <HomeAppShell>
        <div className="home-app-empty">This binder is private or the link is invalid.</div>
      </HomeAppShell>
    );
  }

  const { owner, binder } = result;

  return (
    <HomeAppShell wide>
      <div className="page-header">
        <div>
          <h1>{binder.name}</h1>
          <p>
            Shared by {owner.displayName}. Turn the pages — read-only view.
          </p>
        </div>
        <Link to={`/u/${owner.shareCode}`} className="home-app-cta">
          All binders
        </Link>
      </div>
      <InteractiveBinder
        binder={binder}
        collection={owner.collection}
        readOnly
      />
    </HomeAppShell>
  );
}
