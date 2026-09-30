import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, ExternalLink, Link2, Loader2, QrCode, RefreshCw } from 'lucide-react';
import { useStore } from '../store/Store';
import type { Binder, Card } from '../types';
import {
  buildShareSnapshot,
  createShareLink,
  disableShareLink,
  regenerateShareLink,
  shareUrl,
  ShareApiError,
} from '../lib/shareClient';
import { forgetShare, markSent, requestResync, snapshotKey, useShareStatus } from '../lib/shareSync';

type Props = {
  binder: Binder;
  collection: Card[];
  ownerName: string;
};

type Busy = 'create' | 'regenerate' | 'disable' | null;

export function BinderSharePanel({ binder, collection, ownerName }: Props) {
  const { updateBinder } = useStore();
  const share = binder.share;
  const status = useShareStatus(share?.shareId);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const url = share ? shareUrl(share.token) : '';

  async function run(kind: Exclude<Busy, null>, task: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  function createLink() {
    return run('create', async () => {
      const snapshot = buildShareSnapshot(binder, collection, ownerName);
      const created = await createShareLink(snapshot);
      if (share) forgetShare(share.shareId);
      markSent(created.shareId, snapshotKey(snapshot));
      updateBinder(binder.id, { share: created });
    });
  }

  function regenerate() {
    if (!share) return;
    if (!confirm('Create a new link? The current link will stop working for anyone who has it.')) return;
    void run('regenerate', async () => {
      const token = await regenerateShareLink(share);
      updateBinder(binder.id, { share: { ...share, token } });
      setCopied(false);
    });
  }

  function stopSharing() {
    if (!share) return;
    if (!confirm('Stop sharing this binder? The link will stop working for anyone who has it.')) return;
    void run('disable', async () => {
      try {
        await disableShareLink(share);
      } catch (err) {
        const gone = err instanceof ShareApiError && (err.status === 404 || err.status === 403);
        if (!gone) throw err;
      }
      forgetShare(share.shareId);
      updateBinder(binder.id, { share: undefined });
      setShowQr(false);
    });
  }

  function copy() {
    void navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const sharePrices = binder.sharePrices !== false;
  const pricesToggle = (
    <label className="binder-share__toggle">
      <input
        type="checkbox"
        role="switch"
        checked={sharePrices}
        onChange={(e) => updateBinder(binder.id, { sharePrices: e.target.checked })}
      />
      <span>
        <strong>Show prices to guests</strong>
        <span className="muted">
          {sharePrices
            ? 'Guests see card prices, the binder total and the price graph.'
            : 'Card prices, the binder total and the price graph stay private.'}
        </span>
      </span>
    </label>
  );

  if (!share) {
    return (
      <section id="binder-share" className="panel binder-share" aria-labelledby="binder-share-title">
        <div className="binder-share__head">
          <div>
            <strong id="binder-share-title">Share this binder</strong>
            <p className="muted">
              Create a private link. Guests can flip pages and view cards without signing in.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null}
            onClick={() => void createLink()}
          >
            {busy === 'create' ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />}
            Create share link
          </button>
        </div>
        {pricesToggle}
        {error && <p className="form-error">{error}</p>}
      </section>
    );
  }

  return (
    <section id="binder-share" className="panel binder-share" aria-labelledby="binder-share-title">
      <div className="binder-share__head">
        <div>
          <strong id="binder-share-title">Sharing on</strong>
          <p className="binder-share__notice">Anyone with this link can view your binder.</p>
        </div>
        <ShareStatusBadge status={status} onRetry={() => requestResync(share.shareId)} />
      </div>

      {status?.state === 'missing' ? (
        <div className="binder-share__missing">
          <p className="muted">This link no longer works. Create a new one to keep sharing.</p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null}
            onClick={() => void createLink()}
          >
            {busy === 'create' ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />}
            Create new link
          </button>
        </div>
      ) : (
        <>
          <div className="binder-share__link">
            <input
              readOnly
              value={url}
              aria-label="Share link"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="btn btn-secondary" onClick={copy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer noopener">
              <ExternalLink size={16} />
              Open
            </a>
            <button
              type="button"
              className="btn btn-ghost"
              aria-expanded={showQr}
              onClick={() => setShowQr((v) => !v)}
            >
              <QrCode size={16} />
              QR
            </button>
          </div>
          {showQr && (
            <div className="qr-box binder-share__qr">
              <QRCodeSVG value={url} size={180} level="M" includeMargin />
            </div>
          )}
        </>
      )}

      {pricesToggle}

      <p className="muted binder-share__fine">
        Guests see card names, sets, numbers, rarity, condition and images
        {sharePrices ? ', plus prices' : ''}. Your saved changes appear on the link automatically.
      </p>

      <div className="binder-share__actions">
        <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={regenerate}>
          {busy === 'regenerate' ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
          Regenerate link
        </button>
        <button type="button" className="btn btn-danger" disabled={busy !== null} onClick={stopSharing}>
          {busy === 'disable' && <Loader2 size={16} className="spin" />}
          Stop sharing
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}

function ShareStatusBadge({
  status,
  onRetry,
}: {
  status: ReturnType<typeof useShareStatus>;
  onRetry: () => void;
}) {
  if (!status || status.state === 'synced') {
    return <span className="binder-share__status is-ok">Up to date</span>;
  }
  if (status.state === 'syncing') {
    return (
      <span className="binder-share__status">
        <Loader2 size={14} className="spin" /> Updating link…
      </span>
    );
  }
  if (status.state === 'missing') {
    return <span className="binder-share__status is-error">Link unavailable</span>;
  }
  return (
    <span className="binder-share__status is-error" title={status.message}>
      Not updated
      <button type="button" className="binder-share__retry" onClick={onRetry}>
        Retry
      </button>
    </span>
  );
}
