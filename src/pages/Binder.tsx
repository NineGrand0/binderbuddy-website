import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { HomeAppShell } from '../components/Layout';
import { InteractiveBinder } from '../components/InteractiveBinder';
import { RequireAuth } from './Dashboard';
import { useStore } from '../store/Store';

export function BinderPage() {
  return (
    <RequireAuth>
      <BinderPageInner />
    </RequireAuth>
  );
}

function BinderPageInner() {
  const { id } = useParams();
  const { user, updateBinder, deleteBinder } = useStore();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');

  const binder = user?.binders.find((b) => b.id === id);

  if (!user) return null;
  if (!binder) return <Navigate to="/dashboard" replace />;

  function startRename() {
    setName(binder!.name);
    setRenaming(true);
  }

  function saveName(e: FormEvent) {
    e.preventDefault();
    updateBinder(binder!.id, { name: name.trim() || binder!.name });
    setRenaming(false);
  }

  return (
    <HomeAppShell wide>
      <div className="page-header">
          <div>
            {renaming ? (
              <form onSubmit={saveName} style={{ display: 'flex', gap: 8 }}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  style={{
                    fontSize: '1.5rem',
                    fontFamily: 'Outfit, var(--font-display)',
                    background: '#f4f4f5',
                    border: '1px solid #e4e4e7',
                    color: '#171717',
                    borderRadius: 10,
                    padding: '0.35rem 0.65rem',
                  }}
                />
                <button type="submit" className="btn btn-primary">
                  Save
                </button>
              </form>
            ) : (
              <h1>{binder.name}</h1>
            )}
            <p>
              Flip the front cover, then place cards into the pockets.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link to="/share" className="btn btn-secondary">
              Share
            </Link>
            <button type="button" className="btn btn-ghost" onClick={startRename}>
              Rename
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                if (confirm('Delete this binder?')) {
                  deleteBinder(binder.id);
                  navigate('/dashboard');
                }
              }}
            >
              Delete
            </button>
          </div>
        </div>

        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: '1rem',
            color: '#71717a',
          }}
        >
          <input
            type="checkbox"
            checked={binder.isPublic}
            onChange={(e) => updateBinder(binder.id, { isPublic: e.target.checked })}
          />
          Public via share link / QR
        </label>

        <InteractiveBinder binder={binder} collection={user.collection} />
    </HomeAppShell>
  );
}
