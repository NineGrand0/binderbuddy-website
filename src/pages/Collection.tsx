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
  const { user, updateCard, removeCard, removeAllCards } = useStore();
  const [editing, setEditing] = useState<Card | null>(null);

  if (!user) return null;

  function onSaveEdit(values: CardFormValues) {
    if (!editing) return;
    updateCard(editing.id, {
      name: values.name,
      set: values.set,
      number: values.number,
      rarity: values.rarity,
      condition: values.condition,
      // Still the Near Mint guess from pricing unless the owner picked something else
      conditionAssumed: editing.conditionAssumed && values.condition === editing.condition ? true : undefined,
      game: values.game,
      imageUrl: values.imageUrl || undefined,
      imageDataUrl: values.imageDataUrl,
      externalId: values.externalId,
      // A null pricing means the card details changed after it was priced
      ...(values.pricing ?? {
        printing: undefined,
        justtcgCardId: undefined,
        justtcgVariantId: undefined,
        price: null,
        // Not looked up again until the owner asks (Get price, or the binder's Get all prices)
        priceStatus: undefined,
      }),
    });
    setEditing(null);
  }

  function onRemoveAll() {
    const count = user!.collection.length;
    const message = `Remove all ${count} card${count === 1 ? '' : 's'} from your collection? They’ll also be taken out of your binders. This can’t be undone.`;
    if (confirm(message)) removeAllCards();
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

      <div className="collection-toolbar">
        <h2 className="home-app-kicker">Your catalogue ({user.collection.length})</h2>
        {user.collection.length > 0 && (
          <button type="button" className="home-app-ghost is-danger" onClick={onRemoveAll}>
            <Trash2 size={14} /> Remove all
          </button>
        )}
      </div>

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
            condition: editing.condition,
            game: editing.game,
            imageUrl: editing.imageUrl ?? '',
            imageDataUrl: editing.imageDataUrl,
            externalId: editing.externalId,
            pricing: {
              printing: editing.printing,
              justtcgCardId: editing.justtcgCardId,
              justtcgVariantId: editing.justtcgVariantId,
              price: editing.price,
              priceStatus: editing.priceStatus,
            },
          }}
          onClose={() => setEditing(null)}
          onSubmit={onSaveEdit}
        />
      )}
    </HomeAppShell>
  );
}
