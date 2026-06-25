// Pathfinding A* sobre a rede viária do campus — portado do IFrota.py desktop.
// Extrai LineStrings das vector tiles (camada transportation) + features do
// Overpass, monta um grafo, conecta fragmentos com arestas virtuais penalizadas,
// e roda A* com snap top-K. Desenha a rota distinguindo trechos reais (sólido
// preto) de virtuais/atalhos (tracejado laranja).
import { haversine as _hav } from "./geo.js";
import { isolarDestino } from "./markers.js";

let _map = null;
let _campusPoly = null;
let _overpassFeats = [];
let _redeCache = null;

// Estado da rota desenhada (pra re-add após troca de tema)
let _currentRoute = null;
let _currentVirtualMap = null;
let _currentDest = null;
let _animatingRoute = false;

// Tracking / off-route (porta do IFrota.py desktop)
const OFF_ROUTE_M = 25;      // distância (m) pra considerar "fora da rota"
const OFF_ROUTE_TRIES = 3;   // leituras consecutivas off-route pra disparar reroute
let _offRouteCount = 0;

export function initRouting(map, campusPoly, overpassFeats) {
  _map = map;
  _campusPoly = campusPoly;
  _overpassFeats = overpassFeats || [];
  // Pré-carrega a rede quando o mapa fica idle (tiles do campus disponíveis)
  map.once("idle", () => {
    setTimeout(() => {
      const rede = _construirEcachearRede();
      if (rede) {
        console.log(`[IFrota] rede viária pré-carregada — ${Object.keys(rede.nodes).length} nós`);
      }
    }, 800);
  });
}

export function isAnimatingRoute() { return _animatingRoute; }

