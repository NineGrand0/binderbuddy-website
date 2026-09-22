import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useStore } from '../store/Store';
import { ThemeToggle } from '../theme/Theme';

export const FixedHomeNav = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  function FixedHomeNav({ children, className = '', ...rest }, ref) {
    return (
      <header ref={ref} className={`home-nav ${className}`.trim()} {...rest}>
        {children}
      </header>
    );
  },
);

export function BrandMark({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="brand-mark">
      <span className="glyph" aria-hidden />
      BinderBuddy
    </Link>
  );
}

export function HomeAppNav() {
  const { user, logout } = useStore();

  return (
    <FixedHomeNav>
      <Link to="/" className="home-logo">
        binderbuddy
      </Link>
      <div className="home-nav-end">
        <nav className="home-nav-links">
          {user ? (
            <>
              <NavLink to="/dashboard">Binders</NavLink>
              <NavLink to="/plan">Plan</NavLink>
              <NavLink to="/collection">Collection</NavLink>
              <NavLink to="/scan">Scan</NavLink>
              <NavLink to="/share">Share</NavLink>
              <NavLink to="/account">Account</NavLink>
              <button type="button" onClick={logout}>
                Log out
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login">Log in</NavLink>
              <Link to="/signup" className="home-pill">
                Get started
              </Link>
            </>
          )}
        </nav>
        <ThemeToggle />
      </div>
    </FixedHomeNav>
  );
}

export function HomeAppFooter() {
  return (
    <footer className="home-foot">
      <span>BinderBuddy — plan binders, track cards, share with friends.</span>
      <span>Demo stores data in your browser.</span>
    </footer>
  );
}

export function HomeAppShell({
  children,
  wide,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="home home-app">
      <HomeAppNav />
      <div className="home-body">
        <main className="home-app-stage">
          <div className={`home-app-panel${wide ? ' is-wide' : ''}`}>{children}</div>
        </main>
        <HomeAppFooter />
      </div>
    </div>
  );
}

export function HomeMarketingNav() {
  return (
    <FixedHomeNav>
      <Link to="/" className="home-logo">
        binderbuddy
      </Link>
      <div className="home-nav-end">
        <nav className="home-nav-links">
          <Link to="/#features">How it works</Link>
          <NavLink to="/login">Log in</NavLink>
          <Link to="/signup" className="home-pill">
            Get started
          </Link>
        </nav>
        <ThemeToggle />
      </div>
    </FixedHomeNav>
  );
}

export function AppNav() {
  const { user, logout } = useStore();

  return (
    <header className="shell">
      <nav className="app-nav">
        <BrandMark />
        <div className="nav-links">
          {user ? (
            <>
              <NavLink to="/dashboard">Binders</NavLink>
              <NavLink to="/plan">Plan</NavLink>
              <NavLink to="/collection">Collection</NavLink>
              <NavLink to="/scan">Scan</NavLink>
              <NavLink to="/share">Share</NavLink>
              <NavLink to="/account">Account</NavLink>
              <button type="button" className="linkish" onClick={logout}>
                Log out
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login">Log in</NavLink>
              <Link to="/signup" className="btn btn-primary">
                Get started
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="shell site-footer">
      <span>BinderBuddy — plan binders, track cards, share with friends.</span>
      <span>Demo stores data in your browser.</span>
    </footer>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppNav />
      {children}
      <Footer />
    </>
  );
}
