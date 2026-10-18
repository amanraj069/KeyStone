import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ExpertiseService } from '../analytics/expertise.service';
import type { GraphService } from '../graph/graph.service';
import type { ProjectionService } from '../projection/projection.service';
import type { ActionsExportService } from './actions-export.service';
import { BackupService } from './backup.service';
import type { GraphLock } from './graph-lock';

/** A fake FalkorDB: graph name -> Person count, plus memory figures. */
function fakeGraph(people: Record<string, number>, usedMemoryMb = 500) {
  return {
    graphExists: jest.fn(async (name: string) => name in people),
    roQuery: jest.fn(async (name: string) => [{ people: people[name] ?? 0 }]),
    deleteGraph: jest.fn(async (name: string) => void delete people[name]),
    copyGraph: jest.fn(async (src: string, dst: string) => void (people[dst] = people[src])),
    replaceGraph: jest.fn(async (src: string, dst: string) => void (people[dst] = people[src])),
    memoryReport: jest.fn(async () => ({ usedMemoryHuman: '', usedMemoryMb, graphs: [{ graph: 'apex', totalMb: 400 }, { graph: 'apex_backup', totalMb: 300 }] })),
  };
}

function fakeLock(free = true) {
  const handle = { holder: { op: 'backup' }, token: 't', renewTimer: setInterval(() => undefined, 1e6) };
  clearInterval(handle.renewTimer);
  return {
    acquire: jest.fn(async () => (free ? handle : null)),
    release: jest.fn(async () => undefined),
    holder: jest.fn(async () => (free ? null : { op: 'seed', owner: 'api:1', startedAt: 0 })),
  };
}

const LIVE_ACTION = { id: 'act-000000000001', props: { status: 'approved' }, targetType: 'Ticket', target: 'T-1', assignsTo: 'Ada', partOfPlan: null, basedOn: [] };

function service(graph: ReturnType<typeof fakeGraph>, lock = fakeLock(), memoryMaxMb = 3600) {
  const actions = {
    restoreLatestInto: jest.fn(async () => ({ source: 'x', actions: 3, reassignments: 1, unresolvedTargets: [] })),
    snapshotActions: jest.fn(async () => [LIVE_ACTION]),
  };
  const expertise = { refresh: jest.fn(async () => ({})) };
  const projection = { rebuild: jest.fn(async () => ({})) };
  const backup = new BackupService(
    graph as unknown as GraphService,
    lock as unknown as GraphLock,
    actions as unknown as ActionsExportService,
    expertise as unknown as ExpertiseService,
    projection as unknown as ProjectionService,
    { redisUrl: 'redis://x', memoryMaxMb, everyMs: 1 },
  );
  return { backup, actions, expertise, projection, lock };
}

describe('BackupService.backupNow', () => {
  it('copies apex into a new apex_backup with replaceGraph (copy, then rename over the old one)', async () => {
    const graph = fakeGraph({ apex: 44, apex_backup: 40 });
    const { backup, lock } = service(graph);
    await expect(backup.backupNow()).resolves.toMatchObject({ status: 'done', graph: 'apex_backup', people: 44 });
    expect(graph.replaceGraph).toHaveBeenCalledWith('apex', 'apex_backup');
    expect(graph.deleteGraph).not.toHaveBeenCalled(); // never "delete, then hope the copy works"
    expect(lock.release).toHaveBeenCalled();
  });

  it('keeps the old backup when the copy fails, and releases the lock', async () => {
    const graph = fakeGraph({ apex: 44, apex_backup: 40 });
    graph.replaceGraph.mockRejectedValueOnce(new Error('OOM command not allowed'));
    const { backup, lock } = service(graph);
    await expect(backup.backupNow()).rejects.toThrow('OOM');
    expect(graph.deleteGraph).not.toHaveBeenCalledWith('apex_backup');
    expect(lock.release).toHaveBeenCalled();
  });

  it('keeps the old backup when apex has no people (empty graph from SchemaService)', async () => {
    const graph = fakeGraph({ apex: 0, apex_backup: 40 });
    const { backup, lock } = service(graph);
    await expect(backup.backupNow()).resolves.toMatchObject({ status: 'skipped' });
    expect(graph.replaceGraph).not.toHaveBeenCalled();
    expect(lock.release).toHaveBeenCalled();
  });

  it('is skipped while a seed or restore holds the lock', async () => {
    const graph = fakeGraph({ apex: 44 });
    const { backup } = service(graph, fakeLock(false));
    await expect(backup.backupNow()).resolves.toEqual({ status: 'skipped', reason: 'a seed is running' });
    expect(graph.replaceGraph).not.toHaveBeenCalled();
  });

  it('is skipped when the copy would pass MEMORY_MAX_MB', async () => {
    // The old backup stays until the copy is renamed over it: 3200 used + 400 for the copy = 3600 > 3550.
    const graph = fakeGraph({ apex: 44, apex_backup: 40 }, 3200);
    const { backup } = service(graph, fakeLock(), 3550);
    await expect(backup.backupNow()).resolves.toMatchObject({ status: 'skipped', reason: expect.stringContaining('MEMORY_MAX_MB') });
    expect(graph.replaceGraph).not.toHaveBeenCalled();
  });
});

