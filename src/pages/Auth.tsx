import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { HomeMarketingNav } from '../components/Layout';
import { useStore } from '../store/Store';
import { HeroArt } from './Landing';

export function LoginPage() {
  const { user, login } = useStore();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to="/dashboard" replace />;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const err = login(email, password);
    if (err) setError(err);
    else navigate('/dashboard');
  }

  return (
    <div className="home home-auth">
      <HomeMarketingNav />
      <div className="home-body">
      <section className="home-auth-stage">
        <div className="home-auth-art" aria-hidden>
          <HeroArt compact />
        </div>
        <div className="home-auth-card">
          <h1>Welcome back</h1>
          <p>Log in to open your binders and collection.</p>
          <p className="home-auth-hint">
            Admin demo (Premium): <code>admin@binderbuddy.com</code> / <code>admin123</code>
          </p>
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
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
            <button type="submit" className="home-auth-submit">
              Log in
            </button>
          </form>
          <p className="home-auth-foot">
            New here? <Link to="/signup">Create an account</Link>
          </p>
        </div>
      </section>
      </div>
    </div>
  );
}

export function SignupPage() {
  const { user, signup } = useStore();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to="/dashboard" replace />;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const err = signup(email, password, displayName);
    if (err) setError(err);
    else navigate('/dashboard');
  }

  return (
    <div className="home home-auth">
      <HomeMarketingNav />
      <div className="home-body">
      <section className="home-auth-stage">
        <div className="home-auth-art" aria-hidden>
          <HeroArt compact />
        </div>
        <div className="home-auth-card">
          <h1>Create your account</h1>
          <p>You’ll get a starter collection so you can try binder layouts right away.</p>
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="name">Display name</label>
              <input
                id="name"
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
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
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
                minLength={6}
              />
            </div>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="home-auth-submit">
              Create account
            </button>
          </form>
          <p className="home-auth-foot">
            Already have an account? <Link to="/login">Log in</Link>
          </p>
        </div>
      </section>
      </div>
    </div>
  );
}
