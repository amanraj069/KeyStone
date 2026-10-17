import { ArtifactsService, EXCERPT_CHARS } from '../src/artifacts/artifacts.service';
import type { TextStore } from '../src/ingest/text-store';
import { useFixtureGraph } from './graph-test-utils';

/** A TextStore in memory: P-1 has a long body, TH-1 none. */
function memoryTextStore(texts: Record<string, string>): TextStore {
  return {
    put: () => Promise.resolve(),
    get: (_kind, id) => Promise.resolve(texts[id] ?? null),
    getMany: () => Promise.resolve(new Map()),
  };
}

describe('ArtifactsService on the fixture (GET /artifacts/:id, ARTIFACT_DETAIL)', () => {
  const fx = useFixtureGraph();
  const body = 'Restart the PaymentsAPI pods. '.repeat(100);
  let artifacts: ArtifactsService;

  beforeAll(() => {
    artifacts = new ArtifactsService(fx.graph, memoryTextStore({ 'P-1': body }));
  });

  it('returns the label, type, title, day, people and a cut excerpt of the body', async () => {
    const detail = await artifacts.detail('P-1', fx.name);
    expect(detail).toMatchObject({ id: 'P-1', label: 'Page', type: 'confluence', title: 'PaymentsAPI runbook', day: 2, bodyLength: 2400 });
    expect(detail.people).toContain('Ada');
    expect(detail.excerpt).toHaveLength(EXCERPT_CHARS);
    expect(detail.excerpt?.endsWith('…')).toBe(true);
  });

  it('a missing body gives a null excerpt, and an unknown id is a 404', async () => {
    await expect(artifacts.detail('TH-1', fx.name)).resolves.toMatchObject({ id: 'TH-1', label: 'Thread', excerpt: null });
    await expect(artifacts.detail('NOPE-1', fx.name)).rejects.toThrow(/No artifact NOPE-1/);
  });
});
