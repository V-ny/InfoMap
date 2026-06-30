// Geolocalização — rastreamento GPS via navigator.geolocation + marcador do usuário.
// Também suporta "modo manual": usuário toca o mapa pra definir posição (útil em
// desktop/navegador sem GPS ou quando a permissão é negada).
import { store } from "./store.js";

let userMarker = null;
let watchId = null;
let manualMode = false;
let _map = null;
let _onUpdate = null;   // callback(latlon) — main usa pra tracking/reroute
let _noCampus = null;   // predicado (lat,lon)=>bool — só aceita posição dentro do campus
let _onForaCampus = null;   // callback() — avisa quando o toque cai fora do campus

function criarMarcadorUsuario(map, lat, lon) {
  if (userMarker) {
    userMarker.setLngLat([lon, lat]);
    return userMarker;
  }
  const el = document.createElement("div");
  el.className = "user-dot";
  userMarker = new maplibregl.Marker({ element: el, anchor: "center" })
    .setLngLat([lon, lat])
    .addTo(map);
  return userMarker;
}

export function initLocation(map, { onUpdate, noCampus, onForaCampus } = {}) {
  _map = map;
  _onUpdate = onUpdate;
  _noCampus = noCampus || null;
  _onForaCampus = onForaCampus || null;

  // Restaura último ponto conhecido (se houver) já mostrando o marcador
  const last = store.getLastPos();
  if (last) criarMarcadorUsuario(map, last[0], last[1]);

  // Clique no mapa define posição quando em modo manual
  map.on("click", (e) => {
    if (!manualMode) return;
    const lat = e.lngLat.lat, lon = e.lngLat.lng;
    // Igual ao GPS: só aceita posição DENTRO da área delimitada do campus.
    if (_noCampus && !_noCampus(lat, lon)) {
      _onForaCampus?.();
      return;   // mantém o modo manual ativo p/ o usuário tocar dentro
    }
    setPosicao(lat, lon);
    setManualMode(false);
  });
}

export function setPosicao(lat, lon, { fly = false } = {}) {
  store.setLastPos([lat, lon]);
  if (_map) {
    criarMarcadorUsuario(_map, lat, lon);
    if (fly) _map.flyTo({ center: [lon, lat], zoom: 18, duration: 1000 });
  }
  _onUpdate?.([lat, lon]);
}

export function getPosicao() {
  return store.getLastPos();
}

export function setManualMode(ativo) {
  manualMode = ativo;
  if (_map) _map.getCanvas().style.cursor = ativo ? "crosshair" : "";
}

export function isManualMode() { return manualMode; }

// Plugin nativo de geolocalização do Capacitor (disponível só no APK).
// No browser cai no navigator.geolocation. O plugin registra-se em
// window.Capacitor.Plugins.Geolocation quando rodando nativo.
function _nativeGeo() {
  const cap = window.Capacitor;
  if (cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform()) {
    return cap.Plugins?.Geolocation || null;
  }
  return null;
}

// Inicia rastreamento GPS contínuo. Retorna Promise que resolve com a 1ª leitura
// ou rejeita se geolocalização indisponível/negada.
export function iniciarGPS({ onError } = {}) {
  const native = _nativeGeo();
  if (native) return _iniciarGPSNativo(native, onError);

  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      const err = new Error("Geolocalização não suportada neste dispositivo");
      onError?.(err);
      return reject(err);
    }
    let resolved = false;
    pararGPS();
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setPosicao(latitude, longitude);
        if (!resolved) { resolved = true; resolve([latitude, longitude]); }
      },
      (err) => {
        onError?.(err);
        if (!resolved) { resolved = true; reject(err); }
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
    );
  });
}

// Caminho nativo (APK): pede permissão de runtime e usa watchPosition do plugin.
async function _iniciarGPSNativo(Geolocation, onError) {
  await pararGPS();
  try {
    const perm = await Geolocation.requestPermissions();
    const granted = perm.location === "granted" || perm.coarseLocation === "granted";
    if (!granted) throw new Error("Permissão de localização negada");
  } catch (e) {
    onError?.(e);
    throw e;
  }
  return new Promise((resolve, reject) => {
    let resolved = false;
    Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: 10000 },
      (pos, err) => {
        if (err) {
          onError?.(err);
          if (!resolved) { resolved = true; reject(err); }
          return;
        }
        const { latitude, longitude } = pos.coords;
        setPosicao(latitude, longitude);
        if (!resolved) { resolved = true; resolve([latitude, longitude]); }
      },
    ).then((id) => { watchId = id; });
  });
}

export async function pararGPS() {
  const native = _nativeGeo();
  if (native && watchId !== null) {
    try { await native.clearWatch({ id: watchId }); } catch { /* ignore */ }
    watchId = null;
    return;
  }
  if (watchId !== null && "geolocation" in navigator) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}
