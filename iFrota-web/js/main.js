// Entry point — orquestra dados, mapa, máscara, marcadores e UI shell.
import { carregarLocais, carregarCampusPoly, carregarOverpass, carregarEventos } from "./data.js";
import { criarMapa, adicionar3DBuildings } from "./map.js";
import { aplicarMascaraCampus } from "./campus.js";
import { adicionarMarcadores, limparMarcadores, limparSelecao, restaurarMarcadores } from "./markers.js";
import { STYLE_LIGHT_URL, STYLE_DARK_URL } from "./config.js";
import { initUI } from "./ui.js";
import { store } from "./store.js";
import { initLocation, iniciarGPS, setManualMode, setPosicao } from "./location.js";
import { initRouting, calcularRota, limparRota, reAddRouteLayers, atualizarTracking } from "./routing.js";
import { eventosAtivosAgora, eventosProximos7Dias, proximaOcorrencia, indexarPorLocal, eventoParaLocal, setRelogioOverride, agoraReal, sincronizarHoraWeb } from "./eventos.js";
import { mesclarLocais, mesclarEventos } from "./admin-store.js";
// Backend de fotos é LOCAL (js/fotos-store.js, usado pela ui.js). Firebase está
// dormente — ver docs/IMPLEMENTACAO-FUTURA-FIREBASE.md.