// ── Geometria ────────────────────────────────────────────────────────────────
function _ptInCampus(lat, lon) {
  const poly = _campusPoly;
  if (!poly || poly.length < 3) return true;
  let inside = false;
  let j = poly.length - 1;
  for (let i = 0; i < poly.length; i++) {
    const yi = poly[i][0], xi = poly[i][1];
    const yj = poly[j][0], xj = poly[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
    j = i;
  }
  return inside;
}

// ── A* ───────────────────────────────────────────────────────────────────────
function _astar(adj, startId, goalId, nodes) {
  const open = new Map();
  const cameFrom = {};
  const gScore = { [startId]: 0 };
  const goal = nodes[goalId];
  const h = (id) => {
    const n = nodes[id];
    return _hav(n[1], n[0], goal[1], goal[0]);
  };
  open.set(startId, h(startId));
  while (open.size) {
    let curr = null, minF = Infinity;
    for (const [id, f] of open) { if (f < minF) { minF = f; curr = id; } }
    open.delete(curr);
    if (curr === goalId) {
      const path = [curr];
      let c = curr;
      while (c in cameFrom) { c = cameFrom[c]; path.unshift(c); }
      return path;
    }
    for (const [nb, w] of (adj[curr] || [])) {
      const t = gScore[curr] + w;
      if (t < (gScore[nb] ?? Infinity)) {
        cameFrom[nb] = curr;
        gScore[nb] = t;
        open.set(nb, t + h(nb));
      }
    }
  }
  return null;
}

// ── Construção da rede viária ──────────────────────────────────────────────────
function _construirRedeViaria() {
  let feats = [];
  try {
    feats = _map.querySourceFeatures("openmaptiles", { sourceLayer: "transportation" });
  } catch (e) {
    console.log("[IFrota] erro ao consultar source openmaptiles:", e);
    return null;
  }
  const nodes = {};
  const adj = {};
  const key = (c) => c[0].toFixed(5) + "," + c[1].toFixed(5);
  const getId = (c) => {
    const k = key(c);
    if (!(k in nodes)) { nodes[k] = c; adj[k] = []; }
    return k;
  };
  let total = 0, kept = 0;
  const addEdge = (a, b) => {
    total++;
    const aIn = _ptInCampus(a[1], a[0]);
    const bIn = _ptInCampus(b[1], b[0]);
    const mLat = (a[1] + b[1]) / 2, mLon = (a[0] + b[0]) / 2;
    const mIn = _ptInCampus(mLat, mLon);
    if (!aIn && !bIn && !mIn) return;
    kept++;
    const w = _hav(a[1], a[0], b[1], b[0]);
    const ia = getId(a), ib = getId(b);
    adj[ia].push([ib, w]);
    adj[ib].push([ia, w]);
  };
  const handleLine = (coords) => {
    for (let i = 0; i < coords.length - 1; i++) addEdge(coords[i], coords[i + 1]);
  };
  for (const f of feats) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "LineString") handleLine(g.coordinates);
    else if (g.type === "MultiLineString") g.coordinates.forEach(handleLine);
  }
  // Features do Overpass (raw OSM, mais completo)
  let overpassAdded = 0;
  for (const f of _overpassFeats) {
    const g = f.geometry;
    if (!g || g.type !== "LineString") continue;
    handleLine(g.coordinates);
    overpassAdded++;
  }

  const VIRTUAL_COST = 20;

  // Bridge 1 — nó-a-nó (junções soltas entre fragmentos)
  const NODE_LINK_M = 50;
  const nodeIds = Object.keys(nodes);
  let virtualEdges = 0;
  for (let i = 0; i < nodeIds.length; i++) {
    for (let j = i + 1; j < nodeIds.length; j++) {
      const ca = nodes[nodeIds[i]], cb = nodes[nodeIds[j]];
      const d = _hav(ca[1], ca[0], cb[1], cb[0]);
      if (d > 0 && d < NODE_LINK_M) {
        const exists = adj[nodeIds[i]].some(([id]) => id === nodeIds[j]);
        if (!exists) {
          adj[nodeIds[i]].push([nodeIds[j], d * VIRTUAL_COST]);
          adj[nodeIds[j]].push([nodeIds[i], d * VIRTUAL_COST]);
          virtualEdges++;
        }
      }
    }
  }

  // Bridge 2 — nó-a-segmento (atalhos no meio de ruas)
  const PROJ_LINK_M = 25;
  const edgesList = [];
  const seenEdges = new Set();
  for (const idA in adj) {
    for (const [idB] of adj[idA]) {
      const k = idA < idB ? idA + "|" + idB : idB + "|" + idA;
      if (seenEdges.has(k)) continue;
      seenEdges.add(k);
      edgesList.push([idA, idB]);
    }
  }
  let projEdges = 0;
  for (const nid of nodeIds) {
    const n = nodes[nid];
    let melhor = { distM: Infinity, edge: null, point: null, t: 0 };
    for (const [idA, idB] of edgesList) {
      if (idA === nid || idB === nid) continue;
      const a = nodes[idA], b = nodes[idB];
      const ax = a[0], ay = a[1], bx = b[0], by = b[1];
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const t = ((n[0] - ax) * dx + (n[1] - ay) * dy) / len2;
      if (t < 0.1 || t > 0.9) continue;
      const cx = ax + t * dx, cy = ay + t * dy;
      const distM = _hav(n[1], n[0], cy, cx);
      if (distM < melhor.distM) {
        melhor = { distM, edge: [idA, idB], point: [cx, cy], t };
      }
    }
    if (melhor.edge && melhor.distM < PROJ_LINK_M) {
      const [aId, bId] = melhor.edge;
      const virtId = "__pinj_" + Object.keys(nodes).length;
      nodes[virtId] = melhor.point;
      adj[virtId] = [];
      const dA = _hav(melhor.point[1], melhor.point[0], nodes[aId][1], nodes[aId][0]);
      const dB = _hav(melhor.point[1], melhor.point[0], nodes[bId][1], nodes[bId][0]);
      adj[virtId].push([aId, dA]); adj[aId].push([virtId, dA]);
      adj[virtId].push([bId, dB]); adj[bId].push([virtId, dB]);
      adj[virtId].push([nid, melhor.distM * VIRTUAL_COST]);
      adj[nid].push([virtId, melhor.distM * VIRTUAL_COST]);
      projEdges++;
    }
  }
  console.log(`[IFrota] rede viária — ${Object.keys(nodes).length} nós, ${kept}/${total} segmentos, ` +
    `${overpassAdded} overpass, ${virtualEdges} bridges nó-a-nó, ${projEdges} projeções`);
  return { nodes, adj };
}

