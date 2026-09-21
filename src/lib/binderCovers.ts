export type BinderCoverPreset =
  | 'classic'
  | 'electric'
  | 'prism'
  | 'carbon'
  | 'sakura'
  | 'ocean'
  | 'ember'
  | 'meadow';

export interface BinderCoverDef {
  id: BinderCoverPreset;
  label: string;
  spine: string;
  /** Full CSS background for the cover face */
  face: string;
}

export const BINDER_COVER_PRESETS: BinderCoverDef[] = [
  {
    id: 'classic',
    label: 'Classic vinyl',
    spine: '#0a1220',
    face: 'linear-gradient(145deg, #2a4a6e, #152238 45%, #0d1624)',
  },
  {
    id: 'electric',
    label: 'Electric arc',
    spine: '#0b1a14',
    face: `
      radial-gradient(circle at 20% 20%, rgba(250, 220, 80, 0.55), transparent 42%),
      radial-gradient(circle at 85% 70%, rgba(61, 214, 198, 0.4), transparent 45%),
      linear-gradient(135deg, #10281f, #163528 40%, #0a1812)
    `,
  },
  {
    id: 'prism',
    label: 'Prism foil',
    spine: '#1a1030',
    face: `
      linear-gradient(120deg, rgba(255,120,180,0.45), transparent 40%),
      linear-gradient(240deg, rgba(80,180,255,0.4), transparent 45%),
      linear-gradient(30deg, rgba(180,255,140,0.3), transparent 40%),
      linear-gradient(160deg, #2a1848, #14102a)
    `,
  },
  {
    id: 'carbon',
    label: 'Carbon weave',
    spine: '#0c0e12',
    face: `
      repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 2px, transparent 2px 6px),
      repeating-linear-gradient(-45deg, rgba(255,255,255,0.03) 0 2px, transparent 2px 6px),
      linear-gradient(160deg, #2a2e36, #12151a)
    `,
  },
  {
    id: 'sakura',
    label: 'Sakura dusk',
    spine: '#3a1a28',
    face: `
      radial-gradient(circle at 70% 20%, rgba(255,180,200,0.5), transparent 40%),
      radial-gradient(circle at 15% 80%, rgba(255,120,160,0.28), transparent 45%),
      linear-gradient(150deg, #5a3048, #2a1422)
    `,
  },
  {
    id: 'ocean',
    label: 'Deep current',
    spine: '#061820',
    face: `
      radial-gradient(ellipse at 30% 0%, rgba(90,200,255,0.35), transparent 50%),
      linear-gradient(180deg, #0c3a4a, #062028 55%, #041218)
    `,
  },
  {
    id: 'ember',
    label: 'Ember ridge',
    spine: '#2a1008',
    face: `
      radial-gradient(circle at 80% 90%, rgba(255,120,40,0.45), transparent 40%),
      radial-gradient(circle at 10% 10%, rgba(255,200,80,0.2), transparent 35%),
      linear-gradient(155deg, #4a1c14, #1a0c08)
    `,
  },
  {
    id: 'meadow',
    label: 'Meadow stitch',
    spine: '#142818',
    face: `
      radial-gradient(circle at 40% 30%, rgba(160,230,120,0.28), transparent 45%),
      linear-gradient(140deg, #2f5a38, #163022 50%, #0e1c16)
    `,
  },
];

export function getBinderCover(preset?: BinderCoverPreset | string): BinderCoverDef {
  return (
    BINDER_COVER_PRESETS.find((p) => p.id === preset) ?? BINDER_COVER_PRESETS[0]
  );
}
