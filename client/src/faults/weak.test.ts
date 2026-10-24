import { describe, expect, it } from 'vitest';
import { junctionName, weakJunctions, whatWentWrong, type FaultGroup, type PastDrive } from './weak';

const steps = {
  'auto-1': [
    { junctionId: 'j1', fromRoad: 'Kingswood Road', toRoad: 'Percy Road', action: 'left' as const },
    { junctionId: 'j2', fromRoad: 'Percy Road', toRoad: 'High Street', action: 'right' as const },
  ],
  'auto-2': [{ junctionId: 'j1', fromRoad: 'Kingswood Road', toRoad: 'Percy Road', action: 'left' as const }],
};
const stepsOf = (id: string) => steps[id as keyof typeof steps];
const drives: PastDrive[] = [
  { sessionId: 's4', routeId: 'auto-2' },
  { sessionId: 's3', routeId: 'auto-1' },
  { sessionId: 's2', routeId: 'auto-1' },
  { sessionId: 's1', routeId: 'auto-1' },
];

describe('weakJunctions', () => {
  it('counts the drives through a junction and the ones where the same thing went wrong', () => {
    const groups: FaultGroup[] = [
      { junctionId: 'j1', ruleId: 'R7', missed: ['right'], sessionIds: ['s1', 's2', 's4', 's4'] },
      { junctionId: 'j1', ruleId: 'R4', sessionIds: ['s1', 's2'] },
    ];
    expect(weakJunctions(groups, drives, stepsOf)).toEqual([
      { junctionId: 'j1', name: 'Kingswood Road / Percy Road', what: 'missed the look right', times: 3, drives: 4, routeId: 'auto-2' },
    ]);
  });

  it('leaves out one-off slips, junctions on no route, and faults from drives not in the list', () => {
    const groups: FaultGroup[] = [
      { junctionId: 'j2', ruleId: 'R5', sessionIds: ['s3'] },
      { junctionId: 'nowhere', ruleId: 'R1', sessionIds: ['s1', 's2'] },
      { junctionId: 'j2', ruleId: 'R4', sessionIds: ['s3', 'free-drive'] },
    ];
    expect(weakJunctions(groups, drives, stepsOf)).toEqual([]);
  });

  it('puts the most repeated first, then the highest share, and shows at most 3', () => {
    const many: PastDrive[] = Array.from({ length: 6 }, (_, i) => ({ sessionId: `d${i}`, routeId: 'auto-1' }));
    const ids = (n: number) => many.slice(0, n).map((d) => d.sessionId);
    const big = { 'auto-1': ['a', 'b', 'c', 'd'].map((j) => ({ junctionId: j, fromRoad: j, toRoad: '', action: 'left' as const })) };
    const groups: FaultGroup[] = [
      { junctionId: 'a', ruleId: 'R4', sessionIds: ids(2) },
      { junctionId: 'b', ruleId: 'R4', sessionIds: ids(5) },
      { junctionId: 'c', ruleId: 'R4', sessionIds: ids(3) },
      { junctionId: 'd', ruleId: 'R4', sessionIds: ids(2) },
    ];
    expect(weakJunctions(groups, many, (id) => big[id as 'auto-1']).map((w) => w.junctionId)).toEqual(['b', 'c', 'a']);
  });

  it('never says it went wrong more often than it was driven', () => {
    const groups: FaultGroup[] = [{ junctionId: 'j2', ruleId: 'R4', sessionIds: ['s4', 's3'] }];
    // s4 was on auto-2, which doesn't go through j2: the drive through it is still counted.
    expect(weakJunctions(groups, drives, stepsOf)[0]).toMatchObject({ times: 2, drives: 3 });
  });
});

describe('names and words', () => {
  it('names a junction by the roads that meet there', () => {
    expect(junctionName({ fromRoad: 'High Street', toRoad: 'High Street', action: 'ahead' })).toBe('High Street');
    expect(junctionName({ fromRoad: 'A1008', toRoad: 'Harrier Avenue', action: 'roundabout' })).toBe('A1008 / Harrier Avenue roundabout');
    expect(junctionName({ fromRoad: '', toRoad: '', action: 'left' })).toBe('Unnamed road');
  });

  it('says which look was missed', () => {
    expect(whatWentWrong({ ruleId: 'R7', missed: ['left'] })).toBe('missed the look left');
    expect(whatWentWrong({ ruleId: 'R7', missed: ['left', 'right'] })).toBe("didn't look both ways");
    expect(whatWentWrong({ ruleId: 'R9' })).toBe('wrong lane on the roundabout');
  });
});
