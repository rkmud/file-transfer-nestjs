import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export const useTempDir = (prefix = 'ftn-test-'): { readonly path: string } => {
  const state = { path: '' };

  beforeAll(() => {
    state.path = mkdtempSync(join(tmpdir(), prefix));
  });

  afterAll(() => {
    if (state.path) removeDir(state.path);
  });

  return state;
};

export const makeTempDir = (prefix = 'ftn-test-'): string =>
  mkdtempSync(join(tmpdir(), prefix));

export const removeDir = (path: string): void =>
  rmSync(path, { recursive: true, force: true });
