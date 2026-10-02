import { describe, expect, it } from 'vitest';
import { mudClientSchema, type MudTrigger } from '@app/shared';
import { expand, fill, keyName, match, runTriggers, speedwalk, splitCommands } from './engine';

const base = mudClientSchema.parse({});
const trig = (t: Partial<MudTrigger> & Pick<MudTrigger, 'pattern' | 'actions'>): MudTrigger => ({ id: 'x', match: 'contains', group: '', enabled: true, ...t });

describe('match', () => {
  it('knows the four kinds, without case', () => {
    expect(match('exact', 'look', 'LOOK')).toEqual(['LOOK']);
    expect(match('exact', 'look', 'look at')).toBeNull();
    expect(match('contains', 'Wolf', 'A grey wolf snarls')).toEqual(['wolf']);
    expect(match('start', 'kk', 'kk giant rat')).toEqual(['kk giant rat', 'giant rat', 'giant', 'rat']);
    expect(match('start', 'kk', 'kkk')).toBeNull();
    expect(match('regex', '^(\\w+) attacks you', 'Goblin attacks you!')).toEqual(['Goblin attacks you', 'Goblin']);
    expect(match('regex', '(', 'anything')).toBeNull(); // a broken pattern matches nothing
  });
});

describe('fill', () => {
  it('puts in captures and variables, and leaves unknown variables alone', () => {
    expect(fill('kill $1 with @weapon; say @nobody', ['kk rat', 'rat'], { weapon: 'sword' })).toBe('kill rat with sword; say @nobody');
    expect(fill('say $*', ['x hello there', 'hello there'], {})).toBe('say hello there');
  });
});

describe('speedwalk and splitting', () => {
  it('walks and repeats, and leaves other text alone', () => {
    expect(speedwalk('#3n 2e w')).toEqual(['north', 'north', 'north', 'east', 'east', 'west']);
    expect(speedwalk('#2 kill rat')).toEqual(['kill rat', 'kill rat']);
    expect(speedwalk('#99 x')).toHaveLength(20);
    expect(speedwalk('north')).toBeNull();
    expect(speedwalk('#3q')).toBeNull();
  });
  it('splits on the separator, and a doubled one is kept', () => {
    expect(splitCommands('n; e ;look', ';')).toEqual(['n', 'e', 'look']);
    expect(splitCommands('say a;;b;w', ';')).toEqual(['say a;b', 'w']);
  });
});

describe('expand', () => {
  const s = { ...base, aliases: [
    { id: 'a', pattern: 'kk', match: 'start' as const, send: 'kill $1;loot', group: '', enabled: true },
    { id: 'b', pattern: 'loot', match: 'exact' as const, send: 'get all from corpse', group: '', enabled: true },
    { id: 'c', pattern: 'loop', match: 'exact' as const, send: 'loop', group: '', enabled: true },
    { id: 'd', pattern: 'off', match: 'exact' as const, send: 'nope', group: '', enabled: false },
  ], variables: { target: 'goblin' } };
  it('runs aliases inside aliases, speedwalks and variables', () => {
    expect(expand('kk rat;#2s', s)).toEqual(['kill rat', 'get all from corpse', 'south', 'south']);
    expect(expand('kill @target', s)).toEqual(['kill goblin']);
    expect(expand('off', s)).toEqual(['off']);
  });
  it('stops a loop, caps the count, and sends a line starting with a space as typed', () => {
    expect(expand('loop', s)).toEqual(['loop']);
    expect(expand('#20 x;#20 x;#20 x', s)).toHaveLength(50);
    expect(expand(' kk rat;n', s)).toEqual(['kk rat;n']);
  });
});

describe('runTriggers', () => {
  it('collects every action of every matching trigger', () => {
    const r = runTriggers('The goblin attacks you!', [
      trig({ pattern: 'attacks you', actions: [{ type: 'highlight', colour: 'red', line: false }, { type: 'beep' }] }),
      trig({ pattern: '^The (\\w+) attacks', match: 'regex', actions: [{ type: 'set', name: 'foe', value: '$1' }, { type: 'send', text: 'kill @foe' }, { type: 'capture', window: 'Combat' }] }),
      trig({ pattern: 'attacks', enabled: false, actions: [{ type: 'gag' }] }),
    ], {})!;
    expect(r.highlights).toEqual([{ colour: 'red', start: 11, end: 22 }]);
    expect(r).toMatchObject({ beep: true, gag: false, set: { foe: 'goblin' }, send: ['kill goblin'], capture: ['Combat'] });
    expect(runTriggers('nothing here', [trig({ pattern: 'wolf', actions: [{ type: 'gag' }] })], {})).toBeNull();
  });
});

describe('keyName', () => {
  const k = (o: Partial<Parameters<typeof keyName>[0]>) => keyName({ key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o });
  it('names the keys a rule can use, and leaves typing alone', () => {
    expect(k({ key: '8', code: 'Numpad8' })).toBe('Numpad8');
    expect(k({ key: 'k', code: 'KeyK', ctrlKey: true })).toBe('Ctrl+K');
    expect(k({ key: 'F2', code: 'F2', altKey: true, shiftKey: true })).toBe('Alt+Shift+F2');
    expect(k({ key: 'a', code: 'KeyA' })).toBeNull();
    expect(k({ key: 'Enter', code: 'Enter' })).toBeNull();
    expect(k({ key: 'Control', code: 'ControlLeft', ctrlKey: true })).toBeNull();
  });
});
