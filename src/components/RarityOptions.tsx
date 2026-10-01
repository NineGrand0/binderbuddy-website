import type { Card } from '../types';

const RARITY_LABELS: Record<NonNullable<Card['rarity']>, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  ultra: 'Ultra rare',
  secret: 'Secret rare',
  promo: 'Promo',
};

/** `<option>`s for a rarity `<select>`; the empty value means “not known yet”. */
export function RarityOptions() {
  return (
    <>
      <option value="">Not set</option>
      {Object.entries(RARITY_LABELS).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </>
  );
}
