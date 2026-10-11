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
  _redeCache = null;   // rede de um init anterior não vale pro mapa novo
  if (campusPoly && campusPoly.length) _setCellDeg(campusPoly[0][0]);
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

// Grade espacial (hash de células) pra busca de vizinhança nos bridges, no lugar
// das varreduras O(n²). A célula mede ≥60 m nos DOIS eixos — como os graus de
// longitude encolhem com cos(latitude), o tamanho é derivado da latitude do
// campus no initRouting em vez de fixado. Assim tudo dentro do raio dos bridges
// (≤50 m) está garantidamente nas células 3×3 ao redor.
let _cellDeg = 60 / 111320;
function _setCellDeg(latRef) {
  const cos = Math.max(0.2, Math.cos((latRef * Math.PI) / 180));
  _cellDeg = 60 / (111320 * cos);
}
function _gridAdd(grid, cx, cy, item) {
  const k = cx + ":" + cy;
  const arr = grid.get(k);
  if (arr) arr.push(item);
  else grid.set(k, [item]);
}
// Itens das células 3×3 ao redor de (lon, lat). Pode repetir item (aresta que
// cruza mais de uma célula) — os consumidores toleram duplicata.
function _gridNear(grid, lon, lat) {
  const cx = Math.floor(lon / _cellDeg), cy = Math.floor(lat / _cellDeg);
  const out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const arr = grid.get((cx + dx) + ":" + (cy + dy));
      if (arr) out.push(...arr);
    }
  }
  return out;
}

// ── A* ───────────────────────────────────────────────────────────────────────
// Min-heap binário de [f, id] — extração do menor em O(log n) no lugar da
// varredura linear do open set (equivale ao heapq do IFrota.py).
function _heapPush(h, f, id) {
  h.push([f, id]);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    const tmp = h[p]; h[p] = h[i]; h[i] = tmp;
    i = p;
  }
}
function _heapPop(h) {
  const top = h[0];
  const last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      const tmp = h[m]; h[m] = h[i]; h[i] = tmp;
      i = m;
    }
  }
  return top;
}

