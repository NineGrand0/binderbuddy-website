/**
 * Image embeddings for visual card matching. Shared by the browser matcher and the
 * Node scripts that build the catalogue index, so both sides must preprocess identically:
 * the whole card is stretched to a square (no centre crop — that would cut off the
 * title and attacks), then normalised with the model's mean / std.
 */

export type VisionModelKey = 'dinov2-small' | 'dinov2-small-cm' | 'mobileclip-s0' | 'clip-b32';

export type VisionModelSpec = {
  key: VisionModelKey;
  repo: string;
  kind: 'dinov2' | 'clip';
  /** DINOv2 only: class token alone, or class token + mean of patch tokens. */
  pooling?: 'cls' | 'cls+mean';
  size: number;
  mean: [number, number, number];
  std: [number, number, number];
};

const IMAGENET_MEAN: [number, number, number] = [0.485, 0.456, 0.406];
const IMAGENET_STD: [number, number, number] = [0.229, 0.224, 0.225];
const CLIP_MEAN: [number, number, number] = [0.48145466, 0.4578275, 0.40821073];
const CLIP_STD: [number, number, number] = [0.26862954, 0.26130258, 0.27577711];

export const VISION_MODELS: Record<VisionModelKey, VisionModelSpec> = {
  'dinov2-small': {
    key: 'dinov2-small',
    repo: 'Xenova/dinov2-small',
    kind: 'dinov2',
    pooling: 'cls',
    size: 224,
    mean: IMAGENET_MEAN,
    std: IMAGENET_STD,
  },
  'dinov2-small-cm': {
    key: 'dinov2-small-cm',
    repo: 'Xenova/dinov2-small',
    kind: 'dinov2',
    pooling: 'cls+mean',
    size: 224,
    mean: IMAGENET_MEAN,
    std: IMAGENET_STD,
  },
  'mobileclip-s0': {
    key: 'mobileclip-s0',
    repo: 'Xenova/mobileclip_s0',
    kind: 'clip',
    size: 256,
    mean: [0, 0, 0],
    std: [1, 1, 1],
  },
  'clip-b32': {
    key: 'clip-b32',
    repo: 'Xenova/clip-vit-base-patch32',
    kind: 'clip',
    size: 224,
    mean: CLIP_MEAN,
    std: CLIP_STD,
  },
};

/** RGBA (or RGB) pixels of a `size`×`size` image → NCHW float data for the model. */
export function pixelsToInput(
  pixels: ArrayLike<number>,
  channels: 3 | 4,
  spec: VisionModelSpec,
): Float32Array {
  const area = spec.size * spec.size;
  const out = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    for (let c = 0; c < 3; c++) {
      out[c * area + i] = (pixels[i * channels + c] / 255 - spec.mean[c]) / spec.std[c];
    }
  }
  return out;
}

export function l2Normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const inv = sum > 0 ? 1 / Math.sqrt(sum) : 0;
  for (let i = 0; i < v.length; i++) v[i] *= inv;
  return v;
}

export type ImageEmbedder = {
  spec: VisionModelSpec;
  /** Normalised embedding for one preprocessed image (see `pixelsToInput`). */
  embed: (input: Float32Array) => Promise<Float32Array>;
};

export async function loadImageEmbedder(
  spec: VisionModelSpec,
  options?: { device?: 'wasm' | 'webgpu' | 'cpu'; progress?: (loaded: number, total: number) => void },
): Promise<ImageEmbedder> {
  const tf = await import('@huggingface/transformers');
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = options?.progress
    ? (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== 'progress' || !p.file) return;
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        options.progress!(loaded, total);
      }
    : undefined;

  const common = { dtype: 'q8' as const, device: options?.device, progress_callback };
  const model =
    spec.kind === 'clip'
      ? await tf.CLIPVisionModelWithProjection.from_pretrained(spec.repo, common)
      : await tf.AutoModel.from_pretrained(spec.repo, common);

  return {
    spec,
    embed: async (input) => {
      const pixel_values = new tf.Tensor('float32', input, [1, 3, spec.size, spec.size]);
      const out = await model({ pixel_values });
      if (spec.kind === 'clip') return l2Normalize(new Float32Array(out.image_embeds.data as Float32Array));
      const hidden = out.last_hidden_state;
      const [, tokens, dim] = hidden.dims as number[];
      return poolTokens(hidden.data as Float32Array, tokens, dim, spec.pooling ?? 'cls');
    },
  };
}

function poolTokens(data: Float32Array, tokens: number, dim: number, pooling: 'cls' | 'cls+mean') {
  const cls = l2Normalize(data.slice(0, dim));
  if (pooling === 'cls') return cls;
  const mean = new Float32Array(dim);
  for (let t = 1; t < tokens; t++) {
    for (let d = 0; d < dim; d++) mean[d] += data[t * dim + d];
  }
  l2Normalize(mean);
  const both = new Float32Array(dim * 2);
  both.set(cls, 0);
  both.set(mean, dim);
  return l2Normalize(both);
}