async function bootstrap() {
  // ?dark=1/0 força o tema (debug); senão usa o persistido.
  const params = new URLSearchParams(location.search);
  const dark = params.has("dark")
    ? params.get("dark") === "1"
    : store.getDark();

  // Debug: ?dia=qua&hora=19:30 força dia/hora p/ testar a aparição/término do
  // ícone de evento sem esperar o horário real do sistema.
  if (params.has("dia") || params.has("hora")) {
    const DOWk = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
    const diaIdx = params.has("dia") ? DOWk.indexOf(params.get("dia")) : -1;
    const hm = params.has("hora") ? /^(\d{1,2}):(\d{2})$/.exec(params.get("hora")) : null;
    setRelogioOverride({
      dia: diaIdx >= 0 ? diaIdx : null,
      hora: hm ? (+hm[1]) * 60 + (+hm[2]) : null,
    });
  }

  // Sincroniza com a hora da web o quanto antes (em paralelo ao carregamento dos
  // dados). O resultado é aplicado mais abaixo, quando refresh() já existe.
  const horaSync = sincronizarHoraWeb();

  const [baseLocais, campusPoly, overpassFeats, baseEventos] = await Promise.all([
    carregarLocais(),
    carregarCampusPoly(),
    carregarOverpass(),
    carregarEventos(),
  ]);

  // `locais` é o array de TRABALHO (referência estável p/ initUI). montarDados()
  // o reconstrói no lugar mesclando base (json) + custom (admin) e aplicando as
  // flags de evento. Roda no load e nos refresh após o admin mexer nos dados.
  const locais = [];
  function montarDados() {
    const merged = mesclarLocais(baseLocais);     // base + pontos do admin
    const eventos = mesclarEventos(baseEventos);  // base ativos + eventos do admin

    locais.length = 0;
    merged.forEach((l) => locais.push({ ...l, isEvento: false, evento: undefined }));

    // isEvento (estrela dourada) segue a JANELA DE HORÁRIO: o waypoint só se
    // "transforma" enquanto o evento está ativo AGORA. Fora da janela mantém o
    // ícone padrão, mas guarda `evento` p/ a agenda aparecer no card.
    const eventosAgora = eventosAtivosAgora(eventos);
    const eventos7d = eventosProximos7Dias(eventos);
    const agoraSet = new Set(eventosAgora);
    const evPorLocal = indexarPorLocal(eventos7d);
    for (const l of locais) {
      const ev = evPorLocal.get(l.nome);
      if (ev) { l.evento = ev; if (agoraSet.has(ev)) l.isEvento = true; }
    }
    // Pontos temporários (sem waypoint fixo) só existem no mapa durante a janela.
    eventosAgora.filter((ev) => !ev.local).forEach((ev) => {
      const tl = eventoParaLocal(ev); tl._temp = true; locais.push(tl);
    });

    const eventosSidebar = eventos7d.map((ev) => {
      ev._quando = proximaOcorrencia(ev);
      let local;
      if (ev.local) local = locais.find((l) => l.nome === ev.local);
      else local = locais.find((l) => l.isEvento && l.nome === ev.nome) || eventoParaLocal(ev);
      return local ? { ev, local } : null;
    }).filter(Boolean);

    return { eventosSidebar, eventos7d };
  }
  let dados = montarDados();

  const map = criarMapa({ dark });
  window._ifrotaMap = map;

  // Destino da navegação ativa (null quando não há rota). Usado pelo tracking
  // pra atualizar ETA ao vivo e recalcular no off-route.
  let navLocal = null;

  // Re-aplica camadas de estilo (máscara + prédios) — usado no load e na troca de tema.
  function aplicarCamadas(isDark) {
    aplicarMascaraCampus(map, campusPoly, { dark: isDark });
    adicionar3DBuildings(map, isDark);
  }

  // UI shell
  const ui = initUI({
    locais,
    baseEventos,
    callbacks: {
      onNav: (local) => {
        const pos = store.getLastPos();
        if (!pos) { ui.showToast("Defina sua posição primeiro"); return; }
        ui.closeCard();
        // Pathfinding A* sobre a rede viária — desenha rota real (sólido) vs
        // atalhos virtuais (tracejado laranja) e anima até o destino.
        navLocal = local;
        const r = calcularRota(pos[0], pos[1], local);
        ui.showRouteBanner(local, r.dist, r.eta);
      },
      onSelectResult: (local) => {
        map.flyTo({ center: [local.coords[1], local.coords[0]], zoom: 18, duration: 1000 });
      },
      onLocate: () => {
        const pos = store.getLastPos();
        if (pos) map.flyTo({ center: [pos[1], pos[0]], zoom: 18, duration: 1000 });
        // Pede GPS em paralelo — atualiza o marcador quando chegar a leitura
        iniciarGPS({
          onError: () => {
            if (!pos) ui.showToast("GPS indisponível — use 'Definir Posição'");
          },
        }).then(([lat, lon]) => {
          map.flyTo({ center: [lon, lat], zoom: 18, duration: 1000 });
        }).catch(() => {});
      },
      onSetPos: () => {
        setManualMode(true);
        ui.showToast("Toque no mapa para definir sua posição");
      },
      onClearRoute: () => {
        navLocal = null;
        ui.hideRouteBanner();
        limparRota();
        restaurarMarcadores();
        limparSelecao();
      },
      // Admin: pedir um ponto no mapa (cria waypoint) e refazer marcadores/dados.
      onPedirLocalMapa: (callback) => pedirLocalNoMapa(callback),
      onAdminChange: () => refresh(),
      onThemeChange: (isDark) => {
        // setStyle apaga TODAS as layers (máscara, contorno, prédios, rota).
        // Re-aplicar via polling de isStyleLoaded() é uma armadilha: logo após
        // setStyle ele ainda retorna true (estilo antigo) e re-adicionaríamos
        // cedo demais — aí o novo estilo carrega e apaga tudo. O evento "idle"
        // dispara só depois do novo estilo renderizar, então é confiável.
        let aplicado = false;
        const reapply = () => {
          if (aplicado) return;
          aplicado = true;
          aplicarCamadas(isDark);
          reAddRouteLayers();
        };
        map.setStyle(isDark ? STYLE_DARK_URL : STYLE_LIGHT_URL);
        map.once("idle", reapply);
      },
    },
  });

  // Refaz dados (base + custom) + marcadores + lista de eventos. Chamado quando o
  // admin cria/remove pontos ou eventos.
  function refresh() {
    dados = montarDados();
    limparMarcadores();
    adicionarMarcadores(map, locais, { onClick: (local) => ui.openCard(local) });
    ui.setEventosSidebar(dados.eventosSidebar);
  }

  // Modo "escolher ponto no mapa" (criação de waypoint pelo admin).
  let pickCb = null;
  function pedirLocalNoMapa(callback) {
    pickCb = callback;
    map.getCanvas().style.cursor = "crosshair";
    ui.showToast("Toque no mapa para escolher o local");
  }
  map.on("click", (e) => {
    if (!pickCb) return;
    const cb2 = pickCb; pickCb = null;
    map.getCanvas().style.cursor = "";
    cb2([e.lngLat.lat, e.lngLat.lng]);
  });

  window._ifrotaUI = ui;       // debug/testes
  window._ifrotaLocais = locais;
  // Helper de debug: define posição e calcula rota real até um destino por nome.
  window._ifrotaTestNav = (nomePart) => {
    const l = locais.find((x) => x.nome.includes(nomePart));
    if (!l) return;
    navLocal = l;
    ui.closeCard();
    const r = calcularRota(store.getLastPos()[0], store.getLastPos()[1], l);
    ui.showRouteBanner(l, r.dist, r.eta);
    return r;
  };
  // Helper de debug: simula uma leitura de GPS (dispara tracking/reroute).
  window._ifrotaSetPos = (lat, lon) => setPosicao(lat, lon);
  // Helper de debug: refaz dados + marcadores (usado nos testes admin).
  window._ifrotaRefresh = () => refresh();

  // ── Relógio do sistema ────────────────────────────────────────────────────────
  // A cada 20s re-avalia quais eventos estão ATIVOS AGORA. Quando o conjunto muda
  // (passou da hora de início ou de término), refaz os marcadores → o ícone de
  // evento aparece/some sozinho. Não interrompe uma navegação em andamento.
  function chaveAtivosAgora() {
    return eventosAtivosAgora(mesclarEventos(baseEventos))
      .map((e) => e.nome).sort().join("|");
  }
  let _ultimaChaveEventos = chaveAtivosAgora();
  setInterval(() => {
    if (navLocal) return;              // não mexe nos marcadores durante a rota
    const k = chaveAtivosAgora();
    if (k === _ultimaChaveEventos) return;
    _ultimaChaveEventos = k;
    refresh();
    console.log(`[IFrota] ${agoraReal().toLocaleTimeString("pt-BR")} — eventos ativos mudaram, marcadores atualizados`);
  }, 10000);

  // Aplica a hora da web: como o "agora" pode dar um salto grande, reavalia os
  // eventos imediatamente após sincronizar.
  function aplicarSyncHora(off) {
    if (off == null) return;   // offline: seguimos com o último offset conhecido
    console.log(`[IFrota] hora da web sincronizada — offset ${(off / 1000).toFixed(0)}s · agora=${agoraReal().toLocaleString("pt-BR")}`);
    if (!navLocal) refresh();
    _ultimaChaveEventos = chaveAtivosAgora();
  }
  horaSync.then(aplicarSyncHora).catch(() => {});
  setInterval(() => { sincronizarHoraWeb().then(aplicarSyncHora).catch(() => {}); }, 5 * 60 * 1000);

  map.on("load", () => {
    aplicarCamadas(dark);
    adicionarMarcadores(map, locais, { onClick: (local) => ui.openCard(local) });
    initLocation(map, {
      onUpdate: (latlon) => {
        if (!navLocal) return;   // só rastreia durante uma rota ativa
        const t = atualizarTracking(latlon[0], latlon[1]);
        if (!t) return;
        if (t.reroute) {
          // Usuário saiu da rota por leituras consecutivas → recalcula (sem reanimar).
          ui.showToast("⟳ Recalculando rota...");
          const r = calcularRota(latlon[0], latlon[1], navLocal, { animate: false });
          ui.showRouteBanner(navLocal, r.dist, r.eta);
        } else {
          // ETA ao vivo: distância restante diminui conforme o usuário avança.
          ui.showRouteBanner(navLocal, t.remaining, t.eta);
        }
      },
    });
    initRouting(map, campusPoly, overpassFeats);

    // Lista lateral de eventos (próximos 7 dias) — entre FAVORITOS e CATEGORIAS.
    ui.setEventosSidebar(dados.eventosSidebar);

    // Popup de startup: só os eventos ATIVOS HOJE (separado da lista lateral).
    const eventosHojeLocais = locais.filter((l) => l.isEvento);
    if (eventosHojeLocais.length) {
      setTimeout(() => ui.mostrarEventos(eventosHojeLocais), 900);  // após o mapa assentar
    }

    console.log(`[IFrota] mapa pronto — ${locais.length} waypoints carregados`);
  });
}

bootstrap().catch((e) => {
  console.error("[IFrota] erro no bootstrap:", e);
  document.body.innerHTML =
    `<pre style="padding:20px;color:#d9534f;">Erro ao carregar IFrota:\n${e.message}</pre>`;
});
