import { Link } from 'react-router-dom';
import { useState, type FormEvent } from 'react';
import { HomeAppShell } from '../components/Layout';
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

function AccountInner() {
  const { user, updateProfile } = useStore();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [saved, setSaved] = useState(false);

  if (!user) return null;

  function onSave(e: FormEvent) {
    e.preventDefault();
    updateProfile({ displayName, email });
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
        <form className="panel" style={{ display: 'grid', gap: '0.9rem' }} onSubmit={onSave}>
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
          <button type="submit" className="btn btn-primary" style={{ justifySelf: 'start' }}>
            {saved ? 'Saved' : 'Save changes'}
          </button>
        </form>

        <div className="panel" style={{ display: 'grid', gap: '0.75rem' }}>
          <h2 style={{ fontSize: '1.15rem' }}>Sharing</h2>
          <p className="muted" style={{ margin: 0 }}>
            Friends use your share code or QR to open public binders.
          </p>
          <div
            style={{
              fontFamily: 'Outfit, var(--font-display)',
              fontSize: '1.8rem',
              letterSpacing: '0.12em',
            }}
          >
            {user.shareCode}
          </div>
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
