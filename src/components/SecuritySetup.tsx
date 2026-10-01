import { useEffect, useState, type FormEvent } from 'react';
import { useStore, type MfaEnrollment } from '../store/Store';

/** Six-digit authenticator code field; strips spaces people paste in. */
export function CodeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label htmlFor="mfa-code">6-digit code</label>
      <input
        id="mfa-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d ]/g, ''))}
        required
        autoFocus
      />
    </div>
  );
}

/** QR code + first code: adds an authenticator app as this account's second factor. */
export function AuthenticatorSetup({ onDone, onCancel }: { onDone?: () => void; onCancel?: () => void }) {
  const { startMfaEnrollment, verifyMfa } = useStore();
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void startMfaEnrollment().then((result) => {
      if (cancelled) return;
      if ('error' in result) setError(result.error);
      else setEnrollment(result);
    });
    return () => {
      cancelled = true;
    };
  }, [startMfaEnrollment]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!enrollment) return;
    setBusy(true);
    const err = await verifyMfa(code, enrollment.factorId);
    setBusy(false);
    if (err) setError(err);
    else onDone?.();
  }

  if (!enrollment) {
    return (
      <div className="mfa-setup">
        {error ? <p className="form-error">{error}</p> : <p className="muted">Preparing your QR code…</p>}
        {onCancel && (
          <button type="button" className="mfa-link" onClick={onCancel}>
            Back
          </button>
        )}
      </div>
    );
  }

  return (
    <form className="mfa-setup" onSubmit={(e) => void onSubmit(e)}>
      <ol className="mfa-steps">
        <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) and scan this code.</li>
      </ol>
      <img className="mfa-qr" src={enrollment.qrCode} alt="QR code to add BinderBuddy to your authenticator app" />
      <button type="button" className="mfa-link" onClick={() => setShowSecret((v) => !v)}>
        {showSecret ? 'Hide setup key' : 'Can’t scan? Enter a setup key instead'}
      </button>
      {showSecret && <code className="mfa-secret">{enrollment.secret.match(/.{1,4}/g)?.join(' ')}</code>}
      <ol className="mfa-steps" start={2}>
        <li>Enter the 6-digit code the app shows for BinderBuddy.</li>
      </ol>
      <CodeField value={code} onChange={setCode} />
      {error && <p className="form-error">{error}</p>}
      <div className="mfa-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Checking…' : 'Turn on two-factor'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
