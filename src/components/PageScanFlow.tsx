import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Camera,
  Check,
  ChevronDown,
  Crop,
  ImagePlus,
  Loader2,
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { CARD_ASPECT, ImageCropModal } from './ImageCropModal';
import { RarityOptions } from './RarityOptions';
import { createDemoGridDetector } from '../lib/detect/demoGrid';
import { roboflowDetector } from '../lib/detect/roboflow';
import { identifyCroppedCard, clearIdentifyCache, type CropIdentification } from '../lib/identifyCard';
import { resetCardReader } from '../lib/cardRead';
import { searchPokemonCards } from '../lib/pokemonTcg';
import { cardImageSrc } from '../lib/cardImage';
import {
  expandAxisAlignedCorners,
  loadImage,
  loadPhotoScaled,
  normalizeOrientedImage,
  shrinkDataUrl,
  straightenCard,
} from '../lib/pageImage';
import { makeId } from '../lib/ids';
import { useStore } from '../store/Store';
import { describePriceSource, formatCardPrice, resolveJustTcgPrice } from '../lib/justtcgClient';
import {
  CARD_CONDITIONS,
  userHasPremium,
  type CardCondition,
  type DetectorId,
  type ImagePoint,
  type PageDetection,
} from '../types';

type Step = 'upload' | 'adjust' | 'review' | 'saved';

const CHECK_NOTE =
  'Review each suggestion before you save. Accept a match, pick another printing, edit the details, or save the photo unidentified. Matches are never confirmed for you.';

const FREE_CHECK_NOTE =
  'Edit each card’s details by hand, then save to your collection. Auto detection is available with Premium.';

/** Extra bleed around each demo-grid cell when cutting card photos. */
const DEMO_GRID_CROP_PAD = 24;

/** Kept in memory only, so re-crops start from a sharp photo. */
const BATCH_SOURCE_MAX_SIDE = 2000;
/** What gets saved with each card — small enough that dozens fit in localStorage. */
const BATCH_CARD_MAX_SIDE = 720;

type BatchStatus = { label: string; tone: 'busy' | 'check' | 'ok' | 'todo' };

function batchStatus(item: PageDetection): BatchStatus {
  switch (item.matchStatus) {
    case 'reading':
      return item.matchProgress == null
        ? { label: 'Queued', tone: 'busy' }
        : { label: `Reading ${Math.round(item.matchProgress * 100)}%`, tone: 'busy' };
    case 'suggested':
      return { label: 'Check match', tone: 'check' };
    case 'accepted':
      return { label: 'Matched', tone: 'ok' };
    case 'manual':
      return item.name.trim() ? { label: 'Ready', tone: 'ok' } : { label: 'Add details', tone: 'todo' };
    case 'unidentified':
      return { label: 'Unidentified', tone: 'todo' };
    default:
      return { label: 'Add details', tone: 'todo' };
  }
}

function renumber(items: PageDetection[]): PageDetection[] {
  return items.map((item, index) => ({ ...item, index: index + 1 }));
}

function mapCandidate(candidate: {
  externalId: string;
  name: string;
  set: string;
  number: string;
  rarity?: PageDetection['rarity'];
  imageUrl: string;
  score: number;
  reason?: string;
}) {
  return {
    externalId: candidate.externalId,
    name: candidate.name,
    set: candidate.set,
    number: candidate.number,
    rarity: candidate.rarity,
    imageUrl: candidate.imageUrl,
    score: candidate.score,
    reason: candidate.reason,
  };
}

function patchFromIdentification(result: CropIdentification): Partial<PageDetection> {
  const candidates = result.candidates.map(mapCandidate);
  const more = result.moreCandidates.map(mapCandidate);
  const diagnostics = result.diagnostics
    ? {
        identifiers: result.diagnostics.identifiers as unknown as Record<string, unknown>,
        mode: result.diagnostics.mode,
        accepted: result.diagnostics.accepted,
        rejected: result.diagnostics.rejected.map((r) => ({
          name: r.name,
          set: r.set,
          number: r.number,
          reason: r.reason,
        })),
      }
    : undefined;

  if (result.status === 'suggested' && result.suggested) {
    return {
      name: result.suggested.name,
      game: 'Pokémon TCG',
      set: result.suggested.set,
      cardNumber: result.suggested.number,
      rarity: result.suggested.rarity,
      catalogueImageUrl: result.suggested.imageUrl,
      externalId: undefined,
      matchStatus: 'suggested',
      matchNote: result.note,
      matchCandidates: candidates,
      matchMoreCandidates: more,
      needsCollectorNumber: result.needsCollectorNumber,
      matchDiagnostics: diagnostics,
    };
  }
  return {
    name: result.details.name ?? '',
    game: result.details.name ? 'Pokémon TCG' : '',
    set: result.details.set ?? '',
    cardNumber: result.details.number ?? '',
    // No printing matched: fall back to whatever rarity the card's own text gave away
    rarity: result.details.rarity,
    catalogueImageUrl: undefined,
    externalId: undefined,
    matchStatus:
      result.status === 'needs-number'
        ? 'needs-number'
        : result.status === 'failed'
          ? 'failed'
          : 'unidentified',
    matchNote: result.note,
    matchCandidates: candidates,
    matchMoreCandidates: more,
    needsCollectorNumber: result.needsCollectorNumber ?? result.status === 'needs-number',
    matchDiagnostics: diagnostics,
  };
}

type LineDrag = { kind: 'line'; axis: 'x' | 'y'; index: number };

function gridCuts(items: PageDetection[], cols: number, rows: number) {
  if (cols < 1 || rows < 1 || items.length !== cols * rows) return null;
  const xs = items.slice(0, cols).map((item) => item.corners[0].x);
  xs.push(items[cols - 1].corners[1].x);
  const ys: number[] = [];
  for (let row = 0; row < rows; row++) ys.push(items[row * cols].corners[0].y);
  ys.push(items[(rows - 1) * cols].corners[3].y);
  return { xs, ys };
}

function moveGridLine(
  items: PageDetection[],
  cols: number,
  rows: number,
  axis: 'x' | 'y',
  index: number,
  value: number,
  limit: number,
): PageDetection[] {
  const cuts = gridCuts(items, cols, rows);
  if (!cuts) return items;
  const lines = axis === 'x' ? cuts.xs : cuts.ys;
  const gap = Math.max(8, limit * 0.02);
  const min = index === 0 ? 0 : lines[index - 1] + gap;
  const max = index === lines.length - 1 ? limit : lines[index + 1] - gap;
  const next = Math.min(max, Math.max(min, value));
  return items.map((item, cell) => {
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    const corners = item.corners.map((corner) => ({ ...corner })) as PageDetection['corners'];
    if (axis === 'x') {
      if (col === index) {
        corners[0].x = next;
        corners[3].x = next;
      }
      if (col === index - 1) {
        corners[1].x = next;
        corners[2].x = next;
      }
    } else if (row === index) {
      corners[0].y = next;
      corners[1].y = next;
    } else if (row === index - 1) {
      corners[2].y = next;
      corners[3].y = next;
    }
    return { ...item, corners };
  });
}

