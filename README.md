# IFrota Web — versão PWA + Android APK

Reescrita web do IFrota (originalmente PySide6 desktop) com o objetivo final de empacotar como APK Android via TWA (Trusted Web Activity).

## Estrutura do repositório

| Pasta | O quê |
|---|---|
| [`iFrota-desktop/`](iFrota-desktop/) | Versão original desktop (PySide6). Rode de dentro da pasta: `cd iFrota-desktop` e então `python IFrota.py`. |
| [`iFrota-web/`](iFrota-web/) | Reescrita web/PWA empacotável como APK — **o restante deste README detalha esta parte**. |
| [`docs/`](docs/) | Documentação: build do APK, Firebase, pathfinding, changelog do Overpass. |

## Estado atual: Sprint 6 ✅ — APK funcional com pathfinding

APK Android (`IFrota-debug.apk`, ~5 MB) com **navegação A\*** sobre a rede viária do
campus (rota real sólida vs atalhos virtuais tracejados), GPS nativo, posição manual,
tema claro/escuro, Service Worker offline e UI completa. Reescrita web do IFrota desktop
(PySide6) empacotada via Capacitor — assets bundled, sem dependência de Python em runtime.

Build e empacotamento documentados em [docs/BUILD-APK.md](docs/BUILD-APK.md). Os demais documentos do projeto estão em [`docs/`](docs/).

### Helper de screenshot (`_shot.py`)

Renderiza a página via QtWebEngine (mesma engine do TWA) e salva PNG:

```powershell
# Servidor precisa estar rodando (python -m http.server 8000)
python _shot.py "http://localhost:8000/index.html" saida.png 8000
# 4º arg opcional: JS executado ~1s antes do grab (ex: abrir card)
python _shot.py "http://localhost:8000/index.html" card.png 8000 "window._ifrotaUI.openCard(window._ifrotaLocais[3]);"
```

## Como rodar localmente

```powershell
cd iFrota-web
python -m http.server 8000
```

Abra http://localhost:8000 no Chrome/Edge.

Para rodar o teste de fumaça do pathfinding (Node puro, sem browser): `npm test`.

> ⚠️ **Não abra direto o `index.html`** (`file://...`) — módulos ES não funcionam via file://. Precisa de um servidor HTTP.

## Estrutura

```
iFrota-web/
├── index.html           # Entry point + DOM da UI shell + registro do SW
├── manifest.json        # Manifesto PWA (nome, ícones, theme, display)
├── sw.js                # Service Worker (cache offline: shell + dados + tiles com cap)
├── build-www.mjs        # Monta www/ (webDir do Capacitor) só com os assets do app
├── capacitor.config.json # Config do empacotamento Android (Capacitor)
├── _shot.py             # Helper de screenshot via QtWebEngine
├── _gen_icons.py        # Gera os ícones PWA (PIL)
├── tests/               # Testes de fumaça em Node puro (npm test)
├── icons/               # icon-192/512 (+maskable) + favicon
├── fotos/               # Fotos da galeria referenciadas no data/locais.json
├── vendor/              # maplibre-gl + fontawesome (bundled, sem CDN em runtime)
├── css/
│   ├── reset.css        # Reset base + tipografia
│   ├── theme.css        # Variáveis CSS claro/escuro (paleta do desktop)
│   ├── map.css          # Marcadores + controles do MapLibre
│   └── ui.css           # Header, search, panel, bottom sheet, banner, toast
├── js/
│   ├── config.js        # Constantes (bounds, cores, paths)
│   ├── data.js          # Carrega JSONs (locais, campus, overpass, eventos)
│   ├── geo.js           # Haversine + ponto-em-polígono + formatação de distância
│   ├── store.js         # Persistência leve (tema, favoritos, última posição)
│   ├── admin-store.js   # Edições do admin (pontos/eventos/cardápios) em localStorage
│   ├── fotos-store.js   # Backend LOCAL de fotos (auth simulada + IndexedDB)
│   ├── firebase.js      # Integração Firebase — dormente (ver docs/)
│   ├── firebase-config.js # Credenciais do Firebase (placeholders)
│   ├── map.js           # Cria mapa + 3D buildings
│   ├── campus.js        # Máscara invertida + contorno suavizado
│   ├── markers.js       # Waypoints + seleção + filtro + isolamento
│   ├── location.js      # GPS (watchPosition / plugin nativo) + posição manual
│   ├── routing.js       # Rede viária + A* + bridges + desenho rota real/virtual
│   ├── eventos.js       # Recorrência, janelas de horário e relógio (hora da web)
│   ├── sons.js          # Feedback sonoro sutil (Web Audio, sem arquivos)
│   ├── ui.js            # Controlador da UI shell (card, galeria, busca, admin)
│   └── main.js          # Orquestrador (bootstrap + callbacks)
└── data/
    ├── locais.json      # Waypoints (copiado de ../iFrota-desktop/locais.json)
    ├── eventos.json     # Eventos-base (recorrência + janelas de horário)
    ├── campus.geojson   # (copiado de ../iFrota-desktop/campus.geojson)
    ├── overpass-cache.json  # (copiado de ../iFrota-desktop/.cache/overpass_campus.json)
    └── style-dark.json  # Estilo MapLibre escuro inline
```

