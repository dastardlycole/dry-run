import { describe, expect, it } from 'vitest';
import centres from './centres.json';
import { findCentre, type FindDeps } from './find';
import { centreId, parseFinder, type CentreInfo } from './finder';

const byId = (id: string) => centres.find((c) => c.id === id)!;
// Stand-ins for gov.uk and postcodes.io, so the tests never go online.
const deps = (over: Partial<FindDeps> = {}): FindDeps => ({
  centres,
  near: async (pc) => (pc === 'IG11 0SW' ? [byId('goodmayes'), byId('erith')] : []),
  locate: async (pc) => ({ E11: { lat: 51.5687, lng: 0.0136 }, 'IG11 0SW': { lat: 51.53, lng: 0.1 } })[pc] ?? null,
  ...over,
});

describe('findCentre', () => {
  it('maps a full postcode to the nearest centre gov.uk gives', async () => {
    expect((await findCentre('ig11 0sw', deps()))?.id).toBe('goodmayes');
  });

  it('falls back to the nearest centre on the list when gov.uk is down', async () => {
    const down = deps({ near: async () => Promise.reject(new Error('503')) });
    expect((await findCentre('IG11 0SW', down))?.id).toBe('goodmayes');
  });

  it('maps a postcode district to the nearest centre on the list', async () => {
    expect((await findCentre('E11', deps()))?.id).toBe('wanstead');
  });

  it('finds a centre by name, whole or the start of it', async () => {
    expect((await findCentre('Wanstead', deps()))?.id).toBe('wanstead');
    expect((await findCentre('  isleworth ', deps()))?.id).toBe('isleworth-fleming-way');
    expect((await findCentre('south croy', deps()))?.id).toBe('south-croydon');
  });

  it('finds nothing for nonsense, a postcode that does not exist, or too few letters', async () => {
    expect(await findCentre('zzzz', deps())).toBeNull();
    expect(await findCentre('ZZ9 9ZZ', deps())).toBeNull();
    expect(await findCentre('we', deps())).toBeNull();
    expect(await findCentre('', deps())).toBeNull();
  });
});

describe('the centre list', () => {
  it('has Wanstead where the demo is, and unique ids', () => {
    const w = byId('wanstead');
    expect(w.postcode).toBe('E11 2AW');
    expect(new Set(centres.map((c: CentreInfo) => c.id)).size).toBe(centres.length);
  });
});

describe('parseFinder', () => {
  const item = (name: string, tests: string) => `
    <li><div class="place group place-list__item"><div class="adr org fn"><div class="adr govuk-body">
      <h3 class="fn govuk-heading-s">${name}</h3>
      <br><span class="street-address">2 Devon House, Hermon Hill</span>
      <br><span class="locality">Wanstead</span><br><span class="postal-code">E11 2AW</span></div>
      <a href="http://www.openstreetmap.org/index.html?mlat=51.5805&amp;mlon=0.0238&amp;zoom=16">OSM</a>
      <p>This test centre provides these types of tests: ${tests}.</p></div></div></li>`;

  it('reads each centre that runs car tests', () => {
    expect(parseFinder(item('Wanstead (London)', 'car, ADI part 3') + item('Enfield (Brancroft Way)', 'lorry and bus'))).toEqual([
      { id: 'wanstead', name: 'Wanstead', address: '2 Devon House, Hermon Hill, Wanstead', postcode: 'E11 2AW', lat: 51.5805, lng: 0.0238 },
    ]);
  });

  it('makes ids from names', () => {
    expect(centreId('Enfield (Innova Business Park)')).toBe('enfield-innova-business-park');
  });
});
