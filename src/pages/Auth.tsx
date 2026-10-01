import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { KeyRound, Smartphone } from 'lucide-react';
import { HomeMarketingNav } from '../components/Layout';
import { AuthenticatorSetup, CodeField } from '../components/SecuritySetup';
import { useStore } from '../store/Store';
import { HeroArt } from './Landing';

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="home home-auth">
      <HomeMarketingNav />
      <div className="home-body">
        <section className="home-auth-stage">
          <div className="home-auth-art" aria-hidden>
            <HeroArt compact />
          </div>
          <div className="home-auth-card">{children}</div>
        </section>
      </div>
    </div>
  );
}

/** Shown once after a password sign-in: add a passkey, add an authenticator app, or skip. */
function ProtectAccount() {
  const { registerPasskey, skipMfaSetup, logout, pendingEmail } = useStore();
  const [mode, setMode] = useState<'choose' | 'authenticator'>('choose');
  const [busy, setBusy] = useState<'passkey' | 'skip' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const passkeysSupported = typeof window !== 'undefined' && Boolean(window.PublicKeyCredential);

  async function run(kind: 'passkey' | 'skip', action: () => Promise<string | null>) {
    setBusy(kind);
    setError(null);
    const err = await action();
    setBusy(null);
    if (err) setError(err);
  }

  return (
    <>
      <h1>Protect your account</h1>
      <p>
        Add a second step so a stolen password alone can’t open your collection. It’s optional —
        you can also do this later from your Account page.
      </p>
      {pendingEmail && <p className="home-auth-hint">Signed in as {pendingEmail}</p>}
      {mode === 'authenticator' ? (
        <AuthenticatorSetup onCancel={() => setMode('choose')} />
      ) : (
        <div className="protect-options">
          {passkeysSupported && (
            <button
              type="button"
              className="protect-option"
              disabled={busy !== null}
              onClick={() => void run('passkey', registerPasskey)}
            >
              <KeyRound size={20} />
              <span>
                <strong>{busy === 'passkey' ? 'Waiting for your device…' : 'Add a passkey'}</strong>
                <small>Sign in with your fingerprint, face or device PIN — no password or code needed.</small>
              </span>
            </button>
          )}
          <button
            type="button"
            className="protect-option"
            disabled={busy !== null}
            onClick={() => setMode('authenticator')}
          >
            <Smartphone size={20} />
            <span>
              <strong>Use an authenticator app</strong>
              <small>Enter a 6-digit code from your phone after your password.</small>
            </span>
          </button>
          {error && <p className="form-error">{error}</p>}
          <button
            type="button"
            className="btn btn-ghost protect-skip"
            disabled={busy !== null}
            onClick={() => void run('skip', skipMfaSetup)}
          >
            {busy === 'skip' ? 'Skipping…' : 'Skip for now'}
          </button>
        </div>
      )}
      <p className="home-auth-foot">
        Not you? <button type="button" className="mfa-link" onClick={() => void logout()}>Sign out</button>
      </p>
    </>
  );
}

function MfaVerify() {
  const { verifyMfa, logout, pendingEmail, signInWithPasskey } = useStore();
  const passkeysSupported = typeof window !== 'undefined' && Boolean(window.PublicKeyCredential);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const err = await verifyMfa(code);
    setBusy(false);
    if (err) {
      setError(err);
      setCode('');
    }
  }

  return (
    <>
      <h1>Enter your code</h1>
      <p>Open your authenticator app and enter the current 6-digit code for BinderBuddy.</p>
      {pendingEmail && <p className="home-auth-hint">Signing in as {pendingEmail}</p>}
      <form onSubmit={(e) => void onSubmit(e)}>
        <CodeField value={code} onChange={setCode} />
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="home-auth-submit" disabled={busy}>
          {busy ? 'Checking…' : 'Verify & log in'}
        </button>
      </form>
      {passkeysSupported && (
        <p className="home-auth-foot">
          <button
            type="button"
            className="mfa-link"
            disabled={busy}
            onClick={() =>
              void signInWithPasskey().then((err) => {
                if (err) setError(err);
              })
            }
          >
            Use a passkey instead
          </button>
        </p>
      )}
      <p className="home-auth-foot">
        Lost your phone? Contact support to reset two-factor.{' '}
        <button type="button" className="mfa-link" onClick={() => void logout()}>Sign out</button>
      </p>
    </>
  );
}

function PasswordLogin() {
  const { login, signInWithPasskey } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'password' | 'passkey' | null>(null);
  const passkeysSupported = typeof window !== 'undefined' && Boolean(window.PublicKeyCredential);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy('password');
    const err = await login(email, password);
    setBusy(null);
    if (err) setError(err);
  }

  async function onPasskey() {
    setBusy('passkey');
    setError(null);
    const err = await signInWithPasskey();
    setBusy(null);
    if (err) setError(err);
  }

  return (
    <>
      <h1>Welcome back</h1>
      <p>Log in to open your binders and collection.</p>
      {passkeysSupported && (
        <>
          <button
            type="button"
            className="home-auth-submit home-auth-passkey"
            disabled={busy !== null}
            onClick={() => void onPasskey()}
          >
            <KeyRound size={18} /> {busy === 'passkey' ? 'Waiting for your device…' : 'Sign in with a passkey'}
          </button>
          <p className="home-auth-divider">
            <span>or use your password</span>
          </p>
        </>
      )}
      <form onSubmit={(e) => void onSubmit(e)}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="home-auth-submit" disabled={busy !== null}>
          {busy === 'password' ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="home-auth-foot">
        New here? <Link to="/signup">Create an account</Link>
      </p>
    </>
  );
}

export function LoginPage() {
  const { authStage } = useStore();
  if (authStage === 'signed-in') return <Navigate to="/dashboard" replace />;
  return (
    <AuthLayout>
      {authStage === 'loading' ? (
        <p className="muted">Loading…</p>
      ) : authStage === 'mfa-enroll' ? (
        <ProtectAccount />
      ) : authStage === 'mfa-verify' ? (
        <MfaVerify />
      ) : (
        <PasswordLogin />
      )}
    </AuthLayout>
  );
}

export function SignupPage() {
  const { authStage, signup } = useStore();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (authStage === 'signed-in') return <Navigate to="/dashboard" replace />;
  if (authStage === 'mfa-enroll' || authStage === 'mfa-verify') return <Navigate to="/login" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const err = await signup(email, password, displayName);
    setBusy(false);
    if (err) setError(err);
    else setSentTo(email.trim());
  }

  if (sentTo) {
    return (
      <AuthLayout>
        <h1>Check your email</h1>
        <p>
          We sent a confirmation link to <strong>{sentTo}</strong>. Open it, then log in — you’ll be
          offered a passkey or authenticator app to protect the account (or you can skip it).
        </p>
        <p className="home-auth-foot">
          Already confirmed? <Link to="/login">Log in</Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1>Create your account</h1>
      <p>You’ll confirm your email, then can add a passkey or authenticator app for extra protection.</p>
      <form onSubmit={(e) => void onSubmit(e)}>
        <div className="field">
          <label htmlFor="name">Display name</label>
          <input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="home-auth-submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="home-auth-foot">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </AuthLayout>
  );
}