export function PageScanFlow({
  mode = 'page',
  defaultCols = 3,
  defaultRows = 3,
}: {
  mode?: 'page' | 'card';
  defaultCols?: number;
  defaultRows?: number;
} = {}) {
  const { savePageImport, user } = useStore();
  const isPremium = userHasPremium(user);
  const inputRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<Step>('upload');
  const [draggingFile, setDraggingFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [importId, setImportId] = useState('');
  const [detectorId, setDetectorId] = useState<DetectorId>('demo-grid');
  const [cols, setCols] = useState(defaultCols);
  const [rows, setRows] = useState(defaultRows);
  const [detections, setDetections] = useState<PageDetection[]>([]);
  const [grabbing, setGrabbing] = useState(false);
  const [zoom, setZoom] = useState(1);
  const dragRef = useRef<LineDrag | null>(null);
  const activeDetectorId: DetectorId = isPremium ? detectorId : 'demo-grid';
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [croppingId, setCroppingId] = useState<string | null>(null);
  const [pageCropOpen, setPageCropOpen] = useState(false);
  const [showMoreIds, setShowMoreIds] = useState<Set<string>>(() => new Set());
  const [manualSearchId, setManualSearchId] = useState<string | null>(null);
  const [manualQuery, setManualQuery] = useState('');
  const [manualResults, setManualResults] = useState<
    NonNullable<PageDetection['matchCandidates']>
  >([]);
  const [manualBusy, setManualBusy] = useState(false);
  // Card mode: one detection per uploaded photo
  const isBatch = mode === 'card';
  const [batchSources, setBatchSources] = useState<Record<string, string>>({});
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [loadingPhotos, setLoadingPhotos] = useState(0);
  /** Cards whose price lookup the owner started and that hasn't come back yet. */
  const [pricingIds, setPricingIds] = useState<Set<string>>(() => new Set());
  const detectionsRef = useRef(detections);
  detectionsRef.current = detections;
  const identifyQueueRef = useRef<{ id: string; imageDataUrl: string }[]>([]);
  const identifyRunningRef = useRef(false);
  /** Latest crop asked for per card; state can lag behind, so the queue tracks it itself. */
  const latestCropRef = useRef(new Map<string, string>());

  /** One OCR pass at a time — the shared reader can't run in parallel. */
  function enqueueIdentify(id: string, imageDataUrl: string) {
    latestCropRef.current.set(id, imageDataUrl);
    identifyQueueRef.current = [...identifyQueueRef.current.filter((entry) => entry.id !== id), { id, imageDataUrl }];
    void runIdentifyQueue();
  }

  async function runIdentifyQueue() {
    if (identifyRunningRef.current) return;
    identifyRunningRef.current = true;
    // Skip results for cards that were re-cropped or removed while waiting
    const stale = (entry: { id: string; imageDataUrl: string }) =>
      latestCropRef.current.get(entry.id) !== entry.imageDataUrl;
    try {
      await resetCardReader();
      while (identifyQueueRef.current.length > 0) {
        const entry = identifyQueueRef.current.shift()!;
        if (stale(entry)) continue;
        let shownPercent = 0;
        patchDetection(entry.id, { matchProgress: 0 });
        try {
          const result = await identifyCroppedCard(entry.imageDataUrl, (fraction) => {
            const percent = Math.round(fraction * 100);
            // Whole-percent steps only: a re-render per OCR tick isn't worth it
            if (percent === shownPercent || stale(entry)) return;
            shownPercent = percent;
            patchDetection(entry.id, { matchProgress: fraction });
          });
          if (!stale(entry)) patchDetection(entry.id, patchFromIdentification(result));
        } catch (err) {
          await resetCardReader();
          if (!stale(entry)) {
            patchDetection(entry.id, {
              matchStatus: 'failed',
              matchNote: err instanceof Error ? err.message : 'Could not identify this card.',
              matchCandidates: [],
              catalogueImageUrl: undefined,
              externalId: undefined,
            });
          }
        }
      }
    } finally {
      identifyRunningRef.current = false;
    }
  }

  /**
   * A new crop only replaces the picture: the match, details and price stay. A card still
   * waiting in the queue reads the tighter crop when its turn comes; one being read finishes as is.
   * “Scan again” is there for a deliberate re-read.
   */
  function applyCrop(id: string, imageDataUrl: string) {
    patchDetection(id, { imageDataUrl });
    const queued = identifyQueueRef.current.find((entry) => entry.id === id);
    if (queued) {
      queued.imageDataUrl = imageDataUrl;
      latestCropRef.current.set(id, imageDataUrl);
    }
  }

  function handleFiles(list: FileList | File[] | null | undefined) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    if (!isBatch) {
      void handleFile(files[0]);
      return;
    }
    void addBatchPhotos(files);
  }

  async function addBatchPhotos(files: File[]) {
    setError(null);
    setSavedMessage(null);
    const images = files.filter((file) => file.type.startsWith('image/'));
    const skipped = files.length - images.length;
    if (images.length === 0) {
      setError(files.length === 1 ? 'That file is not an image.' : 'None of those files are images.');
      return;
    }
    const batchId = importId || makeId('import');
    if (!importId) setImportId(batchId);
    setStep('review');
    setLoadingPhotos((n) => n + images.length);
    let failed = 0;
    // One at a time keeps memory flat when someone drops 30 phone photos
    for (const file of images) {
      try {
        const source = await loadPhotoScaled(file, BATCH_SOURCE_MAX_SIDE);
        const imageDataUrl = await shrinkDataUrl(source.dataUrl, BATCH_CARD_MAX_SIDE);
        const det: PageDetection = {
          id: makeId('det'),
          importId: batchId,
          index: 0,
          corners: [
            { x: 0, y: 0 },
            { x: source.width, y: 0 },
            { x: source.width, y: source.height },
            { x: 0, y: source.height },
          ],
          included: true,
          imageDataUrl,
          name: '',
          game: '',
          set: '',
          cardNumber: '',
          quantity: 1,
          matchStatus: isPremium ? 'reading' : 'manual',
          matchNote: isPremium ? 'Reading name and collector number…' : undefined,
          matchCandidates: [],
        };
        setBatchSources((prev) => ({ ...prev, [det.id]: source.dataUrl }));
        setDetections((prev) => renumber([...prev, det]));
        if (isPremium) enqueueIdentify(det.id, imageDataUrl);
      } catch {
        failed += 1;
      } finally {
        setLoadingPhotos((n) => n - 1);
      }
    }
    const problems = failed + skipped;
    if (problems > 0) {
      setError(`${problems} file${problems === 1 ? '' : 's'} couldn’t be read as a photo and ${problems === 1 ? 'was' : 'were'} skipped.`);
    }
  }

  function removeBatchCard(id: string) {
    const remaining = detectionsRef.current.filter((item) => item.id !== id);
    if (remaining.length === 0) {
      resetBatch();
      return;
    }
    latestCropRef.current.delete(id);
    setDetections((prev) => renumber(prev.filter((item) => item.id !== id)));
    setBatchSources((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function resetBatch() {
    identifyQueueRef.current = [];
    latestCropRef.current.clear();
    setDetections([]);
    setBatchSources({});
    setExpandedIds(new Set());
    setImportId('');
    setStep('upload');
    setError(null);
    setManualSearchId(null);
    setManualResults([]);
    setShowMoreIds(new Set());
  }

  async function handleFile(file: File) {
    setError(null);
    setNote(null);
    setSavedMessage(null);
    setDetections([]);
    setZoom(1);
    setStep('upload');
    setPageCropOpen(false);
    if (!file.type.startsWith('image/')) {
      setError('That file is not an image.');
      return;
    }
    try {
      const oriented = await normalizeOrientedImage(file);
      setImageUrl(oriented.dataUrl);
      setWidth(oriented.width);
      setHeight(oriented.height);
      setImportId(makeId('import'));
      setNote('Crop the photo to the cards, then we’ll outline them for review.');
      setPageCropOpen(true);
    } catch {
      setError('Could not read that image. Try another photo.');
    }
  }

  async function applyPageCrop(croppedDataUrl: string) {
    setPageCropOpen(false);
    setBusy(true);
    setError(null);
    try {
      const image = await loadImage(croppedDataUrl);
      setImageUrl(croppedDataUrl);
      setWidth(image.naturalWidth);
      setHeight(image.naturalHeight);
      setDetections([]);
      setZoom(1);
      setNote('Crop saved. Outlining cards…');
      await runDetect(croppedDataUrl, image.naturalWidth, image.naturalHeight);
    } catch {
      setError('Could not apply that crop. Try again.');
      setBusy(false);
    }
  }

  async function runDetect(sourceUrl?: string, sourceWidth?: number, sourceHeight?: number) {
    const dataUrl = sourceUrl ?? imageUrl;
    const w = sourceWidth ?? width;
    const h = sourceHeight ?? height;
    if (!dataUrl || !w || !h) return;
    if (!isPremium && detectorId !== 'demo-grid') setDetectorId('demo-grid');
    setBusy(true);
    setError(null);
    try {
      const detector =
        activeDetectorId === 'demo-grid' ? createDemoGridDetector(cols, rows) : roboflowDetector;
      const result = await detector.detect({ dataUrl, width: w, height: h });
      const next = result.boxes.map((box, index) => ({
        id: makeId('det'),
        importId,
        index: index + 1,
        corners: box.corners,
        included: true,
        name: '',
        game: '',
        set: '',
        cardNumber: '',
        quantity: 1,
      }));
      setDetections(next);
      setNote(
        activeDetectorId === 'demo-grid'
          ? `${result.note} Drag the horizontal and vertical lines, and zoom the photo until each card sits in a section. Crop a single card again after review if it needs a tighter fit.`
          : result.note,
      );
      setStep('adjust');
      if (next.length === 0) {
        setError('No cards were found. Add a box for each card you can see.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Card detection failed.');
    } finally {
      setBusy(false);
    }
  }

  function pointFromClient(clientX: number, clientY: number): ImagePoint | null {
    const frame = frameRef.current;
    if (!frame || !width || !height) return null;
    const rect = frame.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * width;
    const y = ((clientY - rect.top) / rect.height) * height;
    return {
      x: Math.min(width, Math.max(0, x)),
      y: Math.min(height, Math.max(0, y)),
    };
  }

  function applyDrag(clientX: number, clientY: number) {
    const drag = dragRef.current;
    const point = pointFromClient(clientX, clientY);
    if (!drag || !point) return;
    setDetections((prev) =>
      moveGridLine(
        prev,
        cols,
        rows,
        drag.axis,
        drag.index,
        drag.axis === 'x' ? point.x : point.y,
        drag.axis === 'x' ? width : height,
      ),
    );
  }

  function beginDrag(event: ReactPointerEvent<SVGElement>, drag: LineDrag) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
    dragRef.current = drag;
    setGrabbing(true);
  }

  function endDrag(event: ReactPointerEvent<SVGElement>) {
    const svg = event.currentTarget.ownerSVGElement;
    if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setGrabbing(false);
  }

  function addBox() {
    const boxW = width * 0.22;
    const boxH = height * 0.28;
    const x = (width - boxW) / 2;
    const y = (height - boxH) / 2;
    const next: PageDetection = {
      id: makeId('det'),
      importId,
      index: detections.length + 1,
      included: true,
      name: '',
      game: '',
      set: '',
      cardNumber: '',
      quantity: 1,
      corners: [
        { x, y },
        { x: x + boxW, y },
        { x: x + boxW, y: y + boxH },
        { x, y: y + boxH },
      ],
    };
    setDetections((prev) => renumber([...prev, next]));
    setError(null);
  }

  function removeBox(id: string) {
    setDetections((prev) => renumber(prev.filter((item) => item.id !== id)));
  }

  async function goReview() {
    const included = detections.filter((item) => item.included);
    if (!imageUrl || included.length === 0) {
      setError('Add at least one card outline before review.');
      return;
    }
    const activeDetector: DetectorId = activeDetectorId;
    setBusy(true);
    setError(null);
    try {
      const image = await loadImage(imageUrl);
      const extracted = await Promise.all(
        detections.map(async (item) => {
          if (!item.included) return item;
          const corners =
            activeDetector === 'demo-grid'
              ? expandAxisAlignedCorners(item.corners, DEMO_GRID_CROP_PAD, width, height)
              : item.corners;
          const imageDataUrl = await straightenCard(image, corners);
          if (!isPremium) {
            return {
              ...item,
              imageDataUrl,
              matchStatus: 'manual' as const,
              matchNote: 'Enter card details manually, or unlock Premium for auto detection.',
              matchCandidates: [],
              catalogueImageUrl: undefined,
              externalId: undefined,
            };
          }
          return {
            ...item,
            imageDataUrl,
            matchStatus: 'reading' as const,
            matchNote: 'Reading name and collector number…',
            matchCandidates: [],
            catalogueImageUrl: undefined,
            externalId: undefined,
          };
        }),
      );
      setDetections(extracted);
      setStep('review');
      setBusy(false);

      if (!isPremium) return;

      clearIdentifyCache();
      await resetCardReader();

      // One card at a time — shared OCR worker cannot parallelize, and Promise.all
      // left every pocket stuck on “Reading name…” when one pass hung.
      let rolling = extracted;
      for (const item of extracted) {
        if (!item.included || !item.imageDataUrl) continue;
        try {
          const result = await identifyCroppedCard(item.imageDataUrl);
          const patched = { ...item, ...patchFromIdentification(result) };
          rolling = rolling.map((row) => (row.id === item.id ? patched : row));
          setDetections(rolling);
        } catch (err) {
          const failed = {
            ...item,
            matchStatus: 'failed' as const,
            matchNote: err instanceof Error ? err.message : 'Could not identify this card.',
            matchCandidates: [],
            catalogueImageUrl: undefined,
            externalId: undefined,
          };
          rolling = rolling.map((row) => (row.id === item.id ? failed : row));
          setDetections(rolling);
          await resetCardReader();
        }
      }
    } catch {
      setError('Could not crop one of the cards. Adjust its corners and try again.');
      setBusy(false);
    }
  }

  async function identifyOne(id: string, imageDataUrl: string) {
    if (!isPremium) {
      patchDetection(id, {
        imageDataUrl,
        matchStatus: 'manual',
        matchNote: 'Enter card details manually, or unlock Premium for auto detection.',
        matchCandidates: [],
        catalogueImageUrl: undefined,
        externalId: undefined,
      });
      return;
    }
    patchDetection(id, {
      imageDataUrl,
      matchStatus: 'reading',
      matchProgress: undefined,
      matchNote: 'Reading name and collector number…',
      matchCandidates: [],
      catalogueImageUrl: undefined,
      externalId: undefined,
    });
    enqueueIdentify(id, imageDataUrl);
  }

  function acceptMatch(id: string, candidate: NonNullable<PageDetection['matchCandidates']>[number]) {
    patchDetection(id, {
      name: candidate.name,
      game: 'Pokémon TCG',
      set: candidate.set,
      cardNumber: candidate.number,
      rarity: candidate.rarity,
      catalogueImageUrl: candidate.imageUrl,
      externalId: candidate.externalId,
      matchStatus: 'accepted',
      matchNote: `Accepted ${candidate.name} · ${candidate.set} · #${candidate.number}.`,
      condition: undefined,
      printing: undefined,
      justtcgCardId: undefined,
      justtcgVariantId: undefined,
      justtcgPrintings: undefined,
      price: null,
      // Not looked up: prices are only fetched when the owner asks
      priceStatus: undefined,
    });
  }

  function markUnidentified(id: string) {
    patchDetection(id, {
      name: '',
      game: '',
      set: '',
      cardNumber: '',
      rarity: undefined,
      catalogueImageUrl: undefined,
      externalId: undefined,
      matchStatus: 'unidentified',
      matchNote: 'Saved as an unidentified crop. You can fill details later from the collection.',
      condition: undefined,
      printing: undefined,
      justtcgCardId: undefined,
      justtcgVariantId: undefined,
      justtcgPrintings: undefined,
      price: null,
      priceStatus: 'unavailable',
    });
  }

  function patchDetection(id: string, patch: Partial<PageDetection>) {
    setDetections((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function editField(id: string, patch: Partial<PageDetection>) {
    patchDetection(id, {
      ...patch,
      matchStatus: 'manual',
      externalId: undefined,
      matchNote: 'Edited manually. Catalogue id cleared until you accept a printing.',
      justtcgCardId: undefined,
      justtcgVariantId: undefined,
      justtcgPrintings: undefined,
      price: null,
      priceStatus: 'unavailable',
    });
  }

  /** Records the condition only — a price is per condition, so any earlier one no longer applies. */
  function chooseCondition(id: string, condition: CardCondition) {
    const item = detections.find((det) => det.id === id);
    if (!item || item.condition === condition) return;
    patchDetection(id, {
      condition,
      justtcgVariantId: undefined,
      justtcgPrintings: undefined,
      price: null,
      priceStatus: undefined,
    });
  }

  async function fetchPrice(id: string, printing?: string) {
    const item = detections.find((det) => det.id === id);
    if (!item || item.matchStatus !== 'accepted' || !item.condition) return;
    const condition = item.condition;
    setPricingIds((prev) => new Set(prev).add(id));
    patchDetection(id, {
      printing: printing ?? item.printing,
      price: null,
      justtcgCardId: undefined,
      justtcgVariantId: undefined,
      justtcgPrintings: printing ? undefined : item.justtcgPrintings,
    });
    try {
      const result = await resolveJustTcgPrice({
        name: item.name,
        set: item.set,
        number: item.cardNumber,
        condition,
        printing: printing ?? item.printing,
        externalId: item.externalId,
      });
      if (result.status === 'priced') {
        patchDetection(id, {
          condition,
          printing: result.printing,
          justtcgCardId: result.justtcgCardId,
          justtcgVariantId: result.justtcgVariantId,
          justtcgPrintings: undefined,
          price: result.price,
          priceStatus: 'priced',
          matchNote: `Accepted · ${condition} · ${result.printing}. Prototype price: ${describePriceSource(result.price, condition)}.`,
        });
        return;
      }
      if (result.status === 'needs_printing') {
        patchDetection(id, {
          condition,
          justtcgCardId: result.justtcgCardId,
          justtcgPrintings: result.printings,
          justtcgVariantId: undefined,
          price: null,
          priceStatus: 'pending',
          matchNote: 'Pick the exact JustTCG printing for this condition.',
        });
        return;
      }
      patchDetection(id, {
        condition,
        printing: printing ?? item.printing,
        justtcgCardId: undefined,
        justtcgVariantId: undefined,
        justtcgPrintings: undefined,
        price: null,
        priceStatus: 'unavailable',
        matchNote: result.reason || 'Price unavailable',
      });
    } catch (err) {
      patchDetection(id, {
        condition,
        price: null,
        priceStatus: 'unavailable',
        matchNote: err instanceof Error ? err.message : 'Price unavailable',
      });
    } finally {
      setPricingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  function confirmSave() {
    if ((!isBatch && !imageUrl) || !importId || step === 'saved') return;
    const toSave = detections.map((det) => {
      if (!det.included) return det;
      if (det.matchStatus === 'accepted' && det.externalId) {
        return {
          ...det,
          // Left unset when never looked up, so the binder's “Get all prices” picks it up
          priceStatus: det.priceStatus,
        };
      }
      return {
        ...det,
        externalId: undefined,
        justtcgCardId: undefined,
        justtcgVariantId: undefined,
        justtcgPrintings: undefined,
        price: null,
        priceStatus: undefined,
      };
    });
    const status = savePageImport({
      importId,
      imageDataUrl: imageUrl ?? '',
      width,
      height,
      detectorId: activeDetectorId,
      detections: toSave,
    });
    if (status === 'storage-full') {
      setError(
        'Your browser’s storage is full, so these cards weren’t saved. Remove some cards from your collection and try again.',
      );
      return;
    }
    setError(null);
    if (isBatch) {
      const saved = toSave.reduce((sum, det) => sum + (det.included ? Math.max(1, det.quantity) : 0), 0);
      resetBatch();
      setSavedMessage(
        status === 'duplicate'
          ? 'These cards are already in your collection.'
          : `Saved ${saved} card${saved === 1 ? '' : 's'} to your collection.`,
      );
      return;
    }
    setSavedMessage(
      status === 'duplicate'
        ? 'These cards are already in your collection.'
        : 'Saved to your collection. Place them in a binder from the collection picker.',
    );
  }

  function scanAnother() {
    if (
      !savedMessage &&
      !confirm(`Discard this scan? It hasn’t been saved to your collection.`)
    ) {
      return;
    }
    setDetections([]);
    setImageUrl(null);
    setImportId('');
    setStep('upload');
    setNote(null);
    setError(null);
    setSavedMessage(null);
    setZoom(1);
    setCroppingId(null);
    setShowMoreIds(new Set());
    setManualSearchId(null);
    setManualQuery('');
    setManualResults([]);
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.click();
    }
  }

  const croppingCard = detections.find((item) => item.id === croppingId) ?? null;

  return (
    <div className="page-scan">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        // `capture` forces the camera on phones, which blocks picking several gallery photos
        capture={isBatch ? undefined : 'environment'}
        multiple={isBatch}
        hidden
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = '';
        }}
      />
      {step === 'upload' && (
        <div
          className={`scan-drop ${draggingFile ? 'dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDraggingFile(true);
          }}
          onDragLeave={() => setDraggingFile(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDraggingFile(false);
            handleFiles(event.dataTransfer.files);
          }}
        >
          <ImagePlus size={36} color="#2c71f6" />
          <strong>{isBatch ? 'Drop your card photos' : 'Drop a photo of a binder page'}</strong>
          <p className="muted" style={{ margin: 0 }}>
            {isBatch
              ? 'Add as many as you like — one card per photo. You’ll check and crop each one next.'
              : 'Cards are outlined, reviewed, then saved to your collection. They are not placed in a binder.'}
          </p>
          <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()}>
            <Camera size={16} /> {isBatch ? 'Choose photos' : 'Choose photo'}
          </button>
        </div>
      )}

      {imageUrl && step !== 'review' && step !== 'saved' && (
        <div style={{ display: 'grid', gap: '0.85rem', marginTop: step === 'upload' ? '1.25rem' : 0 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <div className="field" style={{ margin: 0, minWidth: 180 }}>
              <label htmlFor="page-detector">Detector</label>
              <select
                id="page-detector"
                value={activeDetectorId}
                onChange={(event) => {
                  const next = event.target.value as DetectorId;
                  if (next === 'roboflow' && !isPremium) return;
                  setDetectorId(next);
                }}
              >
                <option value="demo-grid">Demo grid</option>
                <option value="roboflow" disabled={!isPremium}>
                  {isPremium ? 'Binder Card Edges' : 'Binder Card Edges (Premium)'}
                </option>
              </select>
            </div>
            {activeDetectorId === 'demo-grid' && (
              <>
                <div className="field" style={{ margin: 0, width: 90 }}>
                  <label htmlFor="demo-cols">Columns</label>
                  <input
                    id="demo-cols"
                    type="number"
                    min={1}
                    max={8}
                    value={cols}
                    onChange={(event) => setCols(Math.min(8, Math.max(1, Number(event.target.value) || 1)))}
                  />
                </div>
                <div className="field" style={{ margin: 0, width: 90 }}>
                  <label htmlFor="demo-rows">Rows</label>
                  <input
                    id="demo-rows"
                    type="number"
                    min={1}
                    max={8}
                    value={rows}
                    onChange={(event) => setRows(Math.min(8, Math.max(1, Number(event.target.value) || 1)))}
                  />
                </div>
              </>
            )}
          </div>
          {!isPremium && (
            <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
              Free includes manual demo-grid cropping and hand-edited card details.{' '}
              <Link to="/premium">Unlock Premium</Link> for AI cropping (Binder Card Edges) and automatic
              card information detection.
            </p>
          )}

          {step === 'adjust' && (
            <div className="page-scan-zoom">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={zoom <= 1}
                onClick={() => setZoom((value) => Math.max(1, Math.round((value - 0.25) * 100) / 100))}
              >
                <ZoomOut size={16} /> Zoom out
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={zoom >= 4}
                onClick={() => setZoom((value) => Math.min(4, Math.round((value + 0.25) * 100) / 100))}
              >
                <ZoomIn size={16} /> Zoom in
              </button>
            </div>
          )}

          <div className="page-scan-scroll">
          <div
            ref={frameRef}
            className="page-scan-frame"
            data-dragging={grabbing ? '1' : '0'}
            style={{ width: `${zoom * 100}%` }}
          >
            <img src={imageUrl} alt="Binder page" draggable={false} />
            {step === 'adjust' && (
              <svg
                viewBox={`0 0 ${width} ${height}`}
                className="page-scan-overlay"
                preserveAspectRatio="none"
                onPointerMove={(event) => applyDrag(event.clientX, event.clientY)}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                {detections.map((item) => {
                  const points = item.corners.map((corner) => `${corner.x},${corner.y}`).join(' ');
                  return (
                    <g key={item.id}>
                      <polygon points={points} className="page-scan-box" />
                      <text x={item.corners[0].x + 8} y={item.corners[0].y + 28} className="page-scan-label">
                        {item.index}
                      </text>
                    </g>
                  );
                })}
                {activeDetectorId === 'demo-grid' &&
                  gridCuts(detections, cols, rows)?.xs.map((x, index) => (
                    <g key={`x-${index}`}>
                      <line x1={x} y1={0} x2={x} y2={height} className="page-scan-line page-scan-line--x" />
                      <line
                        x1={x}
                        y1={0}
                        x2={x}
                        y2={height}
                        className="page-scan-line-hit page-scan-line--x"
                        role="button"
                        aria-label={`Vertical crop line ${index + 1}`}
                        onPointerDown={(event) => beginDrag(event, { kind: 'line', axis: 'x', index })}
                      />
                    </g>
                  ))}
                {activeDetectorId === 'demo-grid' &&
                  gridCuts(detections, cols, rows)?.ys.map((y, index) => (
                    <g key={`y-${index}`}>
                      <line x1={0} y1={y} x2={width} y2={y} className="page-scan-line page-scan-line--y" />
                      <line
                        x1={0}
                        y1={y}
                        x2={width}
                        y2={y}
                        className="page-scan-line-hit page-scan-line--y"
                        role="button"
                        aria-label={`Horizontal crop line ${index + 1}`}
                        onPointerDown={(event) => beginDrag(event, { kind: 'line', axis: 'y', index })}
                      />
                    </g>
                  ))}
              </svg>
            )}
          </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {step === 'upload' && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !imageUrl}
                onClick={() => setPageCropOpen(true)}
              >
                <Crop size={16} /> Crop photo
              </button>
            )}
            {step === 'adjust' && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => setPageCropOpen(true)}
                >
                  <Crop size={16} /> Crop photo
                </button>
                {activeDetectorId === 'demo-grid' && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => void runDetect()}
                  >
                    {busy ? <Loader2 size={16} className="spin" /> : null}
                    Update grid
                  </button>
                )}
                <button type="button" className="btn btn-secondary" onClick={addBox}>
                  <Plus size={16} /> Add missed card
                </button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void goReview()}>
                  Review cards
                </button>
              </>
            )}
          </div>
          {step === 'adjust' && (
            <ul className="page-scan-list">
              {detections.map((item) => (
                <li key={item.id}>
                  <span>Card {item.index}</span>
                  <button type="button" className="btn btn-ghost" onClick={() => removeBox(item.id)}>
                    <Trash2 size={14} /> Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {step === 'review' && (
        <section
          className={isBatch ? 'batch-review' : undefined}
          style={isBatch ? undefined : { display: 'grid', gap: '1rem' }}
          onDragOver={
            isBatch
              ? (event) => {
                  event.preventDefault();
                  setDraggingFile(true);
                }
              : undefined
          }
          onDragLeave={isBatch ? () => setDraggingFile(false) : undefined}
          onDrop={
            isBatch
              ? (event) => {
                  event.preventDefault();
                  setDraggingFile(false);
                  handleFiles(event.dataTransfer.files);
                }
              : undefined
          }
          data-dragging={isBatch && draggingFile ? '1' : undefined}
        >
          {isBatch ? (
            <div className="batch-toolbar">
              <div>
                <strong>
                  {detections.length} card{detections.length === 1 ? '' : 's'}
                </strong>
                <span className="muted">
                  {loadingPhotos > 0
                    ? ` · adding ${loadingPhotos} photo${loadingPhotos === 1 ? '' : 's'}…`
                    : isPremium
                      ? ' · accept each match, or open a card to fix it'
                      : ' · open each card to fill in its details'}
                </span>
              </div>
              <button type="button" className="btn btn-secondary" onClick={() => inputRef.current?.click()}>
                <Plus size={16} /> Add photos
              </button>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              {isPremium ? CHECK_NOTE : FREE_CHECK_NOTE}
            </p>
          )}
          {isBatch && !isPremium && (
            <p className="muted batch-hint">
              <Link to="/premium">Premium</Link> reads each card for you automatically.
            </p>
          )}
          <div className={isBatch ? 'batch-list' : undefined} style={isBatch ? undefined : { display: 'contents' }}>
          {detections
            .filter((item) => item.included)
            .map((item) => {
              const top = item.matchCandidates?.[0];
              const showing =
                item.matchCandidates?.find((candidate) => candidate.externalId === item.externalId) ?? top;
              const body = (
                <article
                  key={item.id}
                  className={isBatch ? 'page-scan-review page-scan-review--batch' : 'panel page-scan-review'}
                >
                  {!isBatch && (
                  <div className="page-scan-crop">
                    {item.imageDataUrl && <img src={item.imageDataUrl} alt={`Your crop of card ${item.index}`} />}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={!item.imageDataUrl || item.matchStatus === 'reading'}
                      onClick={() => setCroppingId(item.id)}
                    >
                      <Crop size={16} /> Crop
                    </button>
                  </div>
                  )}
                  {isPremium && (
                  <div className="page-scan-match">
                    {item.matchStatus === 'reading' && (
                      <p className="muted" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Loader2 size={16} className="spin" /> Reading card text…
                      </p>
                    )}
                    {showing?.imageUrl && item.matchStatus !== 'unidentified' && (
                      <div className="page-scan-catalogue">
                        <img
                          src={cardImageSrc(showing.imageUrl, showing.externalId)}
                          alt={`Catalogue art for ${showing.name}`}
                        />
                        <div>
                          <strong>{showing.name}</strong>
                          <p className="muted" style={{ margin: 0 }}>
                            {showing.set} · #{showing.number}
                          </p>
                          <p className="muted" style={{ margin: '0.25rem 0 0' }}>
                            {item.matchStatus === 'accepted'
                              ? 'Match accepted'
                              : item.matchStatus === 'suggested'
                                ? 'Suggestion — not confirmed yet'
                                : item.matchStatus === 'manual'
                                  ? 'Manual edit'
                                  : item.matchNote}
                          </p>
                        </div>
                      </div>
                    )}
                    {item.matchNote && item.matchStatus !== 'accepted' && (
                      <p className="muted" style={{ margin: 0 }}>
                        {item.matchNote}
                      </p>
                    )}
                    {(() => {
                      const expanded = showMoreIds.has(item.id);
                      const list = [
                        ...(item.matchCandidates ?? []),
                        ...(expanded ? item.matchMoreCandidates ?? [] : []),
                      ];
                      if (list.length === 0) return null;
                      return (
                        <div className="page-scan-candidates">
                          {list.map((candidate) => (
                            <button
                              key={candidate.externalId}
                              type="button"
                              className={`page-scan-candidate${
                                item.externalId === candidate.externalId ||
                                (!item.externalId &&
                                  top?.externalId === candidate.externalId &&
                                  item.matchStatus === 'suggested')
                                  ? ' is-active'
                                  : ''
                              }`}
                              onClick={() => acceptMatch(item.id, candidate)}
                            >
                              <img
                                src={cardImageSrc(candidate.imageUrl, candidate.externalId, 'small')}
                                alt=""
                                loading="lazy"
                              />
                              <span>
                                {candidate.name}
                                <small>
                                  {candidate.set} · #{candidate.number}
                                  {import.meta.env.DEV && candidate.reason
                                    ? ` · ${candidate.reason}`
                                    : ''}
                                </small>
                              </span>
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                    <div className="page-scan-match-actions">
                      {top && item.matchStatus === 'suggested' && (
                        <button type="button" className="btn btn-primary" onClick={() => acceptMatch(item.id, top)}>
                          Accept match
                        </button>
                      )}
                      {(item.matchMoreCandidates?.length ?? 0) > 0 && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() =>
                            setShowMoreIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              return next;
                            })
                          }
                        >
                          {showMoreIds.has(item.id)
                            ? 'Show fewer'
                            : `Show all (${item.matchMoreCandidates?.length ?? 0} more)`}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          setManualSearchId(item.id);
                          setManualQuery(item.name || '');
                          setManualResults([]);
                        }}
                      >
                        Search manually
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => markUnidentified(item.id)}>
                        Save unidentified
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={!item.imageDataUrl || item.matchStatus === 'reading'}
                        title="Read this card again from its current crop — replaces the match"
                        onClick={() => item.imageDataUrl && void identifyOne(item.id, item.imageDataUrl)}
                      >
                        Scan again
                      </button>
                    </div>
                    {manualSearchId === item.id && (
                      <div className="page-scan-manual-search" style={{ display: 'grid', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <input
                            value={manualQuery}
                            onChange={(e) => setManualQuery(e.target.value)}
                            placeholder="Name, set, or number…"
                            aria-label="Manual catalogue search"
                            style={{ flex: '1 1 12rem' }}
                          />
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={manualBusy || manualQuery.trim().length < 2}
                            onClick={() => {
                              void (async () => {
                                setManualBusy(true);
                                try {
                                  const cards = await searchPokemonCards(manualQuery.trim(), 12);
                                  setManualResults(
                                    cards
                                      .filter((c) => c.externalId && c.imageUrl)
                                      .map((c) => ({
                                        externalId: c.externalId!,
                                        name: c.name,
                                        set: c.set,
                                        number: c.number,
                                        rarity: c.rarity,
                                        imageUrl: c.imageUrl!,
                                        score: 0,
                                      })),
                                  );
                                } catch (err) {
                                  setError(err instanceof Error ? err.message : 'Search failed.');
                                } finally {
                                  setManualBusy(false);
                                }
                              })();
                            }}
                          >
                            {manualBusy ? 'Searching…' : 'Search'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                              setManualSearchId(null);
                              setManualResults([]);
                            }}
                          >
                            Close
                          </button>
                        </div>
                        {manualResults.length > 0 && (
                          <div className="page-scan-candidates">
                            {manualResults.map((candidate) => (
                              <button
                                key={candidate.externalId}
                                type="button"
                                className="page-scan-candidate"
                                onClick={() => {
                                  acceptMatch(item.id, candidate);
                                  setManualSearchId(null);
                                  setManualResults([]);
                                }}
                              >
                                <img
                                  src={cardImageSrc(candidate.imageUrl, candidate.externalId, 'small')}
                                  alt=""
                                  loading="lazy"
                                />
                                <span>
                                  {candidate.name}
                                  <small>
                                    {candidate.set} · #{candidate.number}
                                  </small>
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {import.meta.env.DEV && item.matchDiagnostics && (
                      <details className="page-scan-diagnostics">
                        <summary>Dev match diagnostics</summary>
                        <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem', margin: 0 }}>
                          {JSON.stringify(item.matchDiagnostics, null, 2)}
                        </pre>
                      </details>
                    )}
                    {item.matchStatus === 'accepted' && (
                      <div className="page-scan-valuation">
                        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                          Condition (optional) — used for valuation. Prices are only looked up when you ask.
                        </p>
                        <div className="page-scan-conditions">
                          {CARD_CONDITIONS.map((condition) => (
                            <button
                              key={condition}
                              type="button"
                              className={`btn ${item.condition === condition ? 'btn-primary' : 'btn-secondary'}`}
                              aria-pressed={item.condition === condition}
                              disabled={pricingIds.has(item.id)}
                              onClick={() => chooseCondition(item.id, condition)}
                            >
                              {condition}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={!item.condition || pricingIds.has(item.id)}
                            title={item.condition ? 'Look up this card’s price' : 'Pick a condition first'}
                            onClick={() => void fetchPrice(item.id)}
                          >
                            {pricingIds.has(item.id) ? <Loader2 size={16} className="spin" /> : null}
                            {item.priceStatus === 'priced' ? 'Refresh price' : 'Get price'}
                          </button>
                        </div>
                        {item.justtcgPrintings && item.justtcgPrintings.length > 0 && item.condition && (
                          <div className="page-scan-printings">
                            <span className="muted">Printing</span>
                            {item.justtcgPrintings.map((printing) => (
                              <button
                                key={printing}
                                type="button"
                                className={`btn ${item.printing === printing ? 'btn-primary' : 'btn-secondary'}`}
                                disabled={pricingIds.has(item.id)}
                                onClick={() => void fetchPrice(item.id, printing)}
                              >
                                {printing}
                              </button>
                            ))}
                          </div>
                        )}
                        <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                          {pricingIds.has(item.id)
                            ? 'Looking up price…'
                            : item.priceStatus === undefined
                              ? item.condition
                                ? 'Not priced yet — press Get price, or price the whole binder later.'
                                : 'Not priced yet.'
                            : item.priceStatus === 'pending'
                              ? 'Pick the exact printing above.'
                            : item.priceStatus === 'priced' && item.price
                              ? `${formatCardPrice(item.price)} · ${item.price.source}${
                                  item.printing ? ` · ${item.printing}` : ''
                                } · refreshed ${new Date(item.price.lastRefreshedAt).toLocaleString()}`
                              : item.matchNote && /justtcg|exact|variant|printing|unavailable|match/i.test(item.matchNote)
                                ? item.matchNote
                                : 'Price unavailable'}
                        </p>
                      </div>
                    )}
                  </div>
                  )}
                  <div className="page-scan-fields">
                    {!isBatch && <strong>Card {item.index}</strong>}
                    <label>
                      Name
                      <input
                        value={item.name}
                        onChange={(event) => editField(item.id, { name: event.target.value })}
                      />
                    </label>
                    <label>
                      Game
                      <input
                        value={item.game}
                        onChange={(event) => editField(item.id, { game: event.target.value })}
                      />
                    </label>
                    <label>
                      Set
                      <input value={item.set} onChange={(event) => editField(item.id, { set: event.target.value })} />
                    </label>
                    <label>
                      Card number
                      <input
                        value={item.cardNumber}
                        onChange={(event) => editField(item.id, { cardNumber: event.target.value })}
                      />
                    </label>
                    <label>
                      Rarity
                      <select
                        value={item.rarity ?? ''}
                        onChange={(event) =>
                          patchDetection(item.id, {
                            rarity: (event.target.value || undefined) as PageDetection['rarity'],
                          })
                        }
                      >
                        <RarityOptions />
                      </select>
                    </label>
                    <label>
                      Quantity
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(event) =>
                          patchDetection(item.id, { quantity: Math.max(1, Number(event.target.value) || 1) })
                        }
                      />
                    </label>
                  </div>
                </article>
              );
              if (!isBatch) return body;

              const status = batchStatus(item);
              const open = expandedIds.has(item.id);
              const title = item.name.trim() || showing?.name || `Card ${item.index}`;
              const detail = item.name.trim()
                ? [item.set, item.cardNumber && `#${item.cardNumber}`].filter(Boolean).join(' · ')
                : showing && item.matchStatus === 'suggested'
                  ? `${showing.set} · #${showing.number}`
                  : '';
              return (
                <div key={item.id} className={`batch-card${open ? ' is-open' : ''}`}>
                  <div className="batch-card__row">
                    <button
                      type="button"
                      className="batch-card__thumb"
                      // The labelled Crop button is the keyboard route; this is a mouse shortcut
                      tabIndex={-1}
                      aria-hidden
                      aria-label={`Crop card ${item.index}`}
                      title="Crop"
                      disabled={!item.imageDataUrl}
                      onClick={() => setCroppingId(item.id)}
                    >
                      {item.imageDataUrl && <img src={item.imageDataUrl} alt="" />}
                      <span className="batch-card__thumb-hint">
                        <Crop size={14} />
                      </span>
                    </button>
                    <button
                      type="button"
                      className="batch-card__summary"
                      aria-expanded={open}
                      onClick={() => toggleExpanded(item.id)}
                    >
                      <span className="batch-card__title">{title}</span>
                      {item.matchStatus === 'reading' ? (
                        <span
                          className="batch-progress"
                          role="progressbar"
                          aria-label={`Identifying card ${item.index}`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round((item.matchProgress ?? 0) * 100)}
                        >
                          <span style={{ width: `${Math.round((item.matchProgress ?? 0) * 100)}%` }} />
                        </span>
                      ) : (
                        detail && <span className="batch-card__detail">{detail}</span>
                      )}
                      <span className={`batch-chip batch-chip--${status.tone}`}>
                        {status.tone === 'busy' && <Loader2 size={12} className="spin" />}
                        {status.tone === 'ok' && <Check size={12} />}
                        {status.label}
                      </span>
                    </button>
                    <div className="batch-card__actions">
                      {top && item.matchStatus === 'suggested' && (
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => acceptMatch(item.id, top)}>
                          Accept
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm batch-crop-btn"
                        aria-label={`Crop card ${item.index}`}
                        title="Crop this card"
                        disabled={!item.imageDataUrl}
                        onClick={() => setCroppingId(item.id)}
                      >
                        <Crop size={14} />
                        <span className="batch-crop-btn__label">Crop</span>
                      </button>
                      <button
                        type="button"
                        className="batch-icon-btn"
                        aria-label={`Remove card ${item.index}`}
                        title="Remove"
                        onClick={() => removeBatchCard(item.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                      <button
                        type="button"
                        className="batch-icon-btn batch-card__chevron"
                        aria-label={open ? 'Hide details' : 'Show details'}
                        aria-expanded={open}
                        onClick={() => toggleExpanded(item.id)}
                      >
                        <ChevronDown size={18} />
                      </button>
                    </div>
                  </div>
                  {open && <div className="batch-card__details">{body}</div>}
                </div>
              );
            })}
          </div>
          {isBatch ? (
            <div className="batch-savebar">
              <button type="button" className="btn btn-ghost" onClick={() => {
                if (confirm('Discard these photos? Nothing has been saved yet.')) resetBatch();
              }}>
                Start over
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={loadingPhotos > 0 || detections.some((item) => item.matchStatus === 'reading')}
                onClick={confirmSave}
              >
                {loadingPhotos > 0 || detections.some((item) => item.matchStatus === 'reading')
                  ? `Reading cards… ${detections.filter((item) => item.matchStatus !== 'reading').length}/${detections.length + loadingPhotos}`
                  : `Save ${detections.length} card${detections.length === 1 ? '' : 's'}`}
              </button>
            </div>
          ) : (
            <div className="page-scan-review-actions">
              <button type="button" className="btn btn-primary" onClick={confirmSave}>
                Save to collection
              </button>
              <button type="button" className="btn btn-secondary" onClick={scanAnother}>
                <Camera size={16} /> Scan another page
              </button>
            </div>
          )}
        </section>
      )}

      {note && <p className="muted">{note}</p>}
      {error && (
        <p className="page-scan-warning" role="alert">
          {error}
        </p>
      )}
      {savedMessage && <p className="page-scan-saved">{savedMessage}</p>}
      {pageCropOpen && imageUrl && (
        <ImageCropModal
          src={imageUrl}
          title={mode === 'card' ? 'Crop card' : 'Crop page'}
          aspect={null}
          onCancel={() => {
            setPageCropOpen(false);
            setNote('Crop the photo when you’re ready, then we’ll outline the cards.');
          }}
          onConfirm={(dataUrl) => {
            void applyPageCrop(dataUrl);
          }}
        />
      )}
      {croppingCard?.imageDataUrl && (
        <ImageCropModal
          key={croppingCard.id}
          src={(isBatch && batchSources[croppingCard.id]) || croppingCard.imageDataUrl}
          title={isBatch ? 'Crop card' : `Crop card ${croppingCard.index}`}
          aspect={isBatch ? CARD_ASPECT : null}
          compact
          onCancel={() => setCroppingId(null)}
          onConfirm={(dataUrl) => {
            const id = croppingCard.id;
            setCroppingId(null);
            if (!isBatch) {
              applyCrop(id, dataUrl);
              return;
            }
            void shrinkDataUrl(dataUrl, BATCH_CARD_MAX_SIDE)
              .then((small) => applyCrop(id, small))
              .catch(() => setError('Could not apply that crop. Try again.'));
          }}
        />
      )}
    </div>
  );
}
