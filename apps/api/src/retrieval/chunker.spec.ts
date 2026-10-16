import { chooseMaxChunks, chunkId, chunkText, estimateVectorMb } from './chunker';

const sentence = (i: number) => `Sentence number ${i} talks about TitanDB and Kafka in some detail.`;

describe('chunkText', () => {
  it('puts the title at the start of the first chunk only', () => {
    const chunks = chunkText('Runbook', 'Short body.');
    expect(chunks).toEqual(['Runbook\n\nShort body.']);
  });

  it('keeps chunks near the target size and breaks on sentences', () => {
    const body = Array.from({ length: 60 }, (_, i) => sentence(i)).join(' ');
    const chunks = chunkText('T', body, { maxChunks: 50 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(800 + 100 + 80);
    // Each chunk after the first starts with text from the last 100 characters of the previous one.
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i - 1].slice(-100)).toContain(chunks[i].slice(0, 30));
    }
  });

  it('prefers paragraph boundaries', () => {
    const para = (n: number) => `Paragraph ${n}. ` + 'x '.repeat(150);
    const chunks = chunkText('', `${para(1)}\n\n${para(2)}\n\n${para(3)}`, { overlap: 0 });
    expect(chunks.every((c) => c.startsWith('Paragraph'))).toBe(true);
  });

  it('cuts a single huge sentence into pieces', () => {
    const chunks = chunkText('', 'a'.repeat(2000), { overlap: 0, maxChunks: 10 });
    expect(chunks.map((c) => c.length)).toEqual([800, 800, 400]);
  });

  it('keeps at most maxChunks', () => {
    const body = Array.from({ length: 200 }, (_, i) => sentence(i)).join(' ');
    expect(chunkText('T', body, { maxChunks: 6 })).toHaveLength(6);
  });

  it('builds stable chunk ids', () => {
    expect(chunkId('slack_x_2026-01-01T09:00:00', 2)).toBe('slack_x_2026-01-01T09:00:00#2');
  });
});

describe('memory estimate', () => {
  it('is chunks x dim x 4 bytes, doubled', () => {
    expect(estimateVectorMb(1000, 768)).toBeCloseTo((1000 * 768 * 8) / 1024 / 1024);
  });

  it('keeps the requested cap when it fits', () => {
    expect(chooseMaxChunks([10, 2, 1], 6, 768, 100, 3000)).toMatchObject({ maxChunks: 6, chunks: 9, lowered: false });
  });

  it('lowers the cap until memory fits under the warning level', () => {
    // 1,000 artifacts of 10 chunks: cap 6 = 6,000 chunks (~35 MB); budget leaves room for ~2,000.
    const counts = Array.from({ length: 1000 }, () => 10);
    const result = chooseMaxChunks(counts, 6, 768, 3000 - 12, 3000);
    expect(result.lowered).toBe(true);
    expect(result.maxChunks).toBe(2);
    expect(result.estimateMb).toBeLessThanOrEqual(12);
  });
});
