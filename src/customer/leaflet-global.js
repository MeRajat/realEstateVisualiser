// leaflet-rotate patches the global `L`, so expose Leaflet globally before it loads.
import L from 'leaflet';

window.L = L;
export default L;
