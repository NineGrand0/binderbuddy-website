import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { HomeAppShell } from '../components/Layout';
import { TcgCard } from '../components/TcgCard';
import { CardFormModal, type CardFormValues } from '../components/CardFormModal';
import { RequireAuth } from './Dashboard';
import { useStore } from '../store/Store';
import type { Card } from '../types';

export function CollectionPage() {
  return (
    <RequireAuth>
      <CollectionInner />
    </RequireAuth>
  );
}

function CollectionInner() {
  const { user, updateCard, removeCard } = useStore();
  const [editing, setEditing] = useState<Card | null>(null);

  if (!user) return null;

  function onSaveEdit(values: CardFormValues) {
    if (!editing) return;
    updateCard(editing.id, {
      name: values.name,
      set: values.set,
      number: values.number,
      rarity: values.rarity,
      game: values.game,
      imageUrl: values.imageUrl || undefined,
      imageDataUrl: values.imageDataUrl,
    });
    setEditing(null);
  }

  return (
    <HomeAppShell>
      <div className="home-app-header">
        <div>
          <h1>Collection</h1>
          <p>Scan a photo or edit anything already in your catalogue.</p>
        </div>
        <Link to="/scan" className="home-app-cta">
          Scan / upload
        </Link>
      </div>

      <h2 className="home-app-kicker">Your catalogue ({user.collection.length})</h2>

      {user.collection.length === 0 ? (
        <div className="home-app-empty">No cards yet. Scan a photo to add some.</div>
      ) : (
        <div className="grid-cards">
          {user.collection.map((card) => (
            <div key={card.id} className="collection-item">
              <TcgCard card={card} />
              <div className="actions">
                <button
                  type="button"
                  className="home-app-ghost"
                  onClick={() => setEditing(card)}
                >
                  <Pencil size={14} /> Edit
                </button>
                <button
                  type="button"
                  className="home-app-ghost"
                  onClick={() => removeCard(card.id)}
                >
                  <Trash2 size={14} /> Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <CardFormModal
          key={editing.id}
          title="Edit card"
          submitLabel="Save changes"
          initial={{
            name: editing.name,
            set: editing.set,
            number: editing.number,
            rarity: editing.rarity,
            game: editing.game,
            imageUrl: editing.imageUrl ?? '',
            imageDataUrl: editing.imageDataUrl,
          }}
          onClose={() => setEditing(null)}
          onSubmit={onSaveEdit}
        />
      )}
    </HomeAppShell>
  );
}
