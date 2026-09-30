import { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { isSoundMuted, setSoundMuted, subscribeSoundMuted } from '../lib/pageTurnSound';

export function PageSoundToggle() {
  const [muted, setMuted] = useState(isSoundMuted);

  useEffect(() => subscribeSoundMuted(() => setMuted(isSoundMuted())), []);

  return (
    <button
      type="button"
      className="btn btn-secondary"
      aria-pressed={muted}
      aria-label={muted ? 'Unmute page sounds' : 'Mute page sounds'}
      onClick={() => setSoundMuted(!muted)}
    >
      {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      {muted ? 'Muted' : 'Sound'}
    </button>
  );
}
