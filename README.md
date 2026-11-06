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

Para rodar os testes (pathfinding + dados, Node puro, sem browser): `npm test`.

> ⚠️ **Não abra direto o `index.html`** (`file://...`) — módulos ES não funcionam via file://. Precisa de um servidor HTTP.

## Testes automáticos

O workflow [`.github/workflows/testes.yml`](.github/workflows/testes.yml) roda `npm test`
a cada push na `main` que altere o app. Ele só testa: o APK é gerado à mão
([docs/BUILD-APK.md](docs/BUILD-APK.md)).

## Conteúdo atualizado sem reinstalar o APK

O APK traz os dados embutidos. Ao abrir (e ao voltar do segundo plano, no máximo a
cada 30 min), ele também baixa `locais.json` e `eventos.json` direto do repositório
(`DADOS_REMOTOS` em `js/config.js`, via raw.githubusercontent.com). Assim, eventos e
cardápio novos chegam aos estudantes com um simples push em `data/`.

- **Sem internet:** o app usa a última cópia baixada. Se não houver, usa a que veio
  no APK. Uma cópia mais antiga que o próprio APK é descartada (`build.json`).
- **Arquivo quebrado no repositório:** é ignorado (o `npm test` também confere isso).
- **Durante uma rota:** a atualização espera a rota terminar.
- **No navegador (dev):** fica desligada, para não sobrescrever as edições locais.
  `?remoto=1` liga para teste.
- O GitHub guarda os arquivos em cache por até ~5 min depois do push.
- **Requisito:** o repositório precisa ser público. Para desligar a busca, use
  `DADOS_REMOTOS = null`.

## Modos de uso

| Modo | Como ativar | O que muda |
|---|---|---|
| Público (padrão) | — | Mapa, busca, rotas, eventos e cardápio publicados. Sem área de conta/gestão. |
| Admin | No APK: 7 toques no título "IF-rota" (de novo para desligar). No navegador: `?admin=1` (fica salvo; `?admin=0` desliga). | Mostra a seção **Conta** com login e as ferramentas de gestão. |
| Demonstração | `?demo=1` na URL | Carrega `data/eventos.demo.json` (eventos de exemplo, sem datas-limite) no lugar dos reais — para apresentações. |

> A conta admin padrão é criada localmente em cada aparelho (ver `js/fotos-store.js`).
> O modo admin só **esconde** a gestão do público: o login é local e não protege nada
> no servidor — o que protege o conteúdo publicado é o acesso de escrita ao repositório.

## Atualizar o conteúdo (eventos, cardápio, pontos)

O que o admin cria no app fica **só no aparelho dele** até ser publicado. A rotina:

1. No app (modo admin): crie/edite eventos, cardápio da semana ou pontos e use
   **Exportar dados (JSON)** — baixa `ifrota-dados.json`.
2. No computador, dentro de `iFrota-web/`:
   ```powershell
   npm run aplicar-export -- caminho\ifrota-dados.json --previa   # confere o que muda
   npm run aplicar-export -- caminho\ifrota-dados.json            # grava em data/
   ```
3. Commit + push dos arquivos de `data/`. Os APKs instalados baixam a versão nova na
   próxima abertura do app (ver acima).
4. No aparelho do admin, **Limpar dados criados localmente** (senão os itens aparecem
   duplicados: a cópia local e a publicada).

Eventos também podem ser escritos à mão em `data/eventos.json` (mesmo formato do
`eventos.demo.json`). Um evento com `"local"` + `"sala"` vale para uma sala de um
prédio/bloco. Cardápio vencido não é exibido: o card mostra "ainda não foi publicado"
com os horários das refeições até a semana nova chegar.

> Fotos enviadas pelo app ficam no IndexedDB do aparelho e **não** entram no export.
> Para publicar uma foto, coloque o arquivo em `iFrota-web/fotos/` e referencie-o no
> campo `fotos` do local em `data/locais.json`.

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
├── tests/               # Testes em Node puro: pathfinding + dados (npm test)
├── tools/               # aplicar-export (edições do admin → data/) + preparar-android
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
│   ├── modo.js          # Modos público / admin / demonstração
│   ├── remoto.js        # Busca o conteúdo publicado no repositório (APK)
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
│   ├── ui.js            # Controlador da UI shell (card, galeria, busca, painel)
│   ├── ui-admin.js      # Editores do admin (pontos, eventos, prédios, cardápio)
│   └── main.js          # Orquestrador (bootstrap + callbacks)
└── data/
    ├── locais.json      # Waypoints (copiado de ../iFrota-desktop/locais.json)
    ├── eventos.json     # Eventos publicados (recorrência + janelas de horário)
    ├── eventos.demo.json # Eventos de exemplo (só com ?demo=1)
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
