import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, CreditCard, Sparkles } from 'lucide-react';
import { HomeAppShell } from '../components/Layout';
import { RequireAuth } from './Dashboard';
import { useStore } from '../store/Store';
import {
  PREMIUM_PRICE_USD,
  userHasPremium,
  type PremiumPaymentMethod,
} from '../types';

const FREE_FEATURES = [
  'Manual page cropping with the demo grid',
  'Manual card name, set, and number editing',
  'Basic binder styles',
  'Standard share link and QR',
];

const PREMIUM_FEATURES = [
  'AI powered cropping tool',
  'Auto detection of card information from photos',
  'Everything in Free',
  'Premium binder styles and share upgrades (coming soon)',
];

const METHODS: { id: PremiumPaymentMethod; label: string; hint: string }[] = [
  { id: 'card', label: 'Card', hint: 'Visa, Mastercard, Amex' },
  { id: 'paypal', label: 'PayPal', hint: 'Pay with your PayPal balance' },
  { id: 'apple_pay', label: 'Apple Pay', hint: 'One-tap on supported devices' },
];

export function PremiumPage() {
  return (
    <RequireAuth>
      <PremiumInner />
    </RequireAuth>
  );
}

function PremiumInner() {
  const { user, activatePremium } = useStore();
  const [method, setMethod] = useState<PremiumPaymentMethod>('card');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [nameOnCard, setNameOnCard] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');

  if (!user) return null;

  const premium = userHasPremium(user);

  function onPay(e: FormEvent) {
    e.preventDefault();
    if (premium || busy) return;
    setBusy(true);
    window.setTimeout(() => {
      activatePremium(method);
      setBusy(false);
      setDone(true);
    }, 700);
  }

  return (
    <HomeAppShell>
      <div className="page-header">
        <div>
          <h1>Premium</h1>
          <p>
            One-time unlock for auto cropping and automatic card detection — ${PREMIUM_PRICE_USD}, yours forever on
            this account.
          </p>
        </div>
        {premium && (
          <span className="premium-badge">
            <Sparkles size={16} /> Premium active
          </span>
        )}
      </div>

      <div className="premium-compare">
        <article className="panel premium-tier">
          <h2>Free</h2>
          <p className="premium-price">
            $0 <span>always</span>
          </p>
          <ul>
            {FREE_FEATURES.map((item) => (
              <li key={item}>
                <Check size={16} /> {item}
              </li>
            ))}
          </ul>
        </article>

        <article className="panel premium-tier is-featured">
          <h2>Premium</h2>
          <p className="premium-price">
            ${PREMIUM_PRICE_USD} <span>one-time</span>
          </p>
          <ul>
            {PREMIUM_FEATURES.map((item) => (
              <li key={item}>
                <Check size={16} /> {item}
              </li>
            ))}
          </ul>
        </article>
      </div>

      {premium ? (
        <div className="panel premium-paid">
          <h2 style={{ fontSize: '1.15rem', margin: 0 }}>You’re on Premium</h2>
          <p className="muted" style={{ margin: 0 }}>
            Auto cropping and card detection are available on{' '}
            <Link to="/scan">Scan</Link>.
            {user.premiumPurchasedAt
              ? ` Unlocked ${new Date(user.premiumPurchasedAt).toLocaleDateString()}.`
              : user.role === 'admin'
                ? ' Included with admin.'
                : ''}
          </p>
        </div>
      ) : (
        <form className="panel premium-pay" onSubmit={onPay}>
          <div className="premium-pay-head">
            <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Pay ${PREMIUM_PRICE_USD} once</h2>
            <p className="muted" style={{ margin: 0 }}>
              Demo checkout — no real charge. Choosing a method unlocks Premium in this browser.
            </p>
          </div>

          <fieldset className="premium-methods">
            <legend>Payment method</legend>
            {METHODS.map((item) => (
              <label key={item.id} className={`premium-method${method === item.id ? ' is-selected' : ''}`}>
                <input
                  type="radio"
                  name="premium-method"
                  value={item.id}
                  checked={method === item.id}
                  onChange={() => setMethod(item.id)}
                />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </span>
              </label>
            ))}
          </fieldset>

          {method === 'card' && (
            <div className="premium-card-fields">
              <div className="field">
                <label htmlFor="premium-name">Name on card</label>
                <input
                  id="premium-name"
                  value={nameOnCard}
                  onChange={(e) => setNameOnCard(e.target.value)}
                  placeholder="Alex Collector"
                  required
                  autoComplete="cc-name"
                />
              </div>
              <div className="field">
                <label htmlFor="premium-number">Card number</label>
                <input
                  id="premium-number"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  placeholder="4242 4242 4242 4242"
                  required
                  inputMode="numeric"
                  autoComplete="cc-number"
                />
              </div>
              <div className="premium-card-row">
                <div className="field">
                  <label htmlFor="premium-expiry">Expiry</label>
                  <input
                    id="premium-expiry"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    placeholder="MM/YY"
                    required
                    autoComplete="cc-exp"
                  />
                </div>
                <div className="field">
                  <label htmlFor="premium-cvc">CVC</label>
                  <input
                    id="premium-cvc"
                    value={cvc}
                    onChange={(e) => setCvc(e.target.value)}
                    placeholder="123"
                    required
                    inputMode="numeric"
                    autoComplete="cc-csc"
                  />
                </div>
              </div>
            </div>
          )}

          {method !== 'card' && (
            <p className="muted" style={{ margin: 0 }}>
              You’ll be redirected to {method === 'paypal' ? 'PayPal' : 'Apple Pay'} in a live checkout. Here, confirm
              below to unlock Premium.
            </p>
          )}

          <button type="submit" className="btn btn-primary" disabled={busy}>
            <CreditCard size={18} />
            {busy ? 'Processing…' : done ? 'Unlocked' : `Pay $${PREMIUM_PRICE_USD}`}
          </button>
        </form>
      )}
    </HomeAppShell>
  );
}
