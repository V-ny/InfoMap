import sys
import os
import json
import math
import heapq
import urllib.request
import unicodedata
import tempfile
import threading
import http.server

# Flags de GPU — devem vir antes de qualquer import Qt.
# --in-process-gpu: mantém o processo de GPU dentro do processo principal,
#   evitando o handshake cross-process que falha em sistemas sem GPU adequada.
# --disable-gpu: desativa aceleração de hardware.
# --no-sandbox + QTWEBENGINE_DISABLE_SANDBOX: remove restrições de sandbox.
os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = "--disable-gpu --in-process-gpu --no-sandbox"
os.environ["QTWEBENGINE_DISABLE_SANDBOX"] = "1"

import folium
from folium import Element
import qtawesome as qta

from PySide6.QtWidgets import (
    QApplication, QWidget, QPushButton, QLineEdit, QLabel,
    QHBoxLayout, QVBoxLayout, QGraphicsDropShadowEffect,
)
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEnginePage
from PySide6.QtCore import Qt, Signal, QPropertyAnimation, QEasingCurve, QRect, QUrl, QTimer, QSize, QThread
from PySide6.QtGui import QColor, QPainter
try:
    from PySide6.QtPositioning import QGeoPositionInfoSource, QGeoPositionInfo
    _POSITIONING_OK = True
except ImportError:
    QGeoPositionInfoSource = None  # type: ignore
    QGeoPositionInfo = None  # type: ignore
    _POSITIONING_OK = False

# ─── GEOMETRIA ────────────────────────────────────────────────────────────────
WIN_W, WIN_H = 420, 860
HEADER_H     = 62
SEARCH_H     = 64
CHIPS_H      = 48
PANEL_W      = 280
CARD_H       = 268
ANIM_MS      = 340

# ─── CAMPUS ───────────────────────────────────────────────────────────────────
SW_LAT, SW_LON = -22.5225, -43.9960
NE_LAT, NE_LON = -22.5175, -43.9890
CENTRO_LAT = (SW_LAT + NE_LAT) / 2
CENTRO_LON = (SW_LON + NE_LON) / 2
ZOOM_PADRAO = 17

COR_HEX = {
    "green":      "#5cb85c", "lightgreen": "#8bc34a", "red":        "#d9534f",
    "blue":       "#428bca", "orange":     "#f0ad4e", "purple":     "#9B479F",
    "pink":       "#e91e8c", "cadetblue":  "#436978", "darkgreen":  "#2e7d32",
    "darkred":    "#a23336", "darkpurple": "#5B396B",
}

EMOJI_ICONE = {
    "road": "🚧", "briefcase": "💼", "book": "📚", "graduation-cap": "🎓",
    "bullhorn": "📢", "paint-brush": "🎨", "cutlery": "🍴", "futbol-o": "⚽",
    "leaf": "🌿", "sun-o": "☀", "paw": "🐾",
}

# Mapeia os ícones FontAwesome usados no mapa para Material Design Icons (qtawesome)
MDI_ICONE = {
    "road":           "mdi6.gate",
    "briefcase":      "mdi6.briefcase-outline",
    "book":           "mdi6.book-open-variant",
    "graduation-cap": "mdi6.school-outline",
    "bullhorn":       "mdi6.bullhorn-outline",
    "paint-brush":    "mdi6.palette-outline",
    "cutlery":        "mdi6.silverware-fork-knife",
    "futbol-o":       "mdi6.soccer",
    "leaf":           "mdi6.leaf",
    "sun-o":          "mdi6.white-balance-sunny",
    "paw":            "mdi6.paw",
}

CATEGORIAS = [
    ("Tudo",           "Tudo",           None),
    ("Ensino",         "Ensino",         "#428bca"),
    ("Administrativo", "Administrativo", "#d9534f"),
    ("Agropecuária",   "Agropecuária",   "#5cb85c"),
    ("Acessos",        "Acessos",        "#8bc34a"),
    ("Convivência",    "Convivência",    "#436978"),
    ("Esporte",        "Esporte",        "#2e7d32"),
]

LOCAIS_PADRAO = [
    {"nome": "Portaria 1 (Principal)", "coords": [-22.518476, -43.995129], "cor": "green",     "icone": "road",           "cat": "Acessos",        "desc": "Entrada principal do campus."},
    {"nome": "Portaria 2",             "coords": [-22.520139, -43.994636], "cor": "lightgreen", "icone": "road",           "cat": "Acessos",        "desc": "Acesso secundário ao campus."},
    {"nome": "Diretoria",              "coords": [-22.521774, -43.990663], "cor": "red",        "icone": "briefcase",      "cat": "Administrativo", "desc": "Setor de gestão e administração da instituição."},
    {"nome": "Biblioteca",             "coords": [-22.520877, -43.990945], "cor": "blue",       "icone": "book",           "cat": "Ensino",         "desc": "Acervo bibliográfico aberto a alunos e funcionários."},
    {"nome": "Prédio Principal",       "coords": [-22.520178, -43.994086], "cor": "orange",     "icone": "graduation-cap", "cat": "Ensino",         "desc": "Bloco central com salas de aula e coordenações."},
    {"nome": "Auditório",              "coords": [-22.520218, -43.990749], "cor": "purple",     "icone": "bullhorn",       "cat": "Administrativo", "desc": "Espaço para eventos e apresentações."},
    {"nome": "Laboratório de Artes",   "coords": [-22.522104, -43.990095], "cor": "pink",       "icone": "paint-brush",    "cat": "Ensino",         "desc": "Laboratório para atividades artísticas."},
    {"nome": "Cantina",                "coords": [-22.520270, -43.990411], "cor": "cadetblue",  "icone": "cutlery",        "cat": "Convivência",    "desc": "Serviço de alimentação para alunos e funcionários."},
    {"nome": "Quadra Poliesportiva",   "coords": [-22.520471, -43.990526], "cor": "darkgreen",  "icone": "futbol-o",       "cat": "Esporte",        "desc": "Quadra coberta para prática de esportes."},
    {"nome": "Plantação / Lavoura",    "coords": [-22.519237, -43.994515], "cor": "green",      "icone": "leaf",           "cat": "Agropecuária",   "desc": "Área de cultivo para atividades de agroecologia."},
    {"nome": "Estufa",                 "coords": [-22.520243, -43.991634], "cor": "orange",     "icone": "sun-o",          "cat": "Agropecuária",   "desc": "Estufa para produção de mudas e experimentos."},
    {"nome": "Suinocultura",           "coords": [-22.520040, -43.993464], "cor": "darkred",    "icone": "paw",            "cat": "Agropecuária",   "desc": "Setor de criação de suínos."},
    {"nome": "Equinos",                "coords": [-22.520149, -43.992557], "cor": "darkpurple", "icone": "paw",            "cat": "Agropecuária",   "desc": "Área de manejo e criação de cavalos."},
]

# ─── SERVIDOR LOCAL ───────────────────────────────────────────────────────────
def _start_local_server(html_path: str) -> str:
    """Serve o HTML via HTTP local para que o Chromium carregue CDNs normalmente."""
    directory = os.path.dirname(html_path)
    filename  = os.path.basename(html_path)

    class _Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=directory, **kwargs)
        def log_message(self, *_args, **_kwargs):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{port}/{filename}"

# ─── DADOS ────────────────────────────────────────────────────────────────────
CONFIG_FILE = "config.json"

def carregar_config() -> dict:
    if not os.path.exists(CONFIG_FILE):
        return {}
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}

def salvar_config(config: dict) -> None:
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
    except OSError:
        pass

GRAFO_FILE  = "grafo.json"
CAMPUS_FILE = "campus.geojson"

