import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/Store';
import { FixedHomeNav } from '../components/Layout';
import { ThemeToggle } from '../theme/Theme';

const GAMES = [
  { name: 'Pokémon', short: 'PKM', color: '#3B82F6' },
  { name: 'Magic', short: 'MTG', color: '#C45C26' },
  { name: 'Yu-Gi-Oh!', short: 'YGO', color: '#EAB308' },
  { name: 'Lorcana', short: 'LOR', color: '#7C3AED' },
  { name: 'One Piece', short: 'OP', color: '#EF4444' },
  { name: 'Digimon', short: 'DGM', color: '#F97316' },
  { name: 'Flesh and Blood', short: 'FAB', color: '#991B1B' },
  { name: 'Star Wars', short: 'SWU', color: '#111827' },
  { name: 'Weiss Schwarz', short: 'WS', color: '#EC4899' },
  { name: 'Vanguard', short: 'VGD', color: '#2563EB' },
  { name: 'Dragon Ball', short: 'DBS', color: '#EA580C' },
  { name: 'Union Arena', short: 'UA', color: '#0EA5E9' },
];

export function LandingPage() {
  const { user } = useStore();
  const ctaTo = user ? '/dashboard' : '/signup';
  const ctaLabel = user ? 'Open binders' : 'Get started';
  const navRef = useRef<HTMLElement>(null);
  const lightRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    const light = lightRef.current;
    if (!nav || !light) return;
    const update = () => {
      const r = light.getBoundingClientRect();
      nav.classList.toggle('is-light', r.top < 72 && r.bottom > 56);
    };
    const scroller = nav.closest('.home') ?? window;
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    return () => scroller.removeEventListener('scroll', update);
  }, []);

  return (
    <div className="home">
      <FixedHomeNav ref={navRef}>
        <Link to="/" className="home-logo">
          binderbuddy
        </Link>
        <div className="home-nav-end">
          <nav className="home-nav-links">
            {user ? (
              <>
                <Link to="/dashboard">Binders</Link>
                <Link to="/collection">Collection</Link>
                <Link to={ctaTo} className="home-pill">
                  {ctaLabel}
                </Link>
              </>
            ) : (
              <>
                <a href="#features">How it works</a>
                <Link to="/login">Log in</Link>
                <Link to="/signup" className="home-pill">
                  Get started
                </Link>
              </>
            )}
          </nav>
          <ThemeToggle />
        </div>
      </FixedHomeNav>

      <div className="home-body">
      <section className="home-hero">
        <div className="home-hero-copy">
          <h1>
            Build digital binders, using real cards. Share binders with friends and track your collection!
          </h1>
          <p>Flip pages that feel like the real thing. Track what you own. Share a binder friends can actually browse.</p>
        </div>
        <div className="home-hero-art" aria-hidden>
          <HeroArt />
        </div>
        <a className="home-scroll" href="#features" aria-label="Scroll to features">
          ↓
        </a>
      </section>

      <section className="home-create" id="features">
        <h2 className="home-create-title">
          <span>Create</span>
          <span>your</span>
          <span className="home-create-xl">binders</span>
        </h2>
        <p className="home-create-lead">
          Lay out a binder in seconds. <strong>Use the tools collectors actually need</strong> to match the real pages in your bag.
        </p>
        <div className="home-float home-float-a" aria-hidden />
        <div className="home-float home-float-b" aria-hidden />
        <div className="home-feature-grid">
          <article>
            <h3>Pages that turn</h3>
            <p>Vinyl covers, ring spines, and page-turn animation. Pocket grids from 2×2 up to archive 5×4.</p>
          </article>
          <article>
            <h3>Collection first</h3>
            <p>Cards enter your catalogue before they sit in a pocket — so the layout always matches what you own.</p>
          </article>
          <article>
            <h3>Scan a page</h3>
            <p>Upload a photo of a full binder page or a single card to fill binders faster.</p>
          </article>
          <article>
            <h3>Share live</h3>
            <p>Friends open your public binders and flip through them — no account required to view.</p>
          </article>
        </div>
      </section>

      <section className="home-split">
        <div className="home-split-art" aria-hidden>
          <ShareArt />
        </div>
        <div className="home-split-copy">
          <h2>
            Easily
            <br />
            share binders
            <br />
            via link or QR
          </h2>
          <p>…or copy-paste the page</p>
        </div>
      </section>

      <section className="home-scan">
        <h2>
          Scan
          <br />
          &amp; Go
        </h2>
        <p>Turn a photo of a page or a card into collection entries — then drop them into pockets.</p>
        <div className="home-scan-art" aria-hidden>
          <ScanArt />
        </div>
      </section>

      <section className="home-mosaic" ref={lightRef}>
        <h2>
          Built for
          <br />
          every TCG
        </h2>
        <p>One binder app for the games you actually collect — plan pages the same way for all of them.</p>
        <div className="home-mosaic-grid" aria-hidden>
          {[...GAMES, ...GAMES, ...GAMES].map((game, i) => (
            <span
              key={`${game.short}-${i}`}
              className="home-mosaic-tile"
              style={{ background: game.color, animationDelay: `${(i % 12) * 0.08}s` }}
            >
              {game.short}
            </span>
          ))}
        </div>
      </section>

      <section className="home-cta">
        <div className="home-cta-copy">
          <h2>
            Start your
            <br />
            binder today
          </h2>
          <Link to={ctaTo} className="home-pill home-pill-lg">
            {ctaLabel}
          </Link>
        </div>
        <div className="home-cta-art" aria-hidden>
          <HeroArt compact />
        </div>
      </section>

      <footer className="home-foot">
        <span>BinderBuddy — plan binders, track cards, share with friends.</span>
        <span>Demo stores data in your browser.</span>
      </footer>
      </div>
    </div>
  );
}

export function HeroArt({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`hero-stage-art${compact ? ' is-compact' : ''}`}>
      <div className="hero-cards" aria-hidden>
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} className={`hero-card hero-card-${i}`} />
        ))}
      </div>
      <div className="hero-platform" />
      <div className="hero-binder-stand">
        <div className="hero-binder-cover">
          <span className="hero-binder-rings">
            <i />
            <i />
            <i />
          </span>
          <span className="hero-binder-grid">
            {Array.from({ length: 9 }, (_, n) => (
              <i key={n} />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

function ShareArt() {
  return (
    <div className="share-3d">
      <div className="share-3d-card">
        <span className="share-3d-bubble">•••</span>
        <span className="share-3d-leaf" />
      </div>
    </div>
  );
}

function ScanArt() {
  return (
    <div className="scan-3d">
      <div className="scan-phone">
        <div className="scan-qr">
          {Array.from({ length: 25 }, (_, i) => (
            <i
              key={i}
              className={
                [0, 1, 3, 4, 5, 9, 10, 12, 14, 15, 19, 20, 21, 23, 24].includes(i) ? 'on' : undefined
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