function _astar(adj, startId, goalId, nodes) {
  const cameFrom = {};
  const gScore = { [startId]: 0 };
  const goal = nodes[goalId];
  const h = (id) => {
    const n = nodes[id];
    return _hav(n[1], n[0], goal[1], goal[0]);
  };
  // Entradas obsoletas ficam no heap (um nó pode ser empilhado mais de uma vez
  // com f decrescente); `closed` garante que cada nó expande uma vez só.
  const open = [];
  const closed = new Set();
  _heapPush(open, h(startId), startId);
  while (open.length) {
    const curr = _heapPop(open)[1];
    if (closed.has(curr)) continue;
    closed.add(curr);
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
        _heapPush(open, t + h(nb), nb);
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

  // Bridge 1 — nó-a-nó (junções soltas entre fragmentos). A grade limita a
  // busca às células vizinhas em vez de comparar todos os pares de nós.
  const NODE_LINK_M = 50;
  const nodeIds = Object.keys(nodes);
  const nodeGrid = new Map();
  for (const id of nodeIds) {
    const c = nodes[id];
    _gridAdd(nodeGrid, Math.floor(c[0] / _cellDeg), Math.floor(c[1] / _cellDeg), id);
  }
  let virtualEdges = 0;
  for (const idA of nodeIds) {
    const ca = nodes[idA];
    for (const idB of _gridNear(nodeGrid, ca[0], ca[1])) {
      if (idB <= idA) continue;   // cada par considerado uma vez só
      const cb = nodes[idB];
      const d = _hav(ca[1], ca[0], cb[1], cb[0]);
      if (d > 0 && d < NODE_LINK_M) {
        const exists = adj[idA].some(([id]) => id === idB);
        if (!exists) {
          adj[idA].push([idB, d * VIRTUAL_COST]);
          adj[idB].push([idA, d * VIRTUAL_COST]);
          virtualEdges++;
        }
      }
    }
  }

  // Bridge 2 — nó-a-segmento (atalhos no meio de ruas). Arestas indexadas na
  // grade pelas células do seu bounding box; cada nó só testa as arestas próximas
  // (toda projeção < PROJ_LINK_M cai dentro das células 3×3 do nó).
  const PROJ_LINK_M = 25;
  const edgeGrid = new Map();
  const seenEdges = new Set();
  for (const idA in adj) {
    for (const [idB] of adj[idA]) {
      const k = idA < idB ? idA + "|" + idB : idB + "|" + idA;
      if (seenEdges.has(k)) continue;
      seenEdges.add(k);
      const a = nodes[idA], b = nodes[idB];
      const x0 = Math.floor(Math.min(a[0], b[0]) / _cellDeg), x1 = Math.floor(Math.max(a[0], b[0]) / _cellDeg);
      const y0 = Math.floor(Math.min(a[1], b[1]) / _cellDeg), y1 = Math.floor(Math.max(a[1], b[1]) / _cellDeg);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) _gridAdd(edgeGrid, cx, cy, [idA, idB]);
      }
    }
  }
  let projEdges = 0;
  for (const nid of nodeIds) {
    const n = nodes[nid];
    let melhor = { distM: Infinity, edge: null, point: null, t: 0 };
    for (const [idA, idB] of _gridNear(edgeGrid, n[0], n[1])) {
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
  // Só memoriza quando os tiles do viewport terminaram de carregar — uma rede
  // montada sobre tiles parciais ficaria incompleta pra sempre. Sem o cache a
  // rede é reconstruída na próxima rota (rápido com a grade espacial).
  const tilesOk = typeof _map.areTilesLoaded !== "function" || _map.areTilesLoaded();
  if (rede && Object.keys(rede.nodes).length > 5 && tilesOk) _redeCache = rede;
  return rede;
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

// Injeta o candidato DIRETO na rede (sem clonar) e devolve o necessário pro
// _removerInjetado desfazer — as arestas novas entram no FIM das listas.
let _injSeq = 0;
function _injetarCandidato(rede, cand) {
  const [aId, bId] = cand.edge;
  if (cand.t < 0.02) return { id: aId, virt: false };
  if (cand.t > 0.98) return { id: bId, virt: false };
  const virtId = "__inj_" + (_injSeq++);
  rede.nodes[virtId] = cand.point;
  const dA = _hav(cand.point[1], cand.point[0], rede.nodes[aId][1], rede.nodes[aId][0]);
  const dB = _hav(cand.point[1], cand.point[0], rede.nodes[bId][1], rede.nodes[bId][0]);
  rede.adj[virtId] = [[aId, dA], [bId, dB]];
  rede.adj[aId].push([virtId, dA]);
  rede.adj[bId].push([virtId, dB]);
  return { id: virtId, virt: true, aId, bId };
}

// Desfaz uma injeção. Remover em ordem LIFO (último injetado primeiro) garante
// que os pop() tiram exatamente as arestas adicionadas.
function _removerInjetado(rede, inj) {
  if (!inj.virt) return;
  delete rede.nodes[inj.id];
  delete rede.adj[inj.id];
  rede.adj[inj.aId].pop();
  rede.adj[inj.bId].pop();
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
  let houveCandidatos = false;

  if (redeCache && Object.keys(redeCache.nodes).length > 0) {
    const TOP_K = 5;
    const startCand = _topKSegmentos(redeCache, startLat, startLon, SNAP_MAX_M, TOP_K);
    const endCand = _topKSegmentos(redeCache, destLat, destLon, SNAP_MAX_M, TOP_K);
    houveCandidatos = startCand.length > 0 && endCand.length > 0;
    // Cada par de candidatos é injetado direto na rede cacheada e desfeito em
    // seguida — nada de clonar nodes+adj inteiros TOP_K² vezes. Como os nós
    // injetados somem no undo, coords e flags do melhor path são resolvidos
    // ainda dentro da iteração.
    let bestCost = Infinity, bestLen = 0, bestVirtNodes = 0;
    let bestCoords = null, bestVirt = null;
    for (const sCand of startCand) {
      for (const eCand of endCand) {
        const sInj = _injetarCandidato(redeCache, sCand);
        const eInj = _injetarCandidato(redeCache, eCand);
        const path = _astar(redeCache.adj, sInj.id, eInj.id, redeCache.nodes);
        if (path && path.length >= 2) {
          let custo = sCand.distM + eCand.distM;
          const virt = [];
          for (let i = 1; i < path.length; i++) {
            const a = redeCache.nodes[path[i - 1]], b = redeCache.nodes[path[i]];
            const geo = _hav(a[1], a[0], b[1], b[0]);
            custo += geo;
            const edge = redeCache.adj[path[i - 1]].find(([id]) => id === path[i]);
            virt.push((edge ? edge[1] : geo) > geo * 2);
          }
          if (custo < bestCost) {
            bestCost = custo;
            bestLen = path.length;
            bestVirtNodes = path.filter((id) => id.startsWith("__")).length;
            bestCoords = path.map((id) => {
              const c = redeCache.nodes[id];
              return [c[1], c[0]];
            });
            bestVirt = virt;
          }
        }
        _removerInjetado(redeCache, eInj);   // LIFO: desfaz o último primeiro
        _removerInjetado(redeCache, sInj);
      }
    }
    if (bestCoords) {
      console.log(`[IFrota] A* — path=${bestLen} nós (${bestVirtNodes} virtuais), custo=${Math.round(bestCost)}m`);
      routeCoords = [[startLat, startLon], ...bestCoords, [destLat, destLon]];
      modo = "mapa";
      virtualMap = [true, ...bestVirt, true];
    }
  }

  if (!routeCoords) {
    // Invalida a rede SÓ quando o A* falhou de verdade: snap achou candidatos
    // nas duas pontas mas nenhum caminho — sinal de rede incompleta. Sem
    // candidatos, o problema é o ponto (longe da malha), não a rede, e
    // invalidar aqui poderia trocar um preload bom por uma rede do viewport.
    if (houveCandidatos) _redeCache = null;
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
    // Repassa opts (preserva animate). Após ~6 s de polling, troca o timer por
    // um "styledata" — desenha quando o estilo carregar, em vez de desistir em
    // silêncio (a rota já está em _currentRoute e o tracking segue ativo).
    const tries = (opts._tries || 0) + 1;
    if (tries <= 40) {
      setTimeout(() => desenharRota(coords, destLat, destLon, virtualMap, { ...opts, _tries: tries }), 150);
    } else {
      _map.once("styledata", () => desenharRota(coords, destLat, destLon, virtualMap, { ...opts, _tries: 0 }));
    }
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
