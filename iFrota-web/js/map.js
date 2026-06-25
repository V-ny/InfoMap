// Inicializa o MapLibre GL com o estilo, bounds e câmera 3D do IFrota.
import { CENTRO, ZOOM_PADRAO, SW, NE, STYLE_LIGHT_URL, STYLE_DARK_URL } from "./config.js";

export function criarMapa({ dark = false } = {}) {
  if (dark) document.body.classList.add("dark");

  const style = dark ? STYLE_DARK_URL : STYLE_LIGHT_URL;
  const map = new maplibregl.Map({
    container: "map",
    style,
    center: CENTRO,
    zoom: ZOOM_PADRAO,
    pitch: 45,
    bearing: -17,
    minZoom: ZOOM_PADRAO - 1,
    maxZoom: 21,
    maxBounds: [
      [SW[1] - 0.005, SW[0] - 0.005],
      [NE[1] + 0.005, NE[0] + 0.005],
    ],
    attributionControl: false,
  });

  map.addControl(
    new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }),
    "top-right",
  );
  map.dragRotate.enable();
  map.touchZoomRotate.enableRotation();

  return map;
}

// Prédios 3D extrudados a partir das vector tiles (OpenMapTiles "building").
export function adicionar3DBuildings(map, dark = false) {
  const layers = map.getStyle().layers || [];
  let labelLayer = null;
  for (const l of layers) {
    if (l.type === "symbol" && l.layout && l.layout["text-field"]) {
      labelLayer = l.id;
      break;
    }
  }
  if (!map.getSource("openmaptiles")) return;
  if (map.getLayer("3d-buildings")) map.removeLayer("3d-buildings");
  map.addLayer({
    id: "3d-buildings",
    source: "openmaptiles",
    "source-layer": "building",
    type: "fill-extrusion",
    minzoom: 14,
    paint: {
      "fill-extrusion-color": dark ? "#2e2e2e" : "#d6d6d6",
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], ["get", "height"], 6],
      "fill-extrusion-base":   ["coalesce", ["get", "render_min_height"], ["get", "min_height"], 0],
      "fill-extrusion-opacity": 0.85,
    },
  }, labelLayer);
}
