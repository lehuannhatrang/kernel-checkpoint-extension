import { planRestore } from '../restore-collision';

describe('planRestore', () => {
  const CP = 'cp-kernel-id';

  it('creates when no running kernel holds the checkpoint id', () => {
    expect(planRestore(['a', 'b'], CP, undefined)).toEqual({ action: 'create' });
    expect(planRestore([], CP, 'a')).toEqual({ action: 'create' });
  });

  it('replaces when the checkpoint id is the notebook own current kernel', () => {
    expect(planRestore([CP, 'x'], CP, CP)).toEqual({ action: 'replace' });
  });

  it('refuses when the checkpoint id is held by a different kernel', () => {
    expect(planRestore([CP], CP, undefined)).toEqual({
      action: 'refuse',
      conflictKernelId: CP
    });
    expect(planRestore([CP, 'y'], CP, 'other')).toEqual({
      action: 'refuse',
      conflictKernelId: CP
    });
  });
});
