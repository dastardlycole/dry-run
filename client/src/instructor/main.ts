import type { FeatureCollection } from 'geojson';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { CENTRE } from '../config';
import { RULE_NAMES, type RuleId } from '../faults/types';
import { collisionFeatures, collisionLine, faultRate, junctionFeatures, typeLabel } from './geojson';
import type { JunctionStat, JunctionStatsResponse } from './types';

// Instructor dashboard (SPEC §4.8 FR-I1/I2): fault heatmap per junction from junction_stats (kept up to date
// by Stream Processing) + real STATS19 collisions. Polls so a new fault shows up within ~10 s of the drive.
const POLL_MS = 3000;
const SEVERITY_COLOUR = { slight: '#f2c94c', serious: '#f2994a', fatal: '#eb5757' };

const ruleSelect = document.querySelector<HTMLSelectElement>('#rule')!;
const categorySelect = document.querySelector<HTMLSelectElement>('#category')!;
const status = document.querySelector<HTMLElement>('#updated')!;
for (const [id, name] of Object.entries(RULE_NAMES)) ruleSelect.add(new Option(`${id} ${name}`, id));

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [CENTRE.lng, CENTRE.lat],
  zoom: 14.5,
});

new maplibregl.Marker({ color: '#d33' })
  .setLngLat([CENTRE.lng, CENTRE.lat])
  .setPopup(new maplibregl.Popup().setText(`${CENTRE.name} test centre`))
  .addTo(map);

let latest: JunctionStatsResponse | undefined;
const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

map.on('load', () => {
  map.addSource('junctions', { type: 'geojson', data: empty });
  map.addSource('collisions', { type: 'geojson', data: empty });

  map.addLayer({
    id: 'faults-heat',
    type: 'heatmap',
    source: 'junctions',
    paint: {
      'heatmap-weight': ['interpolate', ['linear'], ['get', 'faults'], 0, 0, 4, 1],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 12, 1, 17, 3],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 12, 15, 17, 60],
      'heatmap-opacity': 0.75,
    },
  });
  map.addLayer({
    id: 'collisions',
    type: 'circle',
    source: 'collisions',
    paint: {
      'circle-radius': ['match', ['get', 'severity'], 'fatal', 7, 'serious', 5.5, 4],
      'circle-color': ['match', ['get', 'severity'], 'fatal', SEVERITY_COLOUR.fatal, 'serious', SEVERITY_COLOUR.serious, SEVERITY_COLOUR.slight],
      'circle-stroke-color': '#222',
      'circle-stroke-width': 1,
      'circle-opacity': 0.9,
    },
  });
  map.addLayer({
    id: 'junctions',
    type: 'circle',
    source: 'junctions',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'faults'], 0, 7, 10, 14],
      'circle-color': ['case', ['>', ['get', 'faults'], 0], '#7b2cbf', 'rgba(0,0,0,0)'],
      'circle-stroke-color': ['case', ['>', ['get', 'faults'], 0], '#fff', 'rgba(60,60,60,0.35)'],
      'circle-stroke-width': 1.5,
    },
  });

  map.on('click', 'junctions', (e) => {
    const id = e.features?.[0]?.properties?.id as string | undefined;
    const j = latest?.junctions.find((x) => x.id === id);
    if (j) new maplibregl.Popup({ maxWidth: '280px' }).setLngLat([j.lng, j.lat]).setDOMContent(popup(j)).addTo(map);
  });
  map.on('mouseenter', 'junctions', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'junctions', () => (map.getCanvas().style.cursor = ''));

  void poll();
  setInterval(() => void poll(), POLL_MS);
});

ruleSelect.addEventListener('change', () => void poll());
categorySelect.addEventListener('change', () => void poll());

let inFlight = false;
async function poll() {
  if (inFlight) return;
  inFlight = true;
  try {
    const qs = new URLSearchParams({ ruleId: ruleSelect.value, category: categorySelect.value });
    const res = await fetch(`/api/junctions/stats?${qs}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    latest = (await res.json()) as JunctionStatsResponse;
    (map.getSource('junctions') as maplibregl.GeoJSONSource).setData(junctionFeatures(latest));
    (map.getSource('collisions') as maplibregl.GeoJSONSource).setData(collisionFeatures(latest));
    const total = latest.junctions.reduce((n, j) => n + j.faults, 0);
    const when = latest.updatedAt ? `last fault ${new Date(latest.updatedAt).toLocaleTimeString()}` : 'no faults yet';
    status.textContent = `${total} faults · ${when}`;
  } catch {
    status.textContent = 'Server unreachable, retrying…';
  } finally {
    inFlight = false;
  }
}

function popup(j: JunctionStat): HTMLElement {
  const el = document.createElement('div');
  el.className = 'junction-popup';
  const line = (text: string, tag = 'p') => {
    const p = document.createElement(tag);
    p.textContent = text;
    el.append(p);
    return p;
  };
  line(j.name, 'h3');
  line(typeLabel(j.type)).className = 'type';
  const rules = Object.entries(j.byRule).sort((a, b) => b[1] - a[1]);
  if (rules.length) {
    const ul = document.createElement('ul');
    for (const [rule, n] of rules) {
      const li = document.createElement('li');
      li.textContent = `${RULE_NAMES[rule as RuleId] ?? rule}: ${n}`;
      ul.append(li);
    }
    el.append(ul);
  } else line('No faults here yet');
  const rate = faultRate(j);
  if (rate) line(`${rate} of learners get a fault here (${j.sessionsWithFault} of ${j.sessionsThrough} drives)`);
  line(collisionLine(j.collisions)).className = 'real';
  return el;
}
