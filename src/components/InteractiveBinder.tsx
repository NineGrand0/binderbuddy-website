import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  Minus,
  Plus,
  Search,
} from 'lucide-react';
import type { Binder, Card } from '../types';
import {
  BINDER_SIZES,
  BINDER_STYLES,
  GRID_COLS,
  SLOT_COUNTS,
} from '../types';
import { getBinderCover } from '../lib/binderCovers';
import { cardArtStyle } from '../lib/cardArt';
import { useStore } from '../store/Store';
import { CardDetailModal } from './CardDetailModal';

type TurnDirection = 'forward' | 'back';
type PageSide = 'front' | 'back';
type DragSide = 'left' | 'right';
type TurnKind = 'cover' | 'page';

const TURN_MS = 980;
const MAX_TURN = 178;
const POCKET_DRAG = 'bb-pocket:';

interface SelectedSlot {
  page: number;
  slot: number;
}

interface DragState {
  side: DragSide;
  kind: TurnKind;
  startX: number;
  width: number;
  pointerId: number;
  active: boolean;
}

function easePaper(t: number) {
  // Ease-out quint: quick into the fold, soft settle at the end.
  const x = 1 - Math.min(1, Math.max(0, t));
  return 1 - x * x * x * x * x;
}

function parsePocketDrag(data: string): SelectedSlot | null {
  if (!data.startsWith(POCKET_DRAG)) return null;
  try {
    const parsed = JSON.parse(data.slice(POCKET_DRAG.length)) as SelectedSlot;
    if (typeof parsed.page !== 'number' || typeof parsed.slot !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function pageTransform(angleDeg: number): string {
  // Pure Y rotation keeps the left edge hinged to the gutter.
  // Extra lift/tilt was making the sheet look detached from the spine.
  return `rotateY(${angleDeg}deg)`;
}

export function InteractiveBinder({
  binder,
  collection,
  readOnly = false,
  onChange,
}: {
  binder: Binder;
  collection: Card[];
  readOnly?: boolean;
  onChange?: (patch: Partial<Binder>) => void;
}) {
  const { setSlot, swapSlots, placeInNextEmptySlot, updateBinder } = useStore();

  const [spreadIndex, setSpreadIndex] = useState(0);
  const [coverOpen, setCoverOpen] = useState(false);
  const [turnAnim, setTurnAnim] = useState<TurnDirection | null>(null);
  const [turnDir, setTurnDir] = useState<TurnDirection | null>(null);
  const [turnKind, setTurnKind] = useState<TurnKind | null>(null);
  const [pageAngle, setPageAngle] = useState(0);
  const [coverAngle, setCoverAngle] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [collectionQuery, setCollectionQuery] = useState('');
  const [selected, setSelected] = useState<SelectedSlot | null>(null);
  const [detailSlot, setDetailSlot] = useState<SelectedSlot | null>(null);
  const [dragPocket, setDragPocket] = useState<SelectedSlot | null>(null);
  const [dropPocket, setDropPocket] = useState<SelectedSlot | null>(null);
  const skipSlotClickRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  const animRef = useRef<number | null>(null);
  const pageAngleRef = useRef(0);
  const coverAngleRef = useRef(0);

  const styleDef = BINDER_STYLES.find((s) => s.id === binder.style) ?? BINDER_STYLES[0];
  const coverDef = getBinderCover(binder.coverPreset);
  const cols = GRID_COLS[binder.size];
  const slotCount = SLOT_COUNTS[binder.size];
  const spreadCount = Math.max(1, Math.ceil(binder.pages.length / 2));
  const turning = turnAnim !== null;
  const leftPageIndex = spreadIndex * 2;
  const rightPageIndex = leftPageIndex + 1;
  const canCloseCover = coverOpen && spreadIndex === 0;
  const canPrev = coverOpen && (spreadIndex > 0 || canCloseCover);
  const canNext = !coverOpen || spreadIndex < spreadCount - 1;
  const pocketsReady = coverOpen && Math.abs(coverAngle + MAX_TURN) < 10 && !turning;
  const activeAngle = turnKind === 'cover' || !coverOpen ? coverAngle : pageAngle;
  const turnProgress = Math.min(1, Math.abs(activeAngle) / MAX_TURN);
  const castOpacity =
    turnAnim === 'forward' || activeAngle < -8
      ? Math.sin(turnProgress * Math.PI) * 0.95
      : turnAnim === 'back'
        ? Math.sin(turnProgress * Math.PI) * 0.85
        : 0;

  const cardById = useMemo(() => {
    const map = new Map<string, Card>();
    collection.forEach((c) => map.set(c.id, c));
    return map;
  }, [collection]);

  const usedInBinder = useMemo(() => {
    const ids = new Set<string>();
    binder.pages.forEach((page) =>
      page.slots.forEach((id) => {
        if (id) ids.add(id);
      }),
    );
    return ids;
  }, [binder.pages]);

  const filteredCollection = useMemo(() => {
    const q = collectionQuery.trim().toLowerCase();
    if (!q) return collection;
    return collection.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.set.toLowerCase().includes(q) ||
        c.number.toLowerCase().includes(q) ||
        c.game.toLowerCase().includes(q) ||
        c.rarity.toLowerCase().includes(q),
    );
  }, [collection, collectionQuery]);

  const setAngle = useCallback((angle: number) => {
    pageAngleRef.current = angle;
    setPageAngle(angle);
  }, []);

  const setCover = useCallback((angle: number) => {
    coverAngleRef.current = angle;
    setCoverAngle(angle);
  }, []);

  const cancelAnim = useCallback(() => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  }, []);

  useEffect(() => {
    setSpreadIndex(0);
    setSelected(null);
    setDetailSlot(null);
    setTurnAnim(null);
    setTurnDir(null);
    setTurnKind(null);
    setCoverOpen(false);
    setDragging(false);
    cancelAnim();
    setAngle(0);
    setCover(0);
  }, [binder.id, cancelAnim, setAngle, setCover]);

  useEffect(() => () => cancelAnim(), [cancelAnim]);

  function patchBinder(patch: Partial<Binder>) {
    if (onChange) onChange(patch);
    else updateBinder(binder.id, patch);
  }

  const animateAngle = useCallback(
    (from: number, to: number, direction: TurnDirection, onDone: () => void) => {
      cancelAnim();
      setTurnKind('page');
      setTurnDir(direction);
      setTurnAnim(direction);
      const start = performance.now();

      const frame = (now: number) => {
        const t = Math.min(1, (now - start) / TURN_MS);
        const eased = easePaper(t);
        setAngle(from + (to - from) * eased);
        if (t < 1) {
          animRef.current = requestAnimationFrame(frame);
        } else {
          animRef.current = null;
          setAngle(to);
          onDone();
        }
      };

      animRef.current = requestAnimationFrame(frame);
    },
    [cancelAnim, setAngle],
  );

  const animateCover = useCallback(
    (from: number, to: number, direction: TurnDirection, onDone: () => void) => {
      cancelAnim();
      setTurnKind('cover');
      setTurnDir(direction);
      setTurnAnim(direction);
      const start = performance.now();

      const frame = (now: number) => {
        const t = Math.min(1, (now - start) / TURN_MS);
        const eased = easePaper(t);
        setCover(from + (to - from) * eased);
        if (t < 1) {
          animRef.current = requestAnimationFrame(frame);
        } else {
          animRef.current = null;
          setCover(to);
          onDone();
        }
      };

      animRef.current = requestAnimationFrame(frame);
    },
    [cancelAnim, setCover],
  );

  const finishTurn = useCallback(() => {
    setTurnAnim(null);
    setTurnDir(null);
    setTurnKind(null);
    setSelected(null);
    setDetailSlot(null);
    setDragging(false);
  }, []);

  const turnCover = useCallback(
    (open: boolean, fromDrag = false) => {
      if (turnAnim !== null) return;
      if (open === coverOpen && !fromDrag) return;

      const finish = () => {
        setCoverOpen(open);
        setCover(open ? -MAX_TURN : 0);
        finishTurn();
      };

      if (open) {
        const from = fromDrag ? coverAngleRef.current : 0;
        animateCover(from, -MAX_TURN, 'forward', finish);
      } else {
        const from =
          fromDrag && coverAngleRef.current > -MAX_TURN + 1
            ? coverAngleRef.current
            : -MAX_TURN;
        if (!fromDrag) setCover(-MAX_TURN);
        animateCover(from, 0, 'back', finish);
      }
    },
    [turnAnim, coverOpen, animateCover, setCover, finishTurn],
  );

  const turnSpread = useCallback(
    (delta: number, fromDrag = false) => {
      if (turnAnim !== null) return;

      if (!coverOpen) {
        if (delta === 1) turnCover(true, fromDrag);
        return;
      }
      if (spreadIndex === 0 && delta === -1) {
        turnCover(false, fromDrag);
        return;
      }

      if (!fromDrag && Math.abs(pageAngleRef.current) > 0.5) return;
      const next = spreadIndex + delta;
      if (next < 0 || next >= spreadCount) return;

      const finish = () => {
        setSpreadIndex(next);
        setAngle(0);
        finishTurn();
      };

      if (delta === 1) {
        const from = fromDrag ? pageAngleRef.current : 0;
        animateAngle(from, -MAX_TURN, 'forward', finish);
      } else {
        const from = fromDrag ? pageAngleRef.current : 0;
        animateAngle(from, MAX_TURN, 'back', finish);
      }
    },
    [turnAnim, coverOpen, spreadIndex, spreadCount, turnCover, animateAngle, setAngle, finishTurn],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') turnSpread(1);
      if (e.key === 'ArrowLeft') turnSpread(-1);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [turnSpread]);

  function placeCard(cardId: string) {
    if (readOnly || !pocketsReady) return;
    const placed = placeInNextEmptySlot(binder.id, cardId, selected ?? undefined);
    if (!placed) return;
    setSelected(null);
    const targetSpread = Math.floor(placed.page / 2);
    if (targetSpread !== spreadIndex && !turning) {
      setSpreadIndex(targetSpread);
    }
  }

  function clearSelectedSlot() {
    if (readOnly || !selected) return;
    setSlot(binder.id, selected.page, selected.slot, null);
  }

  function rearrangePockets(from: SelectedSlot, to: SelectedSlot) {
    if (readOnly || !pocketsReady) return;
    if (from.page === to.page && from.slot === to.slot) return;
    swapSlots(binder.id, from, to);
    setSelected(null);
    setDetailSlot(null);
  }

  function addPages() {
    if (readOnly) return;
    const pages = [
      ...binder.pages,
      { slots: Array.from({ length: slotCount }, () => null) },
      { slots: Array.from({ length: slotCount }, () => null) },
    ];
    patchBinder({ pages });
  }

  function removeCurrentSpread() {
    if (readOnly || binder.pages.length <= 2) return;

    const start = spreadIndex * 2;
    const removeCount = Math.min(2, binder.pages.length - start);
    if (binder.pages.length - removeCount < 2) return;

    const removing = binder.pages.slice(start, start + removeCount);
    const hasCards = removing.some((page) => page.slots.some(Boolean));
    if (
      hasCards &&
      !confirm('Remove this spread? Cards in these pockets will leave the binder (they stay in your collection).')
    ) {
      return;
    }

    const pages = [
      ...binder.pages.slice(0, start),
      ...binder.pages.slice(start + removeCount),
    ];

    const nextSpreadCount = Math.max(1, Math.ceil(pages.length / 2));
    const nextSpread = Math.min(spreadIndex, nextSpreadCount - 1);

    setSelected(null);
    setDetailSlot(null);
    setSpreadIndex(nextSpread);
    patchBinder({ pages });
  }

  function onDragStart(side: DragSide, e: PointerEvent<HTMLDivElement>) {
    if (animRef.current !== null || (side === 'left' && !canPrev) || (side === 'right' && !canNext)) return;
    const kind: TurnKind =
      !coverOpen || (coverOpen && spreadIndex === 0 && side === 'left') ? 'cover' : 'page';
    cancelAnim();
    setTurnAnim(null);
    setTurnDir(side === 'left' ? 'back' : 'forward');
    setTurnKind(kind);
    const zone = e.currentTarget;
    const width = zone.parentElement?.getBoundingClientRect().width ?? 280;
    dragRef.current = {
      side,
      kind,
      startX: e.clientX,
      width,
      pointerId: e.pointerId,
      active: false,
    };
    if (kind === 'cover') {
      if (side === 'left') setCover(-MAX_TURN);
      else setCover(0);
    } else {
      setAngle(0);
    }
    zone.setPointerCapture(e.pointerId);
  }

  function onDragMove(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const delta = e.clientX - drag.startX;
    if (!drag.active && Math.abs(delta) < 10) return;
    drag.active = true;
    setDragging(true);
    if (drag.kind === 'cover') {
      if (drag.side === 'right') {
        const progress = clamp(-delta / (drag.width * 0.58), 0, 1);
        setCover(-progress * MAX_TURN);
      } else {
        const progress = clamp(delta / (drag.width * 0.58), 0, 1);
        setCover(-MAX_TURN + progress * MAX_TURN);
      }
      return;
    }
    if (drag.side === 'right') {
      const progress = clamp(-delta / (drag.width * 0.58), 0, 1);
      setAngle(-progress * MAX_TURN);
    } else {
      const progress = clamp(delta / (drag.width * 0.58), 0, 1);
      setAngle(progress * MAX_TURN);
    }
  }

  function onDragEnd(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const delta = e.clientX - drag.startX;
    const wasActive = drag.active;
    const kind = drag.kind;
    dragRef.current = null;
    setDragging(false);

    const snapAngle = kind === 'cover' ? setCover : setAngle;
    const from = kind === 'cover' ? coverAngleRef.current : pageAngleRef.current;
    const animate = kind === 'cover' ? animateCover : animateAngle;
    const turn = (d: number) =>
      kind === 'cover' ? turnCover(d === 1, true) : turnSpread(d, true);

    if (!wasActive) {
      if (drag.side === 'right' && canNext) turn(1);
      else if (drag.side === 'left' && canPrev) turn(-1);
      else if (kind === 'cover') snapAngle(coverOpen ? -MAX_TURN : 0);
      else snapAngle(0);
      return;
    }

    const threshold = drag.width * 0.2;
    if (drag.side === 'right' && -delta > threshold && canNext) {
      turn(1);
      return;
    }
    if (drag.side === 'left' && delta > threshold && canPrev) {
      turn(-1);
      return;
    }

    if (drag.side === 'right') {
      animate(from, 0, 'forward', () => {
        finishTurn();
        snapAngle(kind === 'cover' && coverOpen ? -MAX_TURN : 0);
      });
    } else if (kind === 'cover') {
      animate(from, -MAX_TURN, 'back', () => {
        finishTurn();
        snapAngle(-MAX_TURN);
      });
    } else {
      animate(from, 0, 'back', () => {
        finishTurn();
        snapAngle(0);
      });
    }
  }

  function renderPage(pageIndex: number, face: PageSide) {
    const page = binder.pages[pageIndex];
    if (!page) {
      return (
        <div className={`leaf-face ${face}`}>
          <div
            className="empty-state"
            style={{ border: 0, background: 'transparent', color: 'rgba(232,237,245,0.4)' }}
          >
            End of binder
          </div>
        </div>
      );
    }

    const rows = Math.ceil(slotCount / cols);

    return (
      <div className={`leaf-face ${face}`}>
        <div
          className="slot-grid"
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
          }}
        >
          {page.slots.map((cardId, slotIndex) => {
            const card = cardId ? cardById.get(cardId) : null;
            const isSelected =
              selected?.page === pageIndex && selected.slot === slotIndex;
            const hasArt = Boolean(card && (card.imageUrl || card.imageDataUrl));
            const canRearrange = pocketsReady && !readOnly && !turning;
            const isDragSource =
              dragPocket?.page === pageIndex && dragPocket.slot === slotIndex;
            const isDropTarget =
              dropPocket?.page === pageIndex && dropPocket.slot === slotIndex && !isDragSource;

            return (
              <button
                key={slotIndex}
                type="button"
                className={`card-slot ${card ? 'filled' : ''} ${isSelected ? 'selected' : ''} ${isDragSource ? 'is-dragging' : ''} ${isDropTarget ? 'drop-target' : ''}`}
                onClick={() => {
                  if (skipSlotClickRef.current) {
                    skipSlotClickRef.current = false;
                    return;
                  }
                  if (!pocketsReady) return;
                  if (card) {
                    setDetailSlot({ page: pageIndex, slot: slotIndex });
                    return;
                  }
                  if (!readOnly) setSelected({ page: pageIndex, slot: slotIndex });
                }}
                onDragOver={(e: DragEvent<HTMLButtonElement>) => {
                  if (!canRearrange || !dragPocket) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (!isDropTarget && !isDragSource) {
                    setDropPocket({ page: pageIndex, slot: slotIndex });
                  }
                }}
                onDragLeave={(e) => {
                  const next = e.relatedTarget as Node | null;
                  if (isDropTarget && !e.currentTarget.contains(next)) {
                    setDropPocket(null);
                  }
                }}
                onDrop={(e: DragEvent<HTMLButtonElement>) => {
                  if (!canRearrange) return;
                  e.preventDefault();
                  const from =
                    parsePocketDrag(e.dataTransfer.getData('text/plain')) ?? dragPocket;
                  if (!from) return;
                  rearrangePockets(from, { page: pageIndex, slot: slotIndex });
                  setDragPocket(null);
                  setDropPocket(null);
                }}
                disabled={(readOnly && !card) || !pocketsReady}
                aria-label={
                  card
                    ? `View ${card.name}. Drag to move or swap.`
                    : `Empty slot ${slotIndex + 1}`
                }
              >
                {card && (
                  <div
                    className="slot-card"
                    draggable={canRearrange}
                    onDragStart={(e: DragEvent<HTMLDivElement>) => {
                      if (!canRearrange) {
                        e.preventDefault();
                        return;
                      }
                      skipSlotClickRef.current = true;
                      e.dataTransfer.setData(
                        'text/plain',
                        `${POCKET_DRAG}${JSON.stringify({ page: pageIndex, slot: slotIndex })}`,
                      );
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setDragImage(e.currentTarget, 24, 32);
                      setDragPocket({ page: pageIndex, slot: slotIndex });
                      setDropPocket(null);
                    }}
                    onDragEnd={() => {
                      setDragPocket(null);
                      setDropPocket(null);
                    }}
                    style={{ '--hue': card.imageHue } as CSSProperties}
                  >
                    <div className="art" style={cardArtStyle(card)} />
                    {!hasArt && <div className="label">{card.name}</div>}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const turningBack = turnKind === 'page' && (turnDir === 'back' || pageAngle > 0.4);
  const turningForward = turnKind === 'page' && (turnDir === 'forward' || pageAngle < -0.4);
  const coverFlipping = (turnKind === 'cover' && turning) || Math.abs(coverAngle) > 0.4;
  const rightLeafStyle: CSSProperties = {
    transform: pageTransform(coverOpen && !turningBack ? pageAngle : 0),
    ['--turn-progress' as string]: String(turningForward ? Math.min(1, Math.abs(pageAngle) / MAX_TURN) : 0),
  };

  const rightLeafClass = [
    'binder-leaf',
    'right-page',
    turnKind === 'page' && turning && turningForward ? 'turning' : '',
    turnKind === 'page' && dragging && turningForward ? 'dragging' : '',
    turningForward ? 'flipping' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const leftTurnProgress = turningBack ? Math.min(1, Math.max(0, pageAngle) / MAX_TURN) : 0;
  const leftLeafStyle: CSSProperties = {
    transform: turningBack ? pageTransform(pageAngle) : undefined,
    ['--turn-progress' as string]: String(leftTurnProgress),
    ['--cast-opacity' as string]: turningBack ? '0' : String(castOpacity),
  };
  const leftLeafClass = [
    'binder-leaf',
    'left-page',
    turnKind === 'page' && turning && turningBack ? 'turning' : '',
    turnKind === 'page' && dragging && turningBack ? 'dragging' : '',
    turningBack ? 'flipping' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const destLeftIndex = Math.max(0, leftPageIndex - 2);
  const destRightIndex = Math.max(0, leftPageIndex - 1);

  const coverTurnProgress = Math.min(1, Math.abs(coverAngle) / MAX_TURN);
  const coverLeafStyle: CSSProperties = {
    transform: pageTransform(coverAngle),
    ['--turn-progress' as string]: String(coverTurnProgress),
  };
  const coverLeafClass = [
    'binder-leaf',
    'front-cover',
    turnKind === 'cover' && turning ? 'turning' : '',
    turnKind === 'cover' && dragging ? 'dragging' : '',
    coverFlipping ? 'flipping' : '',
    coverOpen && !coverFlipping ? 'parked' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const hasCustomCover = Boolean(binder.previewImageDataUrl);
  const coverFaceStyle: CSSProperties = hasCustomCover
    ? {
        backgroundImage: `url(${binder.previewImageDataUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : {
        background: binder.coverPreset ? coverDef.face : styleDef.cover,
      };

  const backPageIndex = rightPageIndex + 1;

  const detailCardId =
    detailSlot != null ? binder.pages[detailSlot.page]?.slots[detailSlot.slot] : null;
  const detailCard = detailCardId ? cardById.get(detailCardId) ?? null : null;

  return (
    <div className="binder-workspace">
      <div className="binder-main">
        <div className="binder-stage">
          <motion.div
            className={`physical-binder ${coverOpen ? 'cover-open' : 'cover-closed'}${dragPocket ? ' is-rearranging' : ''}`}
            style={
              {
                '--binder-cover': styleDef.cover,
                '--binder-spine': styleDef.spine,
                '--binder-accent': styleDef.accent,
              } as CSSProperties
            }
            initial={{ opacity: 0, y: 16, rotateX: 8 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="binder-cover-rail left" aria-hidden />
            <div className="binder-spine">
              {[18, 42, 66, 82].map((top) => (
                <span key={top} className="ring" style={{ top: `${top}%` }} />
              ))}
            </div>

            {turningBack && (
              <div className="binder-leaf left-page is-underlay" aria-hidden>
                {renderPage(destLeftIndex, 'front')}
              </div>
            )}
            <div className={leftLeafClass} style={leftLeafStyle}>
              {renderPage(leftPageIndex, 'front')}
              {turningBack && renderPage(destRightIndex, 'back')}
              {turningBack && <div className="leaf-sheen" aria-hidden />}
              {turningBack && <div className="leaf-curl" aria-hidden />}
              <div className="spread-cast" aria-hidden />
              <div
                className={`page-turn-zone left ${canPrev && coverOpen ? '' : 'disabled'}`}
                role="button"
                tabIndex={canPrev && coverOpen ? 0 : -1}
                aria-label={canCloseCover ? 'Close cover' : 'Previous page'}
                onPointerDown={(e) => onDragStart('left', e)}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    turnSpread(-1);
                  }
                }}
              />
            </div>

            <div className={rightLeafClass} style={rightLeafStyle}>
              {renderPage(rightPageIndex, 'front')}
              {renderPage(backPageIndex, 'back')}
              <div className="leaf-sheen" aria-hidden />
              <div className="leaf-curl" aria-hidden />
              <div
                className={`page-turn-zone right ${canNext && coverOpen ? '' : 'disabled'}`}
                role="button"
                tabIndex={canNext && coverOpen ? 0 : -1}
                aria-label="Next page"
                onPointerDown={(e) => onDragStart('right', e)}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    turnSpread(1);
                  }
                }}
              />
            </div>

            <div className={coverLeafClass} style={coverLeafStyle}>
              <div className="leaf-face front binder-front-face" style={coverFaceStyle}>
                {!hasCustomCover && (
                  <div className="binder-front-face__copy">
                    <span className="binder-front-face__brand">binderbuddy</span>
                    <strong className="binder-front-face__title">{binder.name}</strong>
                    <span className="binder-front-face__hint">Open to view pages</span>
                  </div>
                )}
                {hasCustomCover && <div className="binder-front-face__shade" aria-hidden />}
              </div>
              <div className="leaf-face back binder-front-lining">
                <span>Inside cover</span>
              </div>
              <div className="leaf-sheen" aria-hidden />
              <div className="leaf-curl" aria-hidden />
              <div
                className={`page-turn-zone right ${coverOpen ? 'disabled' : ''}`}
                role="button"
                tabIndex={coverOpen ? -1 : 0}
                aria-label="Open binder cover"
                onPointerDown={(e) => onDragStart('right', e)}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    turnCover(true);
                  }
                }}
              />
            </div>

            <div className="binder-cover-rail right" aria-hidden />
          </motion.div>
        </div>

        <p className="muted page-turn-hint">
          {coverOpen
            ? 'Drag a card onto another pocket to swap · tap a card to view · drag the outer edge to flip'
            : 'Open the front cover to reach the card pockets'}
        </p>

        <div className="binder-controls">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => turnSpread(-1)}
            disabled={!canPrev || turning}
          >
            <ChevronLeft size={18} />
            {canCloseCover ? 'Close cover' : 'Previous'}
          </button>
          <div className="page-indicator">
            {coverOpen ? `Spread ${spreadIndex + 1} / ${spreadCount}` : 'Front cover'}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => turnSpread(1)}
            disabled={!canNext || turning}
          >
            {coverOpen ? (
              <>
                Next <ChevronRight size={18} />
              </>
            ) : (
              <>
                Open cover <ChevronRight size={18} />
              </>
            )}
          </button>
          {!readOnly && (
            <>
              <button type="button" className="btn btn-ghost" onClick={addPages}>
                <Plus size={16} />
                Add pages
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={removeCurrentSpread}
                disabled={binder.pages.length <= 2 || turning || !coverOpen}
                title={
                  binder.pages.length <= 2
                    ? 'Keep at least one spread'
                    : 'Remove this spread (both pages)'
                }
              >
                <Minus size={16} />
                Remove pages
              </button>
            </>
          )}
        </div>

        <AnimatePresence>
          {!readOnly && selected && (
            <motion.p
              className="muted"
              style={{ textAlign: 'center', marginTop: '0.75rem' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              Pocket selected on page {selected.page + 1}, slot {selected.slot + 1}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {!readOnly && (
        <section className="binder-tools" aria-label="Binder options">
          <div className="panel tool-block tool-block-collection">
            <h3>Place from collection</h3>
            <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
              {pocketsReady
                ? 'Click a card to fill the next empty pocket. New pages are added when the binder is full.'
                : 'Open the front cover first, then click a card to place it.'}
            </p>
            <div className="collection-search">
              <Search size={16} aria-hidden />
              <input
                type="search"
                value={collectionQuery}
                onChange={(e) => setCollectionQuery(e.target.value)}
                placeholder="Search by name, set, number…"
                aria-label="Search collection"
              />
            </div>
            {pocketsReady && selected ? (
              <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem' }}>
                <button type="button" className="btn btn-ghost" onClick={clearSelectedSlot}>
                  <Eraser size={16} />
                  Clear pocket
                </button>
              </div>
            ) : (
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                {pocketsReady
                  ? 'Cards go into the next empty pocket automatically.'
                  : 'Binder is closed.'}
              </p>
            )}
            <div className="picker-rail">
              {collection.length === 0 && (
                <div className="empty-state">Add cards to your collection first.</div>
              )}
              {collection.length > 0 && filteredCollection.length === 0 && (
                <div className="empty-state">
                  No cards match “{collectionQuery.trim()}”.
                </div>
              )}
              {filteredCollection.map((card) => {
                const inBinder = usedInBinder.has(card.id);
                return (
                  <button
                    key={card.id}
                    type="button"
                    className={`picker-item ${inBinder ? 'used' : ''}`}
                    disabled={!pocketsReady || inBinder}
                    onClick={() => placeCard(card.id)}
                    style={{ '--hue': card.imageHue } as CSSProperties}
                  >
                    <span className="thumb" style={cardArtStyle(card)} />
                    <span>
                      <strong style={{ display: 'block', fontSize: '0.85rem' }}>{card.name}</strong>
                      <span className="muted" style={{ fontSize: '0.75rem' }}>
                        {card.set} #{card.number}
                      </span>
                    </span>
                    <span className="muted" style={{ fontSize: '0.7rem' }}>
                      {inBinder ? 'In binder' : 'Place'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="panel tool-block">
            <h3>Binder style</h3>
            <div className="style-options">
              {BINDER_STYLES.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  className={`style-chip ${binder.style === style.id ? 'active' : ''}`}
                  onClick={() => patchBinder({ style: style.id })}
                >
                  <span className="style-swatch" style={{ background: style.cover }} />
                  {style.label}
                </button>
              ))}
            </div>
          </div>

          <div className="panel tool-block">
            <h3>Page size</h3>
            <div className="size-options">
              {BINDER_SIZES.map((size) => (
                <button
                  key={size.id}
                  type="button"
                  className={`size-chip ${binder.size === size.id ? 'active' : ''}`}
                  onClick={() => {
                    if (size.id === binder.size) return;
                    const nextSlots = SLOT_COUNTS[size.id];
                    const pages = binder.pages.map((page) => ({
                      slots: Array.from({ length: nextSlots }, (_, i) => page.slots[i] ?? null),
                    }));
                    patchBinder({ size: size.id, pages });
                  }}
                >
                  <div>
                    <strong>{size.label}</strong>
                    <div className="muted" style={{ fontSize: '0.8rem' }}>
                      {size.desc}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {detailCard && detailSlot && (
        <CardDetailModal
          card={detailCard}
          pageLabel={`Page ${detailSlot.page + 1}, pocket ${detailSlot.slot + 1}`}
          readOnly={readOnly}
          onClose={() => setDetailSlot(null)}
          onSelectPocket={
            readOnly
              ? undefined
              : () => {
                  setSelected(detailSlot);
                  setDetailSlot(null);
                }
          }
          onClearPocket={
            readOnly
              ? undefined
              : () => {
                  setSlot(binder.id, detailSlot.page, detailSlot.slot, null);
                  if (
                    selected?.page === detailSlot.page &&
                    selected.slot === detailSlot.slot
                  ) {
                    setSelected(null);
                  }
                  setDetailSlot(null);
                }
          }
        />
      )}
    </div>
  );
}