function _construirEcachearRede() {
  if (_redeCache) return _redeCache;
  const rede = _construirRedeViaria();
  if (rede && Object.keys(rede.nodes).length > 5) _redeCache = rede;
  return rede;
}

function _cloneRede(rede) {
  const nodes = {};
  const adj = {};
  for (const id in rede.nodes) nodes[id] = rede.nodes[id];
  for (const id in rede.adj) adj[id] = rede.adj[id].slice();
  return { nodes, adj };
}

// Top-K segmentos mais próximos do ponto (com projeção perpendicular)
function _topKSegmentos(rede, lat, lon, maxDistM, k) {
  const adj = rede.adj, nodes = rede.nodes;
  const candidatos = [];
  const visited = new Set();
  for (const idA in adj) {
    for (const [idB] of adj[idA]) {
      const key = idA < idB ? idA + "|" + idB : idB + "|" + idA;
      if (visited.has(key)) continue;
      visited.add(key);
      const a = nodes[idA], b = nodes[idB];
      const ax = a[0], ay = a[1], bx = b[0], by = b[1];
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = 0;
      if (len2 > 0) {
        t = ((lon - ax) * dx + (lat - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
      }
      const cx = ax + t * dx, cy = ay + t * dy;
      const distM = _hav(lat, lon, cy, cx);
      if (distM <= maxDistM) candidatos.push({ distM, edge: [idA, idB], point: [cx, cy], t });
    }
  }
  candidatos.sort((a, b) => a.distM - b.distM);
  return candidatos.slice(0, k);
}

function _injetarCandidato(rede, cand) {
  const [aId, bId] = cand.edge;
  if (cand.t < 0.02) return aId;
  if (cand.t > 0.98) return bId;
  const virtId = "__inj_" + Object.keys(rede.nodes).length;
  rede.nodes[virtId] = cand.point;
  rede.adj[virtId] = [];
  const dA = _hav(cand.point[1], cand.point[0], rede.nodes[aId][1], rede.nodes[aId][0]);
  const dB = _hav(cand.point[1], cand.point[0], rede.nodes[bId][1], rede.nodes[bId][0]);
  rede.adj[virtId].push([aId, dA]);
  rede.adj[virtId].push([bId, dB]);
  rede.adj[aId].push([virtId, dA]);
  rede.adj[bId].push([virtId, dB]);
  return virtId;
}

// ── Cálculo principal da rota ──────────────────────────────────────────────────
// Retorna { dist, eta, modo, coords, virtualMap } e desenha a rota no mapa.
// opts.animate=false → recalcula sem reanimar a câmera (usado no reroute).
export function calcularRota(startLat, startLon, dest, opts = {}) {
  _offRouteCount = 0;  // novo cálculo zera o contador de desvio
  const destLat = dest.coords[0], destLon = dest.coords[1];
  const SNAP_MAX_M = 120;
  const redeCache = _construirEcachearRede();
  let routeCoords = null;
  let virtualMap = null;
  let modo = "";

  if (redeCache && Object.keys(redeCache.nodes).length > 0) {
    const TOP_K = 5;
    const startCand = _topKSegmentos(redeCache, startLat, startLon, SNAP_MAX_M, TOP_K);
    const endCand = _topKSegmentos(redeCache, destLat, destLon, SNAP_MAX_M, TOP_K);
    let bestPath = null, bestCost = Infinity, bestRede = null;
    for (const sCand of startCand) {
      for (const eCand of endCand) {
        const rede = _cloneRede(redeCache);
        const sId = _injetarCandidato(rede, sCand);
        const eId = _injetarCandidato(rede, eCand);
        if (!sId || !eId) continue;
        const path = _astar(rede.adj, sId, eId, rede.nodes);
        if (!path || path.length < 2) continue;
        let custo = sCand.distM + eCand.distM;
        for (let i = 1; i < path.length; i++) {
          const a = rede.nodes[path[i - 1]], b = rede.nodes[path[i]];
          custo += _hav(a[1], a[0], b[1], b[0]);
        }
        if (custo < bestCost) { bestCost = custo; bestPath = path; bestRede = rede; }
      }
    }
    if (bestPath && bestRede) {
      const virtNodes = bestPath.filter((id) => id.startsWith("__")).length;
      console.log(`[IFrota] A* — path=${bestPath.length} nós (${virtNodes} virtuais), custo=${Math.round(bestCost)}m`);
      routeCoords = [[startLat, startLon]];
      for (const id of bestPath) {
        const c = bestRede.nodes[id];
        routeCoords.push([c[1], c[0]]);
      }
      routeCoords.push([destLat, destLon]);
      modo = "mapa";
      virtualMap = new Array(routeCoords.length - 1).fill(false);
      virtualMap[0] = true;
      virtualMap[virtualMap.length - 1] = true;
      for (let i = 0; i < bestPath.length - 1; i++) {
        const a = bestRede.nodes[bestPath[i]];
        const b = bestRede.nodes[bestPath[i + 1]];
        const geo = _hav(a[1], a[0], b[1], b[0]);
        const edge = bestRede.adj[bestPath[i]].find(([id]) => id === bestPath[i + 1]);
        const w = edge ? edge[1] : geo;
        virtualMap[i + 1] = (w > geo * 2);
      }
    }
  }

  if (!routeCoords) {
    routeCoords = [[startLat, startLon], [destLat, destLon]];
    modo = "linha-reta";
  }

  let dist = 0;
  for (let i = 1; i < routeCoords.length; i++) {
    dist += _hav(routeCoords[i - 1][0], routeCoords[i - 1][1], routeCoords[i][0], routeCoords[i][1]);
  }
  const eta = Math.max(1, Math.round(dist / 1.4 / 60));
  desenharRota(routeCoords, destLat, destLon, virtualMap, { animate: opts.animate !== false });
  isolarDestino(dest.nome);
  return { dist: Math.round(dist), eta, modo, coords: routeCoords, virtualMap };
}

// ── Tracking / off-route ───────────────────────────────────────────────────────
// Projeção perpendicular do ponto na polyline; retorna {dist, seg, t}.
function _distPontoPolyline(lat, lon, polyline) {
  if (!polyline || polyline.length < 2) return { dist: Infinity, seg: 0, t: 0 };
  let melhor = { dist: Infinity, seg: 0, t: 0 };
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i], b = polyline[i + 1];  // [lat, lon]
    const ax = a[1], ay = a[0], bx = b[1], by = b[0];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 0) {
      t = ((lon - ax) * dx + (lat - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
    }
    const cy = ay + t * dy, cx = ax + t * dx;
    const d = _hav(lat, lon, cy, cx);
    if (d < melhor.dist) melhor = { dist: d, seg: i, t };
  }
  return melhor;
}

// Distância restante do ponto projetado até o fim da rota.
function _distRestantePolyline(lat, lon, polyline) {
  const proj = _distPontoPolyline(lat, lon, polyline);
  if (!polyline || polyline.length < 2 || proj.dist === Infinity) return 0;
  const a = polyline[proj.seg], b = polyline[proj.seg + 1];
  const px = a[1] + proj.t * (b[1] - a[1]);
  const py = a[0] + proj.t * (b[0] - a[0]);
  let resto = _hav(py, px, b[0], b[1]);
  for (let i = proj.seg + 1; i < polyline.length - 1; i++) {
    resto += _hav(polyline[i][0], polyline[i][1], polyline[i + 1][0], polyline[i + 1][1]);
  }
  return resto;
}

// Chamada a cada atualização de GPS durante uma rota ativa. Retorna null se não
// há rota; senão { remaining, eta, offDist, reroute }. reroute=true quando o
// usuário ficou OFF_ROUTE_TRIES leituras consecutivas fora da rota.
export function atualizarTracking(lat, lon) {
  if (!_currentRoute || _currentRoute.length < 2) return null;
  const proj = _distPontoPolyline(lat, lon, _currentRoute);
  const remaining = _distRestantePolyline(lat, lon, _currentRoute);
  const eta = Math.max(1, Math.round(remaining / 1.4 / 60));
  let reroute = false;
  if (proj.dist > OFF_ROUTE_M) {
    _offRouteCount++;
    if (_offRouteCount >= OFF_ROUTE_TRIES) { reroute = true; _offRouteCount = 0; }
  } else {
    _offRouteCount = 0;
  }
  return { remaining: Math.round(remaining), eta, offDist: Math.round(proj.dist), reroute };
}

// ── Desenho da rota (real sólido vs virtual tracejado) ─────────────────────────
export function desenharRota(coords, destLat, destLon, virtualMap, opts = {}) {
  _currentRoute = coords;
  _currentVirtualMap = virtualMap || null;
  if (!_map.isStyleLoaded()) {
    setTimeout(() => desenharRota(coords, destLat, destLon, virtualMap), 150);
    return;
  }
  if (!virtualMap || virtualMap.length === 0) {
    virtualMap = new Array(Math.max(0, coords.length - 1)).fill(false);
  }
  const features = [];
  if (coords.length >= 2) {
    let segStart = 0;
    let segIsVirt = virtualMap[0];
    for (let i = 1; i < virtualMap.length; i++) {
      if (virtualMap[i] !== segIsVirt) {
        const slice = coords.slice(segStart, i + 1).map((c) => [c[1], c[0]]);
        features.push({ type: "Feature", properties: { virtual: segIsVirt }, geometry: { type: "LineString", coordinates: slice } });
        segStart = i;
        segIsVirt = virtualMap[i];
      }
    }
    const slice = coords.slice(segStart).map((c) => [c[1], c[0]]);
    features.push({ type: "Feature", properties: { virtual: segIsVirt }, geometry: { type: "LineString", coordinates: slice } });
  }
  const data = { type: "FeatureCollection", features };
  ["route-casing", "route-line", "route-line-real", "route-line-virtual"].forEach((id) => {
    if (_map.getLayer(id)) _map.removeLayer(id);
  });
  if (_map.getSource("route")) _map.removeSource("route");
  _map.addSource("route", { type: "geojson", data });
  _map.addLayer({
    id: "route-casing", source: "route", type: "line",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": 0.9 },
  });
  _map.addLayer({
    id: "route-line-real", source: "route", type: "line",
    filter: ["!=", ["get", "virtual"], true],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#0f172a", "line-width": 5, "line-opacity": 1 },
  });
  _map.addLayer({
    id: "route-line-virtual", source: "route", type: "line",
    filter: ["==", ["get", "virtual"], true],
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: { "line-color": "#ea580c", "line-width": 5, "line-opacity": 1, "line-dasharray": [1.8, 1.2] },
  });

  if (destLat === undefined || destLon === undefined) return;  // só redesenho (troca de tema)
  _currentDest = [destLat, destLon];
  // No reroute (animate:false) não reanima a câmera — evita "pulo" durante a navegação.
  if (opts.animate === false) return;
  _animatingRoute = true;
  _map.flyTo({ center: [destLon, destLat], zoom: 19, pitch: 45, duration: 1500, essential: true });
  setTimeout(() => {
    const b = new maplibregl.LngLatBounds();
    coords.forEach((c) => b.extend([c[1], c[0]]));
    _map.fitBounds(b, { padding: 60, maxZoom: 19, pitch: 45, duration: 1500, essential: true });
    setTimeout(() => { _animatingRoute = false; }, 3000);
  }, 2000);
}

export function limparRota() {
  _currentRoute = null;
  _currentDest = null;
  _currentVirtualMap = null;
  _animatingRoute = false;
  ["route-casing", "route-line", "route-line-real", "route-line-virtual"].forEach((id) => {
    if (_map.getLayer(id)) _map.removeLayer(id);
  });
  if (_map.getSource("route")) _map.removeSource("route");
}

// Re-adiciona as layers da rota após setStyle (troca de tema), sem reanimar.
export function reAddRouteLayers() {
  if (_currentRoute) desenharRota(_currentRoute, undefined, undefined, _currentVirtualMap);
}
