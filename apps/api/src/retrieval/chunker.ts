/**
 * Splits an artifact into retrieval chunks of about CHUNK_SIZE characters with
 * CHUNK_OVERLAP characters carried over between neighbours. It breaks on
 * paragraphs first, then sentences, and only cuts inside a sentence when one
 * sentence alone is longer than a chunk. The title starts the first chunk so a
 * search for the title finds the artifact.
 */

export const CHUNK_SIZE = 800;
export const CHUNK_OVERLAP = 100;
export const DEFAULT_MAX_CHUNKS_PER_ARTIFACT = 6;

export interface ChunkOptions {
  size?: number;
  overlap?: number;
  maxChunks?: number;
}

/** Paragraphs, with long ones split into sentences and over-long sentences cut to size. */
function segments(body: string, size: number): string[] {
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  return paragraphs.flatMap((paragraph) => {
    if (paragraph.length <= size) return [paragraph];
    const sentences = paragraph.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);
    return sentences.flatMap((sentence) => (sentence.length <= size ? [sentence] : hardSplit(sentence, size)));
  });
}

function hardSplit(text: string, size: number): string[] {
  const pieces: string[] = [];
  for (let start = 0; start < text.length; start += size) pieces.push(text.slice(start, start + size));
  return pieces;
}

/** The last ~`overlap` characters of a chunk, starting at a word boundary. */
function tail(text: string, overlap: number): string {
  if (overlap <= 0 || text.length <= overlap) return overlap <= 0 ? '' : text;
  const cut = text.slice(text.length - overlap);
  const space = cut.indexOf(' ');
  return space >= 0 ? cut.slice(space + 1) : cut;
}

export function chunkText(title: string, body: string, options: ChunkOptions = {}): string[] {
  const size = options.size ?? CHUNK_SIZE;
  const overlap = options.overlap ?? CHUNK_OVERLAP;
  const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS_PER_ARTIFACT;

  const chunks: string[] = [];
  let current = title.trim();
  for (const segment of segments(body, size)) {
    const joined = current ? `${current}\n\n${segment}` : segment;
    if (joined.length <= size || !current) {
      current = joined;
      continue;
    }
    chunks.push(current);
    // The next chunk starts with the end of this one, so a sentence split
    // across the boundary is still findable from either side.
    const carried = tail(current, overlap);
    current = carried ? `${carried} ${segment}` : segment;
  }
  if (current) chunks.push(current);
  return chunks.slice(0, maxChunks);
}

/** Stable id of the n-th chunk of an artifact (rebuilding gives the same ids). */
export function chunkId(artifactId: string, index: number): string {
  return `${artifactId}#${index}`;
}

/**
 * Estimated graph memory for the vectors: chunks x dim x 4 bytes (float32),
 * doubled for the vector index. Returned in MB.
 */
export function estimateVectorMb(chunks: number, dim: number): number {
  return (chunks * dim * 4 * 2) / 1024 / 1024;
}

/**
 * The largest per-artifact chunk cap (<= requested) that keeps current memory
 * plus the new vectors under the warning level. `counts` are the uncapped
 * chunk counts per artifact.
 */
export function chooseMaxChunks(
  counts: readonly number[],
  requested: number,
  dim: number,
  usedMb: number,
  warnMb: number,
): { maxChunks: number; chunks: number; estimateMb: number; lowered: boolean } {
  for (let max = requested; max >= 1; max--) {
    const chunks = counts.reduce((sum, n) => sum + Math.min(n, max), 0);
    const estimateMb = estimateVectorMb(chunks, dim);
    if (usedMb + estimateMb <= warnMb || max === 1) {
      return { maxChunks: max, chunks, estimateMb, lowered: max < requested };
    }
  }
  return { maxChunks: 1, chunks: counts.length, estimateMb: estimateVectorMb(counts.length, dim), lowered: true };
}