def carregar_campus():
    """Carrega o polígono do campus do GeoJSON. Retorna (coords, bbox) ou (None, None).
       coords: lista [(lat, lon), ...]; bbox: ((sw_lat, sw_lon), (ne_lat, ne_lon))"""
    if not os.path.exists(CAMPUS_FILE):
        return None, None
    try:
        with open(CAMPUS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        feats = data.get("features", [data]) if data.get("type") == "FeatureCollection" else [data]
        for feat in feats:
            geom = feat.get("geometry", feat)
            if geom.get("type") != "Polygon":
                continue
            ring = geom["coordinates"][0]
            coords = [(p[1], p[0]) for p in ring]  # GeoJSON é [lon,lat]
            lats = [c[0] for c in coords]
            lons = [c[1] for c in coords]
            bbox = ((min(lats), min(lons)), (max(lats), max(lons)))
            return coords, bbox
        return None, None
    except (json.JSONDecodeError, KeyError, IndexError, OSError, TypeError):
        return None, None

def ponto_dentro(lat, lon, polygon):
    """Ray casting. polygon = list[(lat, lon)]. Se polygon for vazio, retorna True."""
    if not polygon:
        return True
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        yi, xi = polygon[i]
        yj, xj = polygon[j]
        if ((yi > lat) != (yj > lat)) and \
           (lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi):
            inside = not inside
        j = i
    return inside

def haversine(lat1, lon1, lat2, lon2):
    """Distância em metros entre dois pontos."""
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return 2 * R * math.asin(math.sqrt(a))

def carregar_grafo():
    if not os.path.exists(GRAFO_FILE):
        return {"nodes": {}, "edges": [], "_next_id": 1}
    try:
        with open(GRAFO_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        data.setdefault("nodes", {})
        data.setdefault("edges", [])
        # Recalcula próximo ID baseado nos nós existentes
        max_id = 0
        for nid in data["nodes"]:
            try:
                max_id = max(max_id, int(nid.lstrip("n")))
            except ValueError:
                pass
        data["_next_id"] = max_id + 1
        return data
    except (json.JSONDecodeError, OSError):
        return {"nodes": {}, "edges": [], "_next_id": 1}

def salvar_grafo(grafo):
    try:
        out = {"nodes": grafo["nodes"], "edges": grafo["edges"]}
        with open(GRAFO_FILE, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
    except OSError:
        pass

def _adjacencias(grafo):
    adj = {nid: [] for nid in grafo["nodes"]}
    for a, b in grafo["edges"]:
        if a in grafo["nodes"] and b in grafo["nodes"]:
            la, oa = grafo["nodes"][a]
            lb, ob = grafo["nodes"][b]
            d = haversine(la, oa, lb, ob)
            adj[a].append((b, d))
            adj[b].append((a, d))
    return adj

def no_mais_proximo(grafo, lat, lon):
    best, best_d = None, float("inf")
    for nid, (la, lo) in grafo["nodes"].items():
        d = haversine(lat, lon, la, lo)
        if d < best_d:
            best_d, best = d, nid
    return best, best_d

def astar(grafo, start_id, goal_id):
    if start_id not in grafo["nodes"] or goal_id not in grafo["nodes"]:
        return None
    if start_id == goal_id:
        return [start_id]
    adj = _adjacencias(grafo)
    nodes = grafo["nodes"]
    g_lat, g_lon = nodes[goal_id]
    def h(nid):
        la, lo = nodes[nid]
        return haversine(la, lo, g_lat, g_lon)

    open_set = [(h(start_id), 0.0, start_id)]
    came_from = {}
    g_score = {start_id: 0.0}
    while open_set:
        _f, g, current = heapq.heappop(open_set)
        if current == goal_id:
            path = [current]
            while current in came_from:
                current = came_from[current]
                path.append(current)
            return list(reversed(path))
        if g > g_score.get(current, float("inf")):
            continue
        for nb, w in adj[current]:
            t = g + w
            if t < g_score.get(nb, float("inf")):
                came_from[nb] = current
                g_score[nb] = t
                heapq.heappush(open_set, (t + h(nb), t, nb))
    return None

def osrm_route(start, end, timeout=4):
    """Chama OSRM público (modo a pé). Retorna lista [[lat,lon],...] ou None."""
    url = (
        "https://router.project-osrm.org/route/v1/foot/"
        f"{start[1]},{start[0]};{end[1]},{end[0]}"
        "?overview=full&geometries=geojson"
    )
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("code") != "Ok" or not data.get("routes"):
            return None
        return [[c[1], c[0]] for c in data["routes"][0]["geometry"]["coordinates"]]
    except Exception:
        return None

def in_campus(lat, lon):
    return SW_LAT <= lat <= NE_LAT and SW_LON <= lon <= NE_LON

def calcular_rota(start, end, locais):
    """Híbrido: grafo interno + OSRM. Retorna lista [[lat,lon],...]."""
    grafo = carregar_grafo()
    s_in = in_campus(*start)
    e_in = in_campus(*end)

    # Ambos no campus + grafo populado → A* interno
    if s_in and e_in and grafo["nodes"]:
        s_id, _ = no_mais_proximo(grafo, *start)
        e_id, _ = no_mais_proximo(grafo, *end)
        path = astar(grafo, s_id, e_id) if s_id and e_id else None
        if path:
            interior = [grafo["nodes"][nid] for nid in path]
            return [list(start)] + interior + [list(end)]

    # Aluno fora, destino no campus → OSRM até portaria + grafo interno
    if (not s_in) and e_in and grafo["nodes"]:
        portarias = [l for l in locais if l.get("cat") == "Acessos"]
        if portarias:
            portaria = min(portarias, key=lambda l: haversine(start[0], start[1], l["coords"][0], l["coords"][1]))
            ext = osrm_route(start, portaria["coords"])
            if ext:
                p_id, _ = no_mais_proximo(grafo, *portaria["coords"])
                e_id, _ = no_mais_proximo(grafo, *end)
                if p_id and e_id:
                    interior_ids = astar(grafo, p_id, e_id)
                    if interior_ids:
                        interior = [grafo["nodes"][nid] for nid in interior_ids]
                        return ext + interior + [list(end)]

    # Caso geral: OSRM puro (ou ambos fora)
    osrm = osrm_route(start, end)
    if osrm:
        return osrm

    # Fallback: linha reta
    return [list(start), list(end)]

def comprimento_rota(coords):
    total = 0.0
    for i in range(1, len(coords)):
        total += haversine(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1])
    return total

def carregar_dados():
    arquivo = "locais.json"
    if not os.path.exists(arquivo):
        with open(arquivo, "w", encoding="utf-8") as f:
            json.dump(LOCAIS_PADRAO, f, ensure_ascii=False, indent=4)
        return LOCAIS_PADRAO

    with open(arquivo, "r", encoding="utf-8") as f:
        dados = json.load(f)

    # Migra JSONs antigos: preenche quaisquer campos ausentes a partir do padrão,
    # casando pelo campo "nome".
    padrao_por_nome = {l["nome"]: l for l in LOCAIS_PADRAO}
    alterado = False
    for local in dados:
        padrao = padrao_por_nome.get(local.get("nome"), {})
        for chave, valor in padrao.items():
            if chave not in local:
                local[chave] = valor
                alterado = True
        local.setdefault("desc", "")

    # Se migrou algo, persiste de volta para não repetir na próxima execução
    if alterado:
        with open(arquivo, "w", encoding="utf-8") as f:
            json.dump(dados, f, ensure_ascii=False, indent=4)

    return dados

# ─── BUSCA FUZZY ──────────────────────────────────────────────────────────────
def _norm(s):
    return "".join(
        c for c in unicodedata.normalize("NFD", s.lower())
        if unicodedata.category(c) != "Mn"
    )

def _lev(a, b):
    m, n = len(a), len(b)
    dp = list(range(n + 1))
    for i in range(1, m + 1):
        prev, dp[0] = dp[0], i
        for j in range(1, n + 1):
            temp = dp[j]
            dp[j] = prev if a[i-1] == b[j-1] else 1 + min(prev, dp[j], dp[j-1])
            prev = temp
    return dp[n]

def buscar_locais(query, locais):
    q = _norm(query)
    if len(q) < 2:
        return []
    resultado = []
    for local in locais:
        nn = _norm(local["nome"])
        if q in nn:
            resultado.append((0, local))
            continue
        menor = min(
            (_lev(q, p) for p in nn.split() if abs(len(p) - len(q)) <= 3),
            default=999,
        )
        if menor <= max(1, len(q) // 3):
            resultado.append((menor, local))
    resultado.sort(key=lambda x: x[0])
    return [r[1] for r in resultado]

# ─── MAPA HTML (folium) ───────────────────────────────────────────────────────
def gerar_mapa(locais):
    poligono, bbox = carregar_campus()
    if bbox:
        (sw_lat, sw_lon), (ne_lat, ne_lon) = bbox
        ctr_lat = (sw_lat + ne_lat) / 2
        ctr_lon = (sw_lon + ne_lon) / 2
        # Restringe waypoints exibidos aos que estão dentro do polígono
        if poligono:
            locais = [l for l in locais if ponto_dentro(l["coords"][0], l["coords"][1], poligono)]
    else:
        sw_lat, sw_lon = SW_LAT, SW_LON
        ne_lat, ne_lon = NE_LAT, NE_LON
        ctr_lat, ctr_lon = CENTRO_LAT, CENTRO_LON

    m = folium.Map(
        location=[ctr_lat, ctr_lon],
        zoom_start=ZOOM_PADRAO, min_zoom=ZOOM_PADRAO, max_zoom=20,
        control_scale=False, zoom_control=False, tiles=None,
        max_bounds=[[sw_lat, sw_lon], [ne_lat, ne_lon]],
        max_bounds_viscosity=1.0,
    )
    folium.TileLayer("CartoDB positron", name="Claro", overlay=False, control=False).add_to(m)

    for local in locais:
        hex_cor = COR_HEX.get(local["cor"], "#5cb85c")
        icon_html = (
            f'<div style="display:inline-block;text-align:center;">'
            f'<div style="background:{hex_cor};width:36px;height:36px;border-radius:50%;'
            f'display:flex;align-items:center;justify-content:center;'
            f'border:2.5px solid rgba(255,255,255,.95);box-shadow:0 3px 10px rgba(0,0,0,.35);">'
            f'<i class="fa fa-{local["icone"]}" style="color:white;font-size:14px;"></i>'
            f'</div>'
            f'<div style="width:0;height:0;border-left:8px solid transparent;'
            f'border-right:8px solid transparent;border-top:11px solid {hex_cor};'
            f'margin:0 auto;margin-top:-1px;"></div></div>'
        )
        folium.Marker(
            location=local["coords"],
            tooltip=local["nome"],
            icon=folium.DivIcon(html=icon_html, icon_size=(36, 47),
                                icon_anchor=(18, 47), class_name=""),
        ).add_to(m)

    dados_js   = json.dumps(locais, ensure_ascii=False)
    poly_js    = json.dumps([[c[0], c[1]] for c in poligono]) if poligono else "null"
    bounds_js  = json.dumps([[sw_lat, sw_lon], [ne_lat, ne_lon]])

    # JS mínimo: expõe funções chamadas pelo Python + envia cliques via console.log
    script = f"""
    <style>
        body, html {{ margin:0; padding:0; }}
        .leaflet-control-attribution {{ display:none !important; }}
    </style>
    <script>
    const _locais       = {dados_js};
    const _campusPoly   = {poly_js};
    const _campusBoundsArr = {bounds_js};
    let _allMarkers = [];

    function _getMap() {{
        return window[document.querySelector('.folium-map').id];
    }}

    function _collectMarkers() {{
        if (_allMarkers.length > 0) return;
        const m = _getMap();
        let total = 0, matched = 0;
        m.eachLayer(l => {{
            if (!(l instanceof L.Marker)) return;
            total++;
            const ll = l.getLatLng();
            // Casa o marcador pelo par de coordenadas (tolerância generosa)
            const info = _locais.find(x =>
                Math.abs(x.coords[0] - ll.lat) < 1e-5 &&
                Math.abs(x.coords[1] - ll.lng) < 1e-5
            );
            if (info) {{
                l._cat  = info.cat;
                l._nome = info.nome;
                _allMarkers.push(l);
                matched++;
            }}
        }});
        if (matched !== total) {{
            console.log('INFO: ' + matched + ' de ' + total + ' marcadores casados');
        }}
    }}

    window.flyToLocal = function(lat, lon) {{
        _getMap().flyTo([lat, lon], 19, {{animate:true, duration:1.5}});
    }};

    window.filtrarCat = function(cat) {{
        const m = _getMap();
        _collectMarkers();
        if (_allMarkers.length === 0) return;
        _allMarkers.forEach(l => {{
            const show = (cat === 'Tudo') || (l._cat === cat);
            if (show) {{
                if (!m.hasLayer(l)) m.addLayer(l);
            }} else {{
                if (m.hasLayer(l)) m.removeLayer(l);
            }}
        }});
    }};

    window.aplicarTema = function(escuro) {{
        const m = _getMap(), tiles = [];
        m.eachLayer(l => {{ if (l instanceof L.TileLayer) tiles.push(l); }});
        tiles.forEach(l => m.removeLayer(l));
        const url = escuro
            ? 'https://{{s}}.basemaps.cartocdn.com/dark_all/{{z}}/{{x}}/{{y}}{{r}}.png'
            : 'https://{{s}}.basemaps.cartocdn.com/light_all/{{z}}/{{x}}/{{y}}{{r}}.png';
        L.tileLayer(url, {{maxZoom:20}}).addTo(m);
    }};

    window.resetarMapa = function() {{
        _getMap().flyTo([{CENTRO_LAT}, {CENTRO_LON}], {ZOOM_PADRAO});
    }};

    let _userMarker = null;
    let _userAccuracy = null;
    let _manualMode = false;
    let _manualHandler = null;

    let _routeLine = null;
    window.desenharRota = function(coords) {{
        const m = _getMap();
        if (_routeLine) m.removeLayer(_routeLine);
        if (!coords || coords.length < 2) return;
        _routeLine = L.polyline(coords, {{
            color: '#1e88e5', weight: 6, opacity: 0.9,
            lineJoin: 'round', lineCap: 'round'
        }}).addTo(m);
        L.polyline(coords, {{
            color: 'white', weight: 2, opacity: 0.7,
            dashArray: '1, 14', lineCap: 'round'
        }}).addTo(_routeLine);
        try {{ m.fitBounds(_routeLine.getBounds(), {{padding:[50,50], maxZoom: 19}}); }} catch(e) {{}}
    }};
    window.limparRota = function() {{
        const m = _getMap();
        if (_routeLine) {{ m.removeLayer(_routeLine); _routeLine = null; }}
    }};

    // ── Editor de grafo ──
    let _editMode = false;
    let _editLayers = [];
    let _selectedNode = null;
    let _editClickHandler = null;

    function _drawGrafo(grafo) {{
        const m = _getMap();
        _editLayers.forEach(l => m.removeLayer(l));
        _editLayers = [];
        if (!_editMode) return;

        // arestas primeiro (embaixo)
        (grafo.edges || []).forEach(e => {{
            const a = grafo.nodes[e[0]], b = grafo.nodes[e[1]];
            if (a && b) {{
                const ln = L.polyline([a, b], {{color:'#ff9800', weight:3, opacity:0.85}}).addTo(m);
                _editLayers.push(ln);
            }}
        }});

        // nós
        Object.entries(grafo.nodes || {{}}).forEach(([nid, latlon]) => {{
            const sel = (nid === _selectedNode);
            const dot = L.circleMarker(latlon, {{
                radius: sel ? 9 : 6,
                color: 'white', weight: 2,
                fillColor: sel ? '#d32f2f' : '#ff9800',
                fillOpacity: 1
            }}).addTo(m);
            dot.on('click', function(ev) {{
                L.DomEvent.stopPropagation(ev);
                if (ev.originalEvent.shiftKey) {{
                    console.log('INFOMAP:GRAFO:DEL_NODE:' + nid);
                }} else if (_selectedNode && _selectedNode !== nid) {{
                    console.log('INFOMAP:GRAFO:EDGE:' + _selectedNode + ',' + nid);
                    _selectedNode = null;
                }} else {{
                    _selectedNode = nid;
                    _drawGrafo(grafo);
                }}
            }});
            _editLayers.push(dot);
        }});
    }}

    window._lastGrafo = {{nodes:{{}}, edges:[]}};
    window.renderizarGrafo = function(grafo) {{
        window._lastGrafo = grafo;
        _drawGrafo(grafo);
    }};

    window.ativarEditor = function(ativo) {{
        const m = _getMap();
        _editMode = ativo;
        _selectedNode = null;
        if (ativo) {{
            m.getContainer().style.cursor = 'crosshair';
            _editClickHandler = function(e) {{
                console.log('INFOMAP:GRAFO:NODE:' + e.latlng.lat + ',' + e.latlng.lng);
            }};
            m.on('click', _editClickHandler);
        }} else {{
            m.getContainer().style.cursor = '';
            if (_editClickHandler) m.off('click', _editClickHandler);
            _editClickHandler = null;
        }}
        _drawGrafo(window._lastGrafo);
    }};

    window.ativarModoManual = function(ativo) {{
        const m = _getMap();
        if (ativo && !_manualMode) {{
            _manualMode = true;
            m.getContainer().style.cursor = 'crosshair';
            _manualHandler = function(e) {{
                console.log('INFOMAP:POS:' + e.latlng.lat + ',' + e.latlng.lng);
            }};
            m.on('click', _manualHandler);
        }} else if (!ativo && _manualMode) {{
            _manualMode = false;
            m.getContainer().style.cursor = '';
            if (_manualHandler) m.off('click', _manualHandler);
            _manualHandler = null;
        }}
    }};
    window.mostrarUsuario = function(lat, lon, accuracy) {{
        const m = _getMap();
        const html = '<div style="width:18px;height:18px;border-radius:50%;'
            + 'background:#2196f3;border:3px solid white;'
            + 'box-shadow:0 0 0 3px rgba(33,150,243,0.35),0 2px 6px rgba(0,0,0,.4);"></div>';
        const icon = L.divIcon({{ html: html, iconSize: [18,18], iconAnchor: [9,9], className: '' }});
        if (_userMarker) {{
            _userMarker.setLatLng([lat, lon]);
        }} else {{
            _userMarker = L.marker([lat, lon], {{icon: icon, interactive: false, zIndexOffset: 1000}}).addTo(m);
        }}
        if (accuracy && accuracy > 0) {{
            if (_userAccuracy) _userAccuracy.setLatLng([lat, lon]).setRadius(accuracy);
            else _userAccuracy = L.circle([lat, lon], {{
                radius: accuracy, color: '#2196f3', fillColor: '#2196f3',
                fillOpacity: 0.12, weight: 1
            }}).addTo(m);
        }}
        m.flyTo([lat, lon], 19, {{animate: true, duration: 1.2}});
    }};

    function _setupCampus() {{
        const m = _getMap();
        const bounds = L.latLngBounds(_campusBoundsArr[0], _campusBoundsArr[1]);

        // Restringe quais tiles do OSM podem ser baixados
        m.eachLayer(l => {{
            if (l instanceof L.TileLayer) {{
                l.options.bounds = bounds;
            }}
        }});
        // Reaperta os limites de pan/zoom
        m.setMaxBounds(bounds.pad(0.05));

        // Máscara invertida + contorno do polígono do campus
        if (_campusPoly && _campusPoly.length > 2) {{
            const world = [[-85,-180],[-85,180],[85,180],[85,-180]];
            L.polygon([world, _campusPoly], {{
                fillColor: '#000', fillOpacity: 0.45,
                color: '#43a047', weight: 2.5,
                interactive: false
            }}).addTo(m);
            L.polygon(_campusPoly, {{
                fill: false, color: '#43a047', weight: 3,
                dashArray: '6,6', interactive: false
            }}).addTo(m);
            try {{ m.fitBounds(L.latLngBounds(_campusPoly), {{padding:[20,20]}}); }} catch(e) {{}}
        }}
    }}

    document.addEventListener('DOMContentLoaded', function() {{
        setTimeout(function() {{
            _collectMarkers();
            _allMarkers.forEach(l => {{
                l.on('click', function() {{
                    console.log('INFOMAP:CLICK:' + l._nome);
                }});
            }});
            _setupCampus();
        }}, 900);
    }});
    </script>
    """
    m.get_root().html.add_child(Element(script))

    tmp = os.path.join(tempfile.gettempdir(), "infomap_map.html")
    m.save(tmp)
    return tmp

# ─── PAGE: intercepta cliques nos marcadores via console.log ──────────────────
class InfoMapPage(QWebEnginePage):
    marker_clicked = Signal(str)
    map_clicked    = Signal(float, float)
    grafo_node_add = Signal(float, float)
    grafo_edge_add = Signal(str, str)
    grafo_node_del = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.featurePermissionRequested.connect(self._on_feature_permission)

    def _on_feature_permission(self, origin, feature):
        self.setFeaturePermission(
            origin, feature,
            QWebEnginePage.PermissionPolicy.PermissionGrantedByUser,
        )

    def javaScriptConsoleMessage(self, _level, message, _line, _source):
        if message.startswith("INFOMAP:CLICK:"):
            self.marker_clicked.emit(message[14:])
        elif message.startswith("INFOMAP:POS:"):
            try:
                lat_s, lon_s = message[12:].split(",", 1)
                self.map_clicked.emit(float(lat_s), float(lon_s))
            except ValueError:
                pass
        elif message.startswith("INFOMAP:GRAFO:NODE:"):
            try:
                lat_s, lon_s = message[19:].split(",", 1)
                self.grafo_node_add.emit(float(lat_s), float(lon_s))
            except ValueError:
                pass
        elif message.startswith("INFOMAP:GRAFO:EDGE:"):
            try:
                a, b = message[19:].split(",", 1)
                self.grafo_edge_add.emit(a, b)
            except ValueError:
                pass
        elif message.startswith("INFOMAP:GRAFO:DEL_NODE:"):
            self.grafo_node_del.emit(message[23:])
        else:
            print(f"[JS] {message}")

# ─── DIM OVERLAY (fundo semitransparente do menu lateral) ─────────────────────
class DimOverlay(QWidget):
    clicked = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.hide()

    def paintEvent(self, _event):
        p = QPainter(self)
        p.fillRect(self.rect(), QColor(0, 0, 0, 145))

    def mousePressEvent(self, _event):
        self.clicked.emit()

# ─── TEMAS QSS ────────────────────────────────────────────────────────────────
def _qss(dark: bool) -> str:
    if dark:
        root       = "#181825"
        hdr_grad   = "stop:0 #1b5e20, stop:1 #0d3b14"
        hdr_txt    = "#a5d6a7"
        hdr_hover  = "rgba(165,214,167,0.15)"
        sb_bg      = "#1e1e2e"
        sb_border  = "#313244"
        pill_bg    = "#313244"
        pill_bord  = "#45475a"
        inp_col    = "#cdd6f4"
        sbtn_bg    = "#2e7d32"; sbtn_hov = "#388e3c"
        chip_chk   = "#a6e3a1"; chip_chk_col = "#1e1e2e"
        panel_bg   = "#1e1e2e"; panel_div = "#313244"
        panel_tit  = "#a6e3a1"; panel_col = "#cdd6f4"; panel_hov = "#313244"; panel_hov_col = "#a6e3a1"
        leg_tit    = "#6c7086"
        card_bg    = "#1e1e2e"
        hdl_col    = "#45475a"
        card_tit   = "#cdd6f4"; card_cat_bg = "#313244"; card_cat_col = "#a6adc8"
        card_desc  = "#a6adc8"; card_div = "#313244"
        nav_bg     = "#2e7d32"; nav_hov = "#388e3c"
        cls_bg     = "#313244"; cls_col = "#cdd6f4"; cls_hov = "#45475a"
        res_bg     = "#1e1e2e"; res_bord = "#313244"
        res_col    = "#cdd6f4"; res_hov = "#313244"
    else:
        root       = "#f0f2f0"
        hdr_grad   = "stop:0 #43a047, stop:1 #2e7d32"
        hdr_txt    = "white"
        hdr_hover  = "rgba(255,255,255,0.18)"
        sb_bg      = "#ffffff"
        sb_border  = "#e8eae8"
        pill_bg    = "#f1f3f1"
        pill_bord  = "#dde0dd"
        inp_col    = "#1a1a1a"
        sbtn_bg    = "#43a047"; sbtn_hov = "#2e7d32"
        chip_chk   = "#2e7d32"; chip_chk_col = "white"
        panel_bg   = "#ffffff"; panel_div = "#e8eae8"
        panel_tit  = "#2e7d32"; panel_col = "#333"; panel_hov = "#f1f8e9"; panel_hov_col = "#2e7d32"
        leg_tit    = "#9e9e9e"
        card_bg    = "#ffffff"
        hdl_col    = "#ddd"
        card_tit   = "#1a1a1a"; card_cat_bg = "#f5f5f5"; card_cat_col = "#777"
        card_desc  = "#555"; card_div = "#f0f0f0"
        nav_bg     = "#2e7d32"; nav_hov = "#1b5e20"
        cls_bg     = "#f5f5f5"; cls_col = "#666"; cls_hov = "#e0e0e0"
        res_bg     = "#ffffff"; res_bord = "#e0e0e0"
        res_col    = "#333"; res_hov = "#f1f8e9"

    return f"""
    QWidget {{ font-family: 'Segoe UI', Arial, sans-serif; }}
    QWidget#root {{ background-color: {root}; }}

    QWidget#header {{
        background: qlineargradient(x1:0,y1:0,x2:0,y2:1, {hdr_grad});
    }}
    QLabel#title {{
        color: {hdr_txt}; font-size: 18px; font-weight: 700; letter-spacing: 0.5px;
    }}
    QPushButton#hdr_btn {{
        background: transparent; border: none; color: {hdr_txt};
        font-size: 20px; border-radius: 20px;
        min-width: 40px; max-width: 40px; min-height: 40px; max-height: 40px;
    }}
    QPushButton#hdr_btn:hover   {{ background: {hdr_hover}; }}
    QPushButton#hdr_btn:pressed {{ background: {hdr_hover}; }}
    QPushButton#hdr_btn[role="close"]:hover   {{ background: rgba(211,47,47,0.85); color: white; }}
    QPushButton#hdr_btn[role="minimize"]:hover {{ background: {hdr_hover}; }}

    QWidget#search_bar  {{ background-color: {sb_bg}; border-bottom: 1px solid {sb_border}; }}
    QWidget#search_pill {{ background-color: {pill_bg}; border-radius: 22px; border: 1.5px solid {pill_bord}; }}
    QLineEdit#search_input {{
        background: transparent; border: none;
        color: {inp_col}; font-size: 15px; padding: 0 4px;
    }}
    QPushButton#search_btn {{
        background-color: {sbtn_bg}; border: none; border-radius: 18px;
        color: white; font-size: 16px;
        min-width: 36px; max-width: 36px; min-height: 36px; max-height: 36px;
    }}
    QPushButton#search_btn:hover {{ background-color: {sbtn_hov}; }}

    QWidget#slide_panel  {{ background-color: {panel_bg}; }}
    QWidget#panel_divider {{ background-color: {panel_div}; }}
    QLabel#panel_title   {{ color: {panel_tit}; font-size: 20px; font-weight: 700; letter-spacing: 0.3px; }}
    QLabel#panel_subtitle {{ color: {leg_tit}; font-size: 11px; font-weight: 500; }}
    QLabel#section_header {{
        color: {leg_tit}; font-size: 10px; font-weight: 700; letter-spacing: 1.4px;
        padding-left: 2px;
    }}
    QPushButton#panel_btn {{
        background: transparent; border: 1.5px solid {panel_div}; color: {panel_col};
        font-size: 13px; padding: 0 14px; text-align: left; border-radius: 10px;
    }}
    QPushButton#panel_btn:hover {{ background-color: {panel_hov}; color: {panel_hov_col}; }}

    QPushButton#cat_btn {{
        background-color: transparent; border: 1.5px solid {panel_div};
        border-radius: 10px; color: {panel_col}; text-align: left;
        padding-left: 14px; font-size: 13px; font-weight: 500;
    }}
    QPushButton#cat_btn:hover:!checked {{
        background-color: {panel_hov}; border-color: {panel_hov};
    }}
    QPushButton#cat_btn:checked {{
        background-color: {chip_chk}; color: {chip_chk_col}; border-color: {chip_chk};
        font-weight: 600;
    }}

    QWidget#bottom_card  {{ background-color: {card_bg}; border-radius: 22px 22px 0 0; }}
    QWidget#card_handle  {{ background-color: {hdl_col}; border-radius: 3px; }}
    QLabel#card_title    {{ color: {card_tit}; font-size: 17px; font-weight: 700; }}
    QLabel#card_cat      {{
        color: {card_cat_col}; font-size: 11px; font-weight: 600;
        background-color: {card_cat_bg}; border-radius: 10px; padding: 3px 10px;
    }}
    QLabel#card_desc     {{ color: {card_desc}; font-size: 14px; }}
    QWidget#card_divider {{ background-color: {card_div}; }}
    QPushButton#nav_btn {{
        background-color: {nav_bg}; color: white; border: none;
        border-radius: 14px; padding: 13px; font-size: 15px; font-weight: 700;
    }}
    QPushButton#nav_btn:hover {{ background-color: {nav_hov}; }}
    QPushButton#close_btn {{
        background-color: {cls_bg}; border: none; color: {cls_col};
        border-radius: 18px; font-size: 16px;
        min-width: 36px; max-width: 36px; min-height: 36px; max-height: 36px;
    }}
    QPushButton#close_btn:hover {{ background-color: {cls_hov}; }}

    QWidget#results_panel {{
        background-color: {res_bg}; border-radius: 14px; border: 1px solid {res_bord};
    }}
    QPushButton#result_btn {{
        background: transparent; border: none; color: {res_col};
        font-size: 14px; padding: 10px 16px; text-align: left; border-radius: 8px;
    }}
    QPushButton#result_btn:hover {{ background-color: {res_hov}; }}
    """

# ─── ROUTE WORKER ─────────────────────────────────────────────────────────────
class RouteWorker(QThread):
    finished_route = Signal(list)  # lista de [lat, lon]

    def __init__(self, start, end, locais, parent=None):
        super().__init__(parent)
        self._start = start
        self._end = end
        self._locais = locais

    def run(self):
        try:
            rota = calcular_rota(self._start, self._end, self._locais)
        except Exception as e:
            print(f"[ROTA] Erro: {e}")
            rota = None
        self.finished_route.emit(rota or [])

# ─── JANELA PRINCIPAL ─────────────────────────────────────────────────────────
class InfoMapWindow(QWidget):
    def __init__(self, locais, map_path):
        super().__init__()
        self.locais         = locais
        self._campus_poly, _ = carregar_campus()
        self._dark          = False
        self._map_loaded    = False
        self._card_open     = False
        self._panel_open    = False
        self._current_local = None

        self._drag_offset = None

        self.setObjectName("root")
        self.setWindowTitle("InfoMap")
        self.setFixedSize(WIN_W, WIN_H)
        self.setWindowFlags(Qt.WindowType.FramelessWindowHint)

        self._build_map(map_path)
        self._build_header()
        self._build_search()
        self._build_dim()
        self._build_panel()
        self._build_card()
        self._build_results()
        self._setup_anims()

        # Garante que overlays começam ocultos e fora da área visível
        self.bottom_card.hide()
        self.slide_panel.hide()
        self.dim.hide()

        cfg = carregar_config()
        self._apply_theme(bool(cfg.get("dark", False)))
        self._reposition()

    # ── CONSTRUÇÃO ───────────────────────────────────────────────────────────

    def _build_map(self, map_path):
        self._page = InfoMapPage(self)
        self._page.marker_clicked.connect(self._on_marker_click)
        self._page.map_clicked.connect(self._on_manual_position)
        self._page.grafo_node_add.connect(self._on_grafo_add_node)
        self._page.grafo_edge_add.connect(self._on_grafo_add_edge)
        self._page.grafo_node_del.connect(self._on_grafo_del_node)
        self._edit_mode = False
        self._route_worker = None
        self.map_view = QWebEngineView(self)
        self.map_view.setPage(self._page)
        url = _start_local_server(map_path)
        self.map_view.setUrl(QUrl(url))
        self.map_view.loadFinished.connect(self._on_map_loaded)

    def _build_header(self):
        self.header = QWidget(self)
        self.header.setObjectName("header")
        lay = QHBoxLayout(self.header)
        lay.setContentsMargins(10, 0, 10, 0)
        lay.setSpacing(0)

        self.btn_menu = self._hdr_btn()
        self.btn_menu.clicked.connect(self._toggle_panel)

        self.lbl_title = QLabel("InfoMap", self.header)
        self.lbl_title.setObjectName("title")
        self.lbl_title.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self.btn_theme = self._hdr_btn()
        self.btn_theme.clicked.connect(self._toggle_theme)

        self.btn_minimize = self._hdr_btn()
        self.btn_minimize.setProperty("role", "minimize")
        self.btn_minimize.clicked.connect(self.showMinimized)

        self.btn_close = self._hdr_btn()
        self.btn_close.setProperty("role", "close")
        self.btn_close.clicked.connect(self.close)

        lay.addWidget(self.btn_menu)
        lay.addWidget(self.lbl_title, 1)
        lay.addWidget(self.btn_theme)
        lay.addWidget(self.btn_minimize)
        lay.addWidget(self.btn_close)

    def _hdr_btn(self):
        b = QPushButton("", self.header)
        b.setObjectName("hdr_btn")
        b.setIconSize(QSize(18, 18))
        b.setCursor(Qt.CursorShape.PointingHandCursor)
        return b

    def _build_search(self):
        self.search_bar = QWidget(self)
        self.search_bar.setObjectName("search_bar")
        outer = QHBoxLayout(self.search_bar)
        outer.setContentsMargins(14, 10, 14, 10)

        self.search_pill = QWidget(self.search_bar)
        self.search_pill.setObjectName("search_pill")
        inner = QHBoxLayout(self.search_pill)
        inner.setContentsMargins(16, 5, 5, 5)
        inner.setSpacing(8)

        self.search_input = QLineEdit(self.search_pill)
        self.search_input.setObjectName("search_input")
        self.search_input.setPlaceholderText("Buscar local no campus...")
        self.search_input.textChanged.connect(self._on_search_changed)
        self.search_input.editingFinished.connect(
            lambda: QTimer.singleShot(180, self.results_panel.hide)
        )

        btn = QPushButton("", self.search_pill)
        btn.setObjectName("search_btn")
        btn.setIcon(qta.icon("mdi6.magnify", color="white"))
        btn.setIconSize(QSize(18, 18))
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.clicked.connect(self._on_search_submit)
        self._search_btn = btn

        inner.addWidget(self.search_input, 1)
        inner.addWidget(btn)
        outer.addWidget(self.search_pill)

    def _build_dim(self):
        self.dim = DimOverlay(self)
        self.dim.clicked.connect(self._close_panel)

    def _build_panel(self):
        self.slide_panel = QWidget(self)
        self.slide_panel.setObjectName("slide_panel")

        sh = QGraphicsDropShadowEffect()
        sh.setBlurRadius(28); sh.setColor(QColor(0,0,0,90)); sh.setOffset(5, 0)
        self.slide_panel.setGraphicsEffect(sh)

        lay = QVBoxLayout(self.slide_panel)
        lay.setContentsMargins(24, 18, 24, 24)
        lay.setSpacing(0)

        # ── Topo: botão fechar no canto direito ──
        top = QHBoxLayout()
        top.addStretch()
        close = QPushButton("", self.slide_panel)
        close.setObjectName("close_btn")
        close.setIconSize(QSize(16, 16))
        close.setCursor(Qt.CursorShape.PointingHandCursor)
        close.clicked.connect(self._close_panel)
        self._panel_close_btn = close
        top.addWidget(close)
        lay.addLayout(top)
        lay.addSpacing(6)

        # ── Título ──
        title = QLabel("InfoMap", self.slide_panel)
        title.setObjectName("panel_title")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay.addWidget(title)

        subtitle = QLabel("Mapa interativo do campus", self.slide_panel)
        subtitle.setObjectName("panel_subtitle")
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay.addWidget(subtitle)
        lay.addSpacing(22)

        # ── Seção AÇÕES ──
        lay.addWidget(self._section_header("AÇÕES"))
        lay.addSpacing(10)

        def panel_btn(txt, slot):
            b = QPushButton("   " + txt, self.slide_panel)
            b.setObjectName("panel_btn")
            b.setIconSize(QSize(18, 18))
            b.setCursor(Qt.CursorShape.PointingHandCursor)
            b.setFixedHeight(42)
            b.clicked.connect(slot)
            lay.addWidget(b)
            lay.addSpacing(8)
            return b

        self._btn_home_panel    = panel_btn("Visão Geral",        self._reset_view)
        self._btn_locate_panel  = panel_btn("Minha Localização",  self._locate_user)
        self._btn_clear_route   = panel_btn("Limpar Rota",        self._clear_route)
        self._btn_filters_panel = panel_btn("Restaurar filtros",  self._reset_filters)
        self._btn_edit_grafo    = panel_btn("Editar Grafo",       self._toggle_editor)

        lay.addSpacing(14)

        # ── Seção CATEGORIAS (filtros + legenda consolidados) ──
        lay.addWidget(self._section_header("CATEGORIAS"))
        lay.addSpacing(10)

        self._chips: list[tuple[QPushButton, str]] = []
        self._cat_colors: list[tuple[QPushButton, str | None]] = []
        for label, value, cor in CATEGORIAS:
            btn = QPushButton("  " + label, self.slide_panel)
            btn.setObjectName("cat_btn")
            btn.setCheckable(True)
            btn.setChecked(value == "Tudo")
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.setFixedHeight(38)
            btn.setIconSize(QSize(12, 12))
            btn.clicked.connect(lambda _, v=value: self._on_filter(v))

            self._chips.append((btn, value))
            self._cat_colors.append((btn, cor))
            lay.addWidget(btn)
            lay.addSpacing(4)

        lay.addStretch(1)

    def _section_header(self, text: str) -> QLabel:
        lbl = QLabel(text, self.slide_panel)
        lbl.setObjectName("section_header")
        return lbl

    def _build_card(self):
        self.bottom_card = QWidget(self)
        self.bottom_card.setObjectName("bottom_card")

        sh = QGraphicsDropShadowEffect()
        sh.setBlurRadius(36); sh.setColor(QColor(0,0,0,75)); sh.setOffset(0, -6)
        self.bottom_card.setGraphicsEffect(sh)

        outer = QVBoxLayout(self.bottom_card)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        # Handle bar
        hw = QWidget(self.bottom_card)
        hwl = QHBoxLayout(hw); hwl.setContentsMargins(0, 12, 0, 6)
        handle = QWidget(hw)
        handle.setObjectName("card_handle"); handle.setFixedSize(44, 5)
        hwl.addWidget(handle, 0, Qt.AlignmentFlag.AlignCenter)
        outer.addWidget(hw)

        # Body
        body = QWidget(self.bottom_card)
        bl = QVBoxLayout(body); bl.setContentsMargins(20, 4, 20, 20); bl.setSpacing(10)

        # Header row
        hrow = QHBoxLayout(); hrow.setSpacing(14)

        self._icon_frame = QWidget(body)
        self._icon_frame.setFixedSize(54, 54)
        ifl = QVBoxLayout(self._icon_frame); ifl.setContentsMargins(0,0,0,0)
        self._icon_lbl = QLabel(self._icon_frame)
        self._icon_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._icon_lbl.setPixmap(qta.icon("mdi6.map-marker", color="white").pixmap(28, 28))
        ifl.addWidget(self._icon_lbl)

        info_col = QVBoxLayout(); info_col.setSpacing(5)
        self._card_title = QLabel("", body); self._card_title.setObjectName("card_title")
        self._card_title.setWordWrap(True)
        self._card_cat   = QLabel("", body); self._card_cat.setObjectName("card_cat")
        info_col.addWidget(self._card_title)
        info_col.addWidget(self._card_cat, 0, Qt.AlignmentFlag.AlignLeft)

        close_card = QPushButton("", body)
        close_card.setObjectName("close_btn")
        close_card.setIconSize(QSize(16, 16))
        close_card.setCursor(Qt.CursorShape.PointingHandCursor)
        close_card.clicked.connect(self._close_card)
        self._card_close_btn = close_card

        hrow.addWidget(self._icon_frame)
        hrow.addLayout(info_col, 1)
        hrow.addWidget(close_card)
        bl.addLayout(hrow)

        div = QWidget(body); div.setObjectName("card_divider"); div.setFixedHeight(1)
        bl.addWidget(div)

        self._card_desc = QLabel("", body)
        self._card_desc.setObjectName("card_desc"); self._card_desc.setWordWrap(True)
        bl.addWidget(self._card_desc)

        self._nav_btn = QPushButton("   Ir para este local", body)
        self._nav_btn.setObjectName("nav_btn")
        self._nav_btn.setIcon(qta.icon("mdi6.navigation-variant", color="white"))
        self._nav_btn.setIconSize(QSize(18, 18))
        self._nav_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._nav_btn.clicked.connect(self._on_nav)
        bl.addWidget(self._nav_btn)

        outer.addWidget(body)

    def _build_results(self):
        self.results_panel = QWidget(self)
        self.results_panel.setObjectName("results_panel")
        self.results_panel.hide()

        sh = QGraphicsDropShadowEffect()
        sh.setBlurRadius(18); sh.setColor(QColor(0,0,0,55)); sh.setOffset(0, 4)
        self.results_panel.setGraphicsEffect(sh)

        self.results_lay = QVBoxLayout(self.results_panel)
        self.results_lay.setContentsMargins(6, 6, 6, 6)
        self.results_lay.setSpacing(2)

    def _setup_anims(self):
        self._anim_card = QPropertyAnimation(self.bottom_card, b"geometry")
        self._anim_card.setDuration(ANIM_MS)
        self._anim_card.setEasingCurve(QEasingCurve.Type.OutCubic)
        self._anim_card.finished.connect(self._on_card_anim_done)

        self._anim_panel = QPropertyAnimation(self.slide_panel, b"geometry")
        self._anim_panel.setDuration(ANIM_MS)
        self._anim_panel.setEasingCurve(QEasingCurve.Type.OutQuart)
        self._anim_panel.finished.connect(self._on_panel_anim_done)

    # ── LAYOUT ───────────────────────────────────────────────────────────────

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self._reposition()

    def _reposition(self):
        w, h = self.width(), self.height()
        map_top = HEADER_H + SEARCH_H

        self.header.setGeometry(0, 0, w, HEADER_H)
        self.search_bar.setGeometry(0, HEADER_H, w, SEARCH_H)
        self.map_view.setGeometry(0, map_top, w, h - map_top)
        self.dim.setGeometry(0, 0, w, h)

        if not self._card_open:
            self.bottom_card.setGeometry(0, h, w, CARD_H)
        if not self._panel_open:
            self.slide_panel.setGeometry(-PANEL_W, 0, PANEL_W, h)

        res_h = min(260, h - map_top - 16)
        self.results_panel.setGeometry(12, HEADER_H + SEARCH_H - 2, w - 24, res_h)

    # ── MAPA ─────────────────────────────────────────────────────────────────

    def _on_map_loaded(self, ok):
        if ok:
            self._map_loaded = True
            if self._dark:
                self.map_view.page().runJavaScript("aplicarTema(true);")

    def _run_js(self, code):
        if self._map_loaded:
            self.map_view.page().runJavaScript(code)

    def _reset_view(self):
        self._run_js("resetarMapa();")
        self._close_panel()

    def _locate_user(self):
        # Se já existe posição salva, mostra ela imediatamente
        cfg = carregar_config()
        pos = cfg.get("last_pos")
        if pos:
            self._run_js(f"mostrarUsuario({pos[0]}, {pos[1]}, 0);")

        # Tenta GPS via Qt Positioning
        if _POSITIONING_OK:
            if not hasattr(self, "_geo_source") or self._geo_source is None:
                self._geo_source = QGeoPositionInfoSource.createDefaultSource(self)
                if self._geo_source is not None:
                    self._geo_source.positionUpdated.connect(self._on_position)
                    self._geo_source.errorOccurred.connect(self._on_position_error)
                    self._geo_source.setUpdateInterval(2000)
            if self._geo_source is not None:
                self._geo_source.requestUpdate(8000)
                self._close_panel()
                return

        # Fallback: modo manual
        self._enable_manual_mode()

    def _enable_manual_mode(self):
        print("[GPS] GPS indisponível — clique no mapa para definir sua posição")
        self._run_js("ativarModoManual(true);")
        self._close_panel()

    def _on_position(self, info):
        coord = info.coordinate()
        lat, lon = coord.latitude(), coord.longitude()
        attr = QGeoPositionInfo.Attribute.HorizontalAccuracy
        acc = info.attribute(attr) if info.hasAttribute(attr) else 0
        self._run_js(f"mostrarUsuario({lat}, {lon}, {acc or 0});")
        cfg = carregar_config()
        cfg["last_pos"] = [lat, lon]
        salvar_config(cfg)

    def _on_position_error(self, _err):
        self._enable_manual_mode()

    # ── EDITOR DE GRAFO ──────────────────────────────────────────────────────

    def _toggle_editor(self):
        self._edit_mode = not self._edit_mode
        if self._edit_mode:
            self._push_grafo()
        self._run_js(f"ativarEditor({'true' if self._edit_mode else 'false'});")
        if self._edit_mode:
            print("[GRAFO] Modo edição ATIVO. Clique no mapa = adicionar nó. "
                  "Clique em 2 nós = aresta. Shift+clique em nó = deletar.")
        else:
            print("[GRAFO] Modo edição desativado.")
        self._close_panel()

    def _push_grafo(self):
        grafo = carregar_grafo()
        out = {"nodes": grafo["nodes"], "edges": grafo["edges"]}
        self._run_js(f"renderizarGrafo({json.dumps(out)});")

    def _on_grafo_add_node(self, lat, lon):
        if self._campus_poly and not ponto_dentro(lat, lon, self._campus_poly):
            print("[GRAFO] Nó rejeitado: fora do polígono do campus.")
            return
        grafo = carregar_grafo()
        nid = f"n{grafo['_next_id']}"
        grafo["nodes"][nid] = [lat, lon]
        salvar_grafo(grafo)
        self._push_grafo()

    def _on_grafo_add_edge(self, a, b):
        if a == b:
            return
        grafo = carregar_grafo()
        if a not in grafo["nodes"] or b not in grafo["nodes"]:
            return
        for ea, eb in grafo["edges"]:
            if {ea, eb} == {a, b}:
                return
        grafo["edges"].append([a, b])
        salvar_grafo(grafo)
        self._push_grafo()

    def _on_grafo_del_node(self, nid):
        grafo = carregar_grafo()
        if nid in grafo["nodes"]:
            del grafo["nodes"][nid]
            grafo["edges"] = [e for e in grafo["edges"] if nid not in e]
            salvar_grafo(grafo)
            self._push_grafo()

    def _clear_route(self):
        self._run_js("limparRota();")
        self._close_panel()

    def _on_manual_position(self, lat, lon):
        if self._campus_poly and not ponto_dentro(lat, lon, self._campus_poly):
            print("[GPS] Aviso: posição clicada está fora do campus.")
        self._run_js(f"mostrarUsuario({lat}, {lon}, 0);")
        self._run_js("ativarModoManual(false);")
        cfg = carregar_config()
        cfg["last_pos"] = [lat, lon]
        salvar_config(cfg)

    def _reset_filters(self):
        for chip, value in self._chips:
            chip.setChecked(value == "Tudo")
        self._run_js("filtrarCat('Tudo');")
        # Refaz os resultados da busca sem filtro de categoria
        if self.search_input.text().strip():
            self._on_search_changed(self.search_input.text())

    def _on_marker_click(self, nome):
        local = next((l for l in self.locais if l["nome"] == nome), None)
        if local:
            self._open_card(local)

    # ── CARD ─────────────────────────────────────────────────────────────────

    def _open_card(self, local):
        self._current_local = local
        hex_cor = COR_HEX.get(local.get("cor", "green"), "#5cb85c")
        self._icon_frame.setStyleSheet(f"background-color:{hex_cor}; border-radius:16px;")
        mdi_name = MDI_ICONE.get(local.get("icone", ""), "mdi6.map-marker")
        self._icon_lbl.setPixmap(qta.icon(mdi_name, color="white").pixmap(28, 28))
        self._card_title.setText(local.get("nome", ""))
        self._card_cat.setText(local.get("cat", ""))
        self._card_desc.setText(local.get("desc", ""))

        w, h = self.width(), self.height()
        self._anim_card.stop()
        self.bottom_card.setGeometry(0, h, w, CARD_H)
        self.bottom_card.raise_()
        self.bottom_card.show()
        self._anim_card.setStartValue(QRect(0, h, w, CARD_H))
        self._anim_card.setEndValue(QRect(0, h - CARD_H, w, CARD_H))
        self._anim_card.start()
        self._card_open = True

    def _close_card(self):
        if not self._card_open:
            return
        w, h = self.width(), self.height()
        self._anim_card.stop()
        self._anim_card.setStartValue(self.bottom_card.geometry())
        self._anim_card.setEndValue(QRect(0, h, w, CARD_H))
        self._anim_card.start()
        self._card_open = False

    def _on_card_anim_done(self):
        if not self._card_open:
            self.bottom_card.hide()

    def _on_nav(self):
        if not self._current_local:
            return
        dest = self._current_local["coords"]
        cfg = carregar_config()
        user_pos = cfg.get("last_pos")
        if not user_pos:
            # Sem posição do aluno: apenas voa até o destino
            self._run_js(f"flyToLocal({dest[0]},{dest[1]});")
            self._close_card()
            return
        # Calcula rota assíncrono (não trava UI durante chamada OSRM)
        if self._route_worker and self._route_worker.isRunning():
            return
        self._route_worker = RouteWorker(tuple(user_pos), tuple(dest), self.locais, self)
        self._route_worker.finished_route.connect(self._on_route_ready)
        self._route_worker.start()
        self._close_card()

    def _on_route_ready(self, rota):
        if not rota or len(rota) < 2:
            return
        coords_js = json.dumps(rota)
        self._run_js(f"desenharRota({coords_js});")
        dist = comprimento_rota(rota)
        eta_min = max(1, round(dist / 1.4 / 60))
        print(f"[ROTA] {len(rota)} pontos, {dist:.0f}m, ~{eta_min}min a pé")

    # ── PAINEL LATERAL ───────────────────────────────────────────────────────

    def _toggle_panel(self):
        if self._panel_open:
            self._close_panel()
        else:
            self._open_panel()

    def _open_panel(self):
        h = self.height()
        self._anim_panel.stop()
        self.slide_panel.setGeometry(-PANEL_W, 0, PANEL_W, h)
        self.dim.raise_()
        self.dim.show()
        self.slide_panel.raise_()
        self.slide_panel.show()
        self._anim_panel.setStartValue(QRect(-PANEL_W, 0, PANEL_W, h))
        self._anim_panel.setEndValue(QRect(0, 0, PANEL_W, h))
        self._anim_panel.start()
        self._panel_open = True

    def _close_panel(self):
        if not self._panel_open:
            return
        h = self.height()
        self._anim_panel.stop()
        self._anim_panel.setStartValue(self.slide_panel.geometry())
        self._anim_panel.setEndValue(QRect(-PANEL_W, 0, PANEL_W, h))
        self._anim_panel.start()
        self._panel_open = False

    def _on_panel_anim_done(self):
        if not self._panel_open:
            self.slide_panel.hide()
            self.dim.hide()

    # ── ARRASTAR JANELA ──────────────────────────────────────────────────────

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_offset = event.position().toPoint()
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if self._drag_offset is not None and event.buttons() == Qt.MouseButton.LeftButton:
            self.move(self.pos() + event.position().toPoint() - self._drag_offset)
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        self._drag_offset = None
        super().mouseReleaseEvent(event)

    # ── FILTRO ───────────────────────────────────────────────────────────────

    def _on_filter(self, cat):
        for chip, value in self._chips:
            chip.setChecked(value == cat)
        self._run_js(f"filtrarCat('{cat}');")
        # Refaz a lista de resultados aplicando o novo filtro
        self._on_search_changed(self.search_input.text())

    # ── BUSCA ────────────────────────────────────────────────────────────────

    def _on_search_changed(self, text):
        while self.results_lay.count():
            item = self.results_lay.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        resultados = buscar_locais(text, self.locais)
        # Aplica também o filtro de categoria ativo (selecionado no menu)
        cat_ativa = next((v for _c, v in self._chips if _c.isChecked()), "Tudo")
        if cat_ativa != "Tudo":
            resultados = [l for l in resultados if l.get("cat") == cat_ativa]

        if not resultados:
            self.results_panel.hide()
            return

        for local in resultados[:6]:
            btn = QPushButton(local["nome"], self.results_panel)
            btn.setObjectName("result_btn")
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.clicked.connect(lambda _, l=local: self._select_result(l))
            self.results_lay.addWidget(btn)

        self.results_panel.raise_()
        self.results_panel.show()

    def _on_search_submit(self):
        resultados = buscar_locais(self.search_input.text(), self.locais)
        if resultados:
            self._select_result(resultados[0])

    def _select_result(self, local):
        self.search_input.setText(local["nome"])
        self.results_panel.hide()
        lat, lon = local["coords"]
        self._run_js(f"flyToLocal({lat},{lon});")
        self._open_card(local)

    # ── TEMA ─────────────────────────────────────────────────────────────────

    def _toggle_theme(self):
        self._apply_theme(not self._dark)
        salvar_config({"dark": self._dark})
        if self._panel_open:
            self._close_panel()

    def _apply_theme(self, dark: bool):
        self._dark = dark
        self.setStyleSheet(_qss(dark))
        self._refresh_icons(dark)
        if self._map_loaded:
            js = "aplicarTema(true);" if dark else "aplicarTema(false);"
            self.map_view.page().runJavaScript(js)

    def _refresh_icons(self, dark: bool):
        # Cores dos ícones de acordo com o tema
        hdr_c    = "#a5d6a7" if dark else "white"
        panel_c  = "#cdd6f4" if dark else "#333333"
        cls_c    = "#cdd6f4" if dark else "#666666"

        self.btn_menu.setIcon(qta.icon("mdi6.menu", color=hdr_c))
        self.btn_theme.setIcon(qta.icon(
            "mdi6.white-balance-sunny" if dark else "mdi6.weather-night",
            color=hdr_c,
        ))
        self.btn_minimize.setIcon(qta.icon("mdi6.window-minimize", color=hdr_c))
        self.btn_close.setIcon(qta.icon("mdi6.close", color=hdr_c))

        self._btn_home_panel.setIcon(qta.icon("mdi6.home-outline", color=panel_c))
        self._btn_locate_panel.setIcon(qta.icon("mdi6.crosshairs-gps", color=panel_c))
        self._btn_clear_route.setIcon(qta.icon("mdi6.map-marker-path", color=panel_c))
        self._btn_filters_panel.setIcon(qta.icon("mdi6.filter-remove-outline", color=panel_c))
        self._btn_edit_grafo.setIcon(qta.icon("mdi6.vector-polyline-edit", color=panel_c))

        # Ícones coloridos de cada categoria (bolinha ou anel)
        ring_c = "#9e9e9e" if not dark else "#6c7086"
        for btn, cor in self._cat_colors:
            if cor is None:
                btn.setIcon(qta.icon("mdi6.circle-outline", color=ring_c))
            else:
                btn.setIcon(qta.icon("mdi6.circle", color=cor))

        self._panel_close_btn.setIcon(qta.icon("mdi6.close", color=cls_c))
        self._card_close_btn.setIcon(qta.icon("mdi6.close", color=cls_c))

# ─── MAIN ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import traceback

    try:
        app = QApplication(sys.argv)
        app.setApplicationName("InfoMap")

        locais   = carregar_dados()
        map_path = gerar_mapa(locais)

        win = InfoMapWindow(locais, map_path)
        win.show()
        sys.exit(app.exec())

    except Exception:
        traceback.print_exc()
        input("\nErro ao iniciar. Pressione Enter para sair...")
