/**
 * Personal settings (Req 19.5): a section each, kept on this machine; an
 * emptied value is not kept, so the default applies again.
 */
import { describe, it, expect } from 'vitest';
import { PersonalSettings } from '../settings.js';
import { MemoryStorage } from '../git/__tests__/memory-storage.js';

describe('personal settings', () => {
  it('a section each, kept across instances; emptied values dropped', () => {
    const storage = new MemoryStorage();
    new PersonalSettings(storage).set('git', { folder: 'arch', message: '', branch: undefined, rememberByDefault: false });
    expect(new PersonalSettings(storage).get('git')).toEqual({ folder: 'arch', rememberByDefault: false });
    expect(new PersonalSettings(storage).get('other')).toEqual({});
    new PersonalSettings(storage).set('git', {});
    expect(storage.length).toBe(0);
  });

  it('storage refused: held for the session', () => {
    const settings = new PersonalSettings(undefined);
    settings.set('git', { folder: 'arch' });
    expect(settings.get('git')).toEqual({ folder: 'arch' });
  });
});
