import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { CENTRE } from '../config';

// Placeholder dashboard: map centred on the test centre. Heatmap + collisions layers come later (SPEC §4.8).
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [CENTRE.lng, CENTRE.lat],
  zoom: 14,
});

new maplibregl.Marker({ color: '#d33' })
  .setLngLat([CENTRE.lng, CENTRE.lat])
  .setPopup(new maplibregl.Popup().setText(`${CENTRE.name} test centre`))
  .addTo(map);
