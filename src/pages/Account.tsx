import { Link } from 'react-router-dom';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Smartphone, Trash2 } from 'lucide-react';
import type { PasskeyListItem } from '@supabase/supabase-js';
import { HomeAppShell } from '../components/Layout';
import { AuthenticatorSetup } from '../components/SecuritySetup';
import { RequireAuth } from './Dashboard';
import { useStore } from '../store/Store';
import { PREMIUM_PRICE_USD, userHasPremium } from '../types';

export function AccountPage() {
  return (
    <RequireAuth>
      <AccountInner />
    </RequireAuth>
  );
}

/** Passkeys and the authenticator app — both optional, both managed here. */
function SecurityPanel() {
  const { listPasskeys, registerPasskey, deletePasskey, hasAuthenticatorApp, disableAuthenticatorApp } = useStore();
  const [passkeys, setPasskeys] = useState<PasskeyListItem[] | null>(null);
  const [authenticator, setAuthenticator] = useState<boolean | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const passkeysSupported = typeof window !== 'undefined' && Boolean(window.PublicKeyCredential);

  const reload = useCallback(async () => {
    const [list, hasApp] = await Promise.all([listPasskeys(), hasAuthenticatorApp()]);
    if ('error' in list) {
      setPasskeys([]);
      setMessage(list.error);
    } else {
      setPasskeys(list);
    }
    setAuthenticator(hasApp);
  }, [listPasskeys, hasAuthenticatorApp]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function act(key: string, action: () => Promise<string | null>, success: string) {
    setBusy(key);
    setMessage(null);
    const err = await action();
    setBusy(null);
    setMessage(err ?? success);
    await reload();
  }

  return (
    <div className="panel security-panel">
      <h2 style={{ fontSize: '1.15rem' }}>Sign-in &amp; security</h2>

      <div className="security-row">
        <div>
          <strong>Passkeys</strong>
          <p className="muted">Sign in with your fingerprint, face or device PIN instead of a password.</p>
        </div>
        {passkeysSupported ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy !== null}
            onClick={() => void act('add-passkey', registerPasskey, 'Passkey added.')}
          >
            <KeyRound size={16} /> {busy === 'add-passkey' ? 'Waiting for your device…' : 'Add a passkey'}
          </button>
        ) : (
          <span className="muted">Not supported in this browser</span>
        )}
      </div>
      {passkeys && passkeys.length > 0 && (
        <ul className="security-list">
          {passkeys.map((key) => (
            <li key={key.id}>
              <span>
                {key.friendly_name || 'Passkey'}
                <small className="muted">
                  {' '}
                  · added {new Date(key.created_at).toLocaleDateString()}
                  {key.last_used_at ? ` · last used ${new Date(key.last_used_at).toLocaleDateString()}` : ''}
                </small>
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy !== null}
                onClick={() => {
                  if (confirm('Remove this passkey? You won’t be able to sign in with it any more.')) {
                    void act(`del-${key.id}`, () => deletePasskey(key.id), 'Passkey removed.');
                  }
                }}
              >
                <Trash2 size={14} /> Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="security-row">
        <div>
          <strong>Authenticator app</strong>
          <p className="muted">
            {authenticator
              ? 'On — you enter a 6-digit code after your password.'
              : 'Off — add a 6-digit code from your phone after your password.'}
          </p>
        </div>
        {authenticator === false && !settingUp && (
          <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => setSettingUp(true)}>
            <Smartphone size={16} /> Set up
          </button>
        )}
        {authenticator && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy !== null}
            onClick={() => {
              if (confirm('Turn off the authenticator app? Your password alone will open this account.')) {
                void act('disable-app', disableAuthenticatorApp, 'Authenticator app turned off.');
              }
            }}
          >
            {busy === 'disable-app' ? 'Turning off…' : 'Turn off'}
          </button>
        )}
      </div>
      {settingUp && (
        <AuthenticatorSetup
          onCancel={() => setSettingUp(false)}
          onDone={() => {
            setSettingUp(false);
            setMessage('Authenticator app turned on.');
            void reload();
          }}
        />
      )}
      {message && (
        <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
          {message}
        </p>
      )}
    </div>
  );
}

function AccountInner() {
  const { user, updateProfile } = useStore();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!user) return null;

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const note = await updateProfile({ displayName, email });
    setBusy(false);
    setMessage(note);
    // An email change waits on confirmation, so show the saved address until it goes through
    if (note) setEmail(user!.email);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }

  return (
    <HomeAppShell>
      <div className="page-header">
        <div>
          <h1>Account</h1>
          <p>Manage your profile and share identity.</p>
        </div>
      </div>

      <div className="account-grid">
        <form className="panel" style={{ display: 'grid', gap: '0.9rem' }} onSubmit={(e) => void onSave(e)}>
          <h2 style={{ fontSize: '1.15rem' }}>Profile</h2>
          <div className="field">
            <label htmlFor="displayName">Display name</label>
            <input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ justifySelf: 'start' }} disabled={busy}>
            {busy ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
          </button>
          {message && (
            <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
              {message}
            </p>
          )}
        </form>

        <SecurityPanel />

        <div className="panel" style={{ display: 'grid', gap: '0.75rem' }}>
          <h2 style={{ fontSize: '1.15rem' }}>Sharing</h2>
          <p className="muted" style={{ margin: 0 }}>
            Share binders one at a time with a private link. Anyone with a binder’s link can view
            it, and you can turn sharing off or replace the link from the binder page.
          </p>
          <div
            style={{
              fontFamily: 'Outfit, var(--font-display)',
              fontSize: '1.8rem',
            }}
          >
            {user.binders.filter((b) => b.share).length} shared
          </div>
          <Link to="/share" className="btn btn-secondary" style={{ justifySelf: 'start' }}>
            Manage shared binders
          </Link>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            {user.collection.length} cards in collection · {user.binders.length} binders
            {user.role === 'admin' ? ' · Admin' : ''}
          </p>
        </div>

        <div className="panel" style={{ display: 'grid', gap: '0.75rem' }}>
          <h2 style={{ fontSize: '1.15rem' }}>Premium</h2>
          {userHasPremium(user) ? (
            <>
              <p className="muted" style={{ margin: 0 }}>
                Auto cropping and card detection are unlocked on this account.
              </p>
              <Link to="/premium" className="btn btn-secondary" style={{ justifySelf: 'start' }}>
                View Premium
              </Link>
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: 0 }}>
                One-time ${PREMIUM_PRICE_USD} for auto cropping and automatic card information detection.
              </p>
              <Link to="/premium" className="btn btn-primary" style={{ justifySelf: 'start' }}>
                Get Premium
              </Link>
            </>
          )}
        </div>
      </div>
    </HomeAppShell>
  );
}