## Sprints

| # | Escopo | Status |
|---|---|---|
| 1 | Setup + extração do core JS (mapa funciona em browser) | ✅ |
| 2 | UI shell em HTML/CSS (header, search, bottom sheet, side panel) | ✅ |
| 3 | Geolocalização (`navigator.geolocation`) + Service Worker + manifest PWA | ✅ |
| 4 | Build APK via Capacitor (assets bundled, offline) | ✅ |
| 5 | GPS nativo (`@capacitor/geolocation`) + splash + permissões | ✅ |
| 6 | Pathfinding A* (rede viária + bridges + rota real/virtual) | ✅ |
| 7 | Teste em device real + off-route/reroute + polish | ⏳ |

> **Nota sobre persistência:** config/favoritos/posição e as edições do admin ficam em
> `localStorage`; as fotos enviadas pelo admin usam IndexedDB (`fotos-store.js`); o
> Service Worker cobre o cache offline dos assets+tiles (com cap de entradas). Pré-cache
> maior (ex: tiles de toda a região) fica fora do escopo do TCC.

## Migrações do IFrota.py

Status do que foi portado do `IFrota.py` desktop:

- [x] Pathfinding A* + virtual edges (`routing.js`)
- [x] ETA + banner inferior estilo Waze
- [x] Side panel (filtros + navegação)
- [x] Tema claro/escuro com toggle
- [x] Rota real (sólido) vs virtual/atalho (tracejado laranja)
- [x] Bottom sheet expansível com agenda (dia atual destacado) + galeria + fullscreen
- [x] Favoritos no painel lateral (lista live, clique abre o card)
- [x] Off-route detection + reroute automático + ETA ao vivo
- [ ] Editor de grafo (admin)

> **Fotos da galeria:** coloque os arquivos em `iFrota-web/fotos/` com os nomes
> referenciados no `data/locais.json` (ex: `fotos/biblioteca-1.jpg`). Sem os arquivos,
> a galeria mostra um placeholder 📷 — a estrutura (setas, counter, dots, fullscreen) já
> funciona. Lembre de adicionar `fotos` na lista `ITEMS` do `build-www.mjs` se criar a pasta.

## Decisões arquiteturais

- **Vanilla JS + ES modules**: zero deps, zero build step. Pra TCC e TWA, simplicidade > tooling. Migração pra Vite/TS possível depois sem perder código.
- **Dados estáticos no `data/`**: cópias dos JSONs do desktop. Persistência do usuário/admin é local (localStorage + IndexedDB — ver nota acima); Firebase existe mas está dormente.
- **Estilo escuro inline (`style-dark.json`)**: OpenFreeMap só hospeda 3 estilos claros — pra escuro reusamos as mesmas vector tiles com paint customizado.

## Sincronizar dados do desktop

Quando atualizar `locais.json` ou `campus.geojson` no projeto desktop:

```powershell
cp ..\iFrota-desktop\locais.json .\data\locais.json
cp ..\iFrota-desktop\campus.geojson .\data\campus.geojson
cp ..\iFrota-desktop\.cache\overpass_campus.json .\data\overpass-cache.json
```

O empacotamento usa `npm run build:www` (`build-www.mjs`), que copia os assets pra `www/`
antes do `cap sync` — mas a cópia desktop→web acima continua manual.