describe('BackupService.restore', () => {
  it('replaces apex with the backup, merges the latest actions export back, refreshes expertise and apex_proj', async () => {
    const graph = fakeGraph({ apex: 0, apex_backup: 40 });
    const { backup, actions, expertise, projection, lock } = service(graph);
    await expect(backup.restore({ reapplyActions: true })).resolves.toMatchObject({ status: 'done', people: 40, actions: { actions: 3 } });
    expect(graph.replaceGraph).toHaveBeenCalledWith('apex_backup', 'apex');
    expect(actions.restoreLatestInto).toHaveBeenCalledWith('apex', [LIVE_ACTION]);
    expect(expertise.refresh).toHaveBeenCalled();
    expect(projection.rebuild).toHaveBeenCalled();
    expect(lock.release).toHaveBeenCalled();
  });

  it('snapshots the live apex\'s actions before replacing it and merges them after the latest export', async () => {
    const graph = fakeGraph({ apex: 44, apex_backup: 40 });
    const { backup, actions, lock } = service(graph);
    await backup.restore({ reapplyActions: true });
    expect(actions.snapshotActions).toHaveBeenCalledWith('apex');
    expect(actions.snapshotActions.mock.invocationCallOrder[0]).toBeLessThan(graph.replaceGraph.mock.invocationCallOrder[0]);
    expect(actions.restoreLatestInto).toHaveBeenCalledWith('apex', [LIVE_ACTION]);
    expect(lock.acquire).toHaveBeenCalledWith('restore', expect.any(Number)); // waits out a running backup
  });

  it('can skip the actions export (a pure copy) but still rebuilds apex_proj', async () => {
    const graph = fakeGraph({ apex: 44, apex_backup: 40 });
    const { backup, actions, projection } = service(graph);
    await expect(backup.restore({ reapplyActions: false })).resolves.toMatchObject({ actions: null });
    expect(actions.restoreLatestInto).not.toHaveBeenCalled();
    expect(actions.snapshotActions).not.toHaveBeenCalled();
    expect(projection.rebuild).toHaveBeenCalled();
  });

  it('refuses when there is no backup with people, and releases the lock', async () => {
    const graph = fakeGraph({ apex: 44 });
    const { backup, lock } = service(graph);
    await expect(backup.restore({ reapplyActions: true })).rejects.toBeInstanceOf(NotFoundException);
    expect(graph.replaceGraph).not.toHaveBeenCalled();
    expect(lock.release).toHaveBeenCalled();
  });

  it('refuses while another graph operation runs', async () => {
    const { backup } = service(fakeGraph({ apex: 0, apex_backup: 40 }), fakeLock(false));
    await expect(backup.restore({ reapplyActions: true })).rejects.toBeInstanceOf(ConflictException);
  });
});
