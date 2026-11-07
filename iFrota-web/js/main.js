// Entry point — orquestra dados, mapa, máscara, marcadores e UI shell.
import { carregarLocaisBrutos, prepararLocais, carregarCampusPoly, carregarOverpass, carregarEventos, separarEventosDeSala } from "./data.js";
import { remotoAtivo, dadosSalvos, buscarDadosRemotos, carregarBuild } from "./remoto.js";
import { MODO_DEMO } from "./modo.js";
import { criarMapa, carregarEstilo, adicionar3DBuildings } from "./map.js";
import { aplicarMascaraCampus } from "./campus.js";
import { adicionarMarcadores, limparMarcadores, limparSelecao, restaurarMarcadores } from "./markers.js";
import { initUI } from "./ui.js";
import { store } from "./store.js";
import { initLocation, iniciarGPS, setManualMode, isManualMode, setPosicao } from "./location.js";
import { initRouting, calcularRota, limparRota, reAddRouteLayers, atualizarTracking } from "./routing.js";
import { eventosAtivosAgora, eventosProximosDias, proximaOcorrencia, proximaOcorrenciaData, indexarPorLocal, eventoParaLocal, setRelogioOverride, agoraReal, sincronizarHoraWeb, eventoAtivoNoContainer, salasDoContainer, eventoAtivoAgora } from "./eventos.js";
import { pontoEmPoligono } from "./geo.js";
import { esc } from "./texto.js";
import { somRota, somNotificacao } from "./sons.js";
import { mesclarLocais, mesclarEventos, mesclarCardapios } from "./admin-store.js";
// Backend de fotos é LOCAL (js/fotos-store.js, usado pela ui.js). Firebase está
// dormente — ver docs/IMPLEMENTACAO-FUTURA-FIREBASE.md.

// Navegação: raio de chegada ao destino e precisão mínima do GPS para que uma
// leitura conte no tracking (ETA ao vivo, off-route, chegada).
const CHEGADA_M = 15;
const PRECISAO_MAX_M = 35;

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

  const [locaisArquivo, campusPoly, overpassFeats, eventosArquivo, build, estilo] = await Promise.all([
    carregarLocaisBrutos(),
    carregarCampusPoly(),
    carregarOverpass(),
    carregarEventos({ demo: MODO_DEMO }),
    carregarBuild(),
    carregarEstilo(dark),
  ]);
  // Conteúdo remoto (APK): começa pela última cópia baixada do repositório, se
  // houver; a busca da versão atual roda depois que o mapa abre. A demonstração
  // usa sempre os arquivos locais.
  const usarRemoto = remotoAtivo() && !MODO_DEMO;
  const fonte = (usarRemoto && dadosSalvos(build?.gerado)) || { locais: locaisArquivo, eventos: eventosArquivo };
  // Assinatura do conteúdo em uso — calculada ANTES de separarEventosDeSala,
  // que pendura os eventos nas salas (muta os objetos).
  let assinaturaDados = JSON.stringify([fonte.locais, fonte.eventos]);
  // Eventos de sala são anexados às salas dos prédios/blocos (uma vez, nos
  // objetos base); os demais seguem como eventos de topo.
  const baseLocais = prepararLocais(fonte.locais);
  const baseEventos = separarEventosDeSala(baseLocais, fonte.eventos);
  if (MODO_DEMO) console.log("[IFrota] modo demonstração — eventos de exemplo carregados");

  // `locais` é o array de TRABALHO (referência estável p/ initUI). montarDados()
  // o reconstrói no lugar mesclando base (json) + custom (admin) e aplicando as
  // flags de evento. Roda no load e nos refresh após o admin mexer nos dados.
  const locais = [];
  function montarDados() {
    const merged = mesclarLocais(baseLocais);     // base + pontos do admin
    const eventos = mesclarEventos(baseEventos);  // base ativos + eventos do admin

    locais.length = 0;
    merged.forEach((l) => locais.push({ ...l, isEvento: false, evento: undefined }));
    mesclarCardapios(locais);   // sobrepõe cardápios atualizados pelo admin

    // isEvento (estrela dourada) segue a JANELA DE HORÁRIO: o waypoint só se
    // "transforma" enquanto o evento está ativo AGORA. Fora da janela mantém o
    // ícone padrão, mas guarda `evento` p/ a agenda aparecer no card.
    const eventosAgora = eventosAtivosAgora(eventos);
    const eventosProximos = eventosProximosDias(eventos);   // horizonte 31d (pega mensais)
    const agoraSet = new Set(eventosAgora);
    const evPorLocal = indexarPorLocal(eventosProximos);
    for (const l of locais) {
      const ev = evPorLocal.get(l.nome);
      if (ev) { l.evento = ev; if (agoraSet.has(ev)) l.isEvento = true; }
      // Prédio/bloco: marcador dourado se alguma sala/andar tem evento ativo agora.
      if ((l.andares || l.salas) && eventoAtivoNoContainer(l)) l.isEvento = true;
    }
    // Pontos temporários (sem waypoint fixo) só existem no mapa durante a janela.
    eventosAgora.filter((ev) => !ev.local).forEach((ev) => {
      const tl = eventoParaLocal(ev); tl._temp = true; locais.push(tl);
    });

    const eventosSidebar = eventosProximos.map((ev) => {
      ev._quando = proximaOcorrencia(ev);
      let local;
      if (ev.local) local = locais.find((l) => l.nome === ev.local);
      else local = locais.find((l) => l.isEvento && l.nome === ev.nome) || eventoParaLocal(ev);
      return local ? { ev, local } : null;
    }).filter(Boolean);

    // Eventos de SALA (prédios/blocos) também na sidebar, com o caminho da sala.
    for (const l of locais) {
      const grupos = l.andares
        ? l.andares.map((a, ai) => [ai, a.salas || []])
        : (l.salas ? [[null, l.salas]] : []);
      for (const [ai, salas] of grupos) {
        salas.forEach((s, si) => {
          if (s.evento && eventosProximosDias([s.evento]).length) {
            s.evento._quando = proximaOcorrencia(s.evento);
            s.evento._sala = s.nome;
            eventosSidebar.push({ ev: s.evento, local: l, salaPath: ai != null ? [ai, si] : [si] });
          }
        });
      }
    }
    // ordena a sidebar pela data da próxima ocorrência (mais próxima primeiro)
    eventosSidebar.sort((a, b) => {
      const da = proximaOcorrenciaData(a.ev), db = proximaOcorrenciaData(b.ev);
      return (da ? da.getTime() : Infinity) - (db ? db.getTime() : Infinity);
    });

    return { eventosSidebar, eventosProximos };
  }
  let dados = montarDados();

  const map = criarMapa({ dark, style: estilo });
  window._ifrotaMap = map;

  // Destino da navegação ativa (null quando não há rota). Usado pelo tracking
  // pra atualizar ETA ao vivo e recalcular no off-route.
  let navLocal = null;

  // A localização do usuário só "vale" dentro da área delimitada do campus.
  // Fora dela NÃO movemos a câmera (evita zoom no canto/fora da zona) nem criamos
  // rota — os destinos são sempre pontos do campus.
  function noCampus(lat, lon) { return pontoEmPoligono(lat, lon, campusPoly); }

  // Re-aplica camadas de estilo (máscara + prédios) — usado no load e na troca de tema.
  function aplicarCamadas(isDark) {
    aplicarMascaraCampus(map, campusPoly, { dark: isDark });
    adicionar3DBuildings(map, isDark);
  }

  function encerrarNav() {
    navLocal = null;
    ui.hideRouteBanner();
    limparRota();
    restaurarMarcadores();
    limparSelecao();
    if (dadosPendentes) { dadosPendentes = false; refresh(); }
  }

  // UI shell
  const ui = initUI({
    locais,
    baseEventos,
    callbacks: {
      onNav: (local) => {
        const pos = store.getLastPos();
        if (!pos) { ui.showToast("Defina sua posição primeiro"); return; }
        if (!noCampus(pos[0], pos[1])) {
          ui.showToast("Sua localização está fora do campus — rota indisponível");
          return;
        }
        ui.closeCard();
        // Pathfinding A* sobre a rede viária — desenha rota real (sólido) vs
        // atalhos virtuais (tracejado laranja) e anima até o destino.
        navLocal = local;
        const r = calcularRota(pos[0], pos[1], local);
        ui.showRouteBanner(local, r.dist, r.eta);
        somRota();   // som sutil ao criar a rota
      },
      onSelectResult: (local) => {
        map.flyTo({ center: [local.coords[1], local.coords[0]], zoom: 18, duration: 1000 });
      },
      onLocate: () => {
        const pos = store.getLastPos();
        // Só centraliza no último ponto se ele estiver DENTRO do campus.
        if (pos && noCampus(pos[0], pos[1])) {
          map.flyTo({ center: [pos[1], pos[0]], zoom: 18, duration: 1000 });
        }
        // Pede GPS em paralelo — atualiza o marcador quando chegar a leitura
        iniciarGPS({
          onError: () => {
            if (!pos) ui.showToast("GPS indisponível — use 'Definir Posição'");
          },
        }).then(([lat, lon]) => {
          // Fora do campus: mantém a câmera no campus (não dá zoom no canto/longe).
          if (noCampus(lat, lon)) {
            map.flyTo({ center: [lon, lat], zoom: 18, duration: 1000 });
          } else {
            ui.showToast("Você está fora do campus");
          }
        }).catch(() => {});
      },
      onSetPos: () => {
        setManualMode(true);
        ui.showToast("Toque no mapa para definir sua posição");
      },
      onClearRoute: () => encerrarNav(),
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
        // diff:false = troca completa, como era com URL (o "idle" abaixo
        // re-adiciona máscara, prédios 3D e rota por cima do estilo novo).
        carregarEstilo(isDark).then((st) => {
          map.setStyle(st, { diff: false });
          map.once("idle", reapply);
        });
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

  // Busca o conteúdo publicado no repositório (só APK / ?remoto=1). Se mudou,
  // troca os dados base no lugar (as referências passadas à UI continuam válidas)
  // e refaz o mapa — ou espera a rota ativa terminar para não bagunçá-la.
  let dadosPendentes = false;
  let ultimaBusca = 0;
  function atualizarDoRemoto() {
    if (!usarRemoto) return;
    ultimaBusca = Date.now();
    buscarDadosRemotos().then((novo) => {
      if (!novo) return;
      const ass = JSON.stringify([novo.locais, novo.eventos]);
      if (ass === assinaturaDados) return;
      assinaturaDados = ass;
      baseLocais.splice(0, baseLocais.length, ...prepararLocais(novo.locais));
      baseEventos.splice(0, baseEventos.length, ...separarEventosDeSala(baseLocais, novo.eventos));
      console.log("[IFrota] conteúdo atualizado a partir do repositório");
      if (navLocal) { dadosPendentes = true; return; }
      refresh();
      ui.showToast("Conteúdo do campus atualizado");
    });
  }
  // App que volta do segundo plano (minimizado pelo botão voltar) também busca,
  // no máximo a cada 30 min.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - ultimaBusca > 30 * 60 * 1000) atualizarDoRemoto();
  });

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
  // Helper de debug: simula o "escolher local no mapa" sem clicar no canvas.
  window._ifrotaPick = (lat, lon) => {
    if (!pickCb) return false;
    const c = pickCb; pickCb = null; map.getCanvas().style.cursor = "";
    c([lat, lon]); return true;
  };

  // Botão voltar do Android (APK, plugin @capacitor/app). Sem tratar, ele fecha
  // o app de qualquer tela. Ordem: camada aberta da UI → escolha de ponto no
  // mapa → rota ativa → minimiza (mantém o estado, como os apps de mapa).
  const AppNativo = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.App : null;
  AppNativo?.addListener("backButton", () => {
    if (ui.voltar()) return;
    if (pickCb || isManualMode()) {
      pickCb = null; setManualMode(false);
      map.getCanvas().style.cursor = "";
      ui.showToast("Seleção no mapa cancelada");
      return;
    }
    if (navLocal) { encerrarNav(); ui.showToast("Rota encerrada"); return; }
    AppNativo.minimizeApp();
  });

  if (build) ui.setVersao(build);

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
  // A cada 10s re-avalia os eventos ATIVOS AGORA (topo + salas). Quando o conjunto
  // muda, refaz marcadores/sidebar; avisa (toast) só quando um evento COMEÇA (sem
  // aviso de término, p/ não encher de notificação); e atualiza o card aberto ao vivo.
  function ativosAgoraMap() {
    const m = new Map();   // key → rótulo de exibição
    for (const ev of eventosAtivosAgora(mesclarEventos(baseEventos))) m.set("top:" + ev.nome, ev.nome);
    for (const l of locais) {
      if (l.andares || l.salas) {
        for (const s of salasDoContainer(l)) {
          if (s.evento && eventoAtivoAgora(s.evento)) m.set(`sala:${l.nome}>${s.nome}`, `${s.evento.nome} · ${s.nome}`);
        }
      }
    }
    return m;
  }
  let _ativos = new Set(ativosAgoraMap().keys());
  function tickRelogio() {
    const mapa = ativosAgoraMap();
    const keys = [...mapa.keys()];
    const novos = keys.filter((k) => !_ativos.has(k));
    const mudou = keys.length !== _ativos.size || novos.length > 0;
    // avisa só o INÍCIO (eventos que passaram a acontecer agora)
    if (novos.length === 1) ui.showToast(`▶ ${mapa.get(novos[0])} — acontecendo agora`);
    else if (novos.length > 1) ui.showToast(`▶ ${novos.length} eventos acontecendo agora`);
    if (novos.length) somNotificacao();   // "ding" gentil só quando um evento começa
    _ativos = new Set(keys);
    if (mudou && !navLocal) {
      refresh();
      console.log(`[IFrota] ${agoraReal().toLocaleTimeString("pt-BR")} — eventos ativos mudaram`);
    }
    ui.atualizarCardAoVivo?.();   // card aberto em tempo real (sem mexer na galeria)
  }
  setInterval(tickRelogio, 10000);

  // Aplica a hora da web: como o "agora" pode dar um salto grande, reavalia os
  // eventos imediatamente após sincronizar.
  function aplicarSyncHora(off) {
    if (off == null) return;   // offline: seguimos com o último offset conhecido
    console.log(`[IFrota] hora da web sincronizada — offset ${(off / 1000).toFixed(0)}s · agora=${agoraReal().toLocaleString("pt-BR")}`);
    if (!navLocal) refresh();
    _ativos = new Set(ativosAgoraMap().keys());
    ui.atualizarCardAoVivo?.();
  }
  horaSync.then(aplicarSyncHora).catch(() => {});
  setInterval(() => { sincronizarHoraWeb().then(aplicarSyncHora).catch(() => {}); }, 5 * 60 * 1000);

  map.on("load", () => {
    aplicarCamadas(dark);
    adicionarMarcadores(map, locais, { onClick: (local) => ui.openCard(local) });
    initLocation(map, {
      noCampus,   // só aceita posição manual dentro da área delimitada
      onForaCampus: () => ui.showToast("Esse ponto está fora do campus — escolha um local dentro da área"),
      onUpdate: (latlon, precisao) => {
        if (!navLocal) return;   // só rastreia durante uma rota ativa
        // Leitura imprecisa (GPS frio, dentro de prédio) não decide nada: só
        // move o marcador. Sem isso ela gera "saiu da rota" falso e reroute.
        if (precisao > PRECISAO_MAX_M) return;
        const t = atualizarTracking(latlon[0], latlon[1]);
        if (!t) return;
        if (t.remaining <= CHEGADA_M) {
          ui.showToast(`✓ Você chegou: ${navLocal.nome}`, 3000);
          somNotificacao();
          encerrarNav();
          return;
        }
        if (t.reroute) {
          // Saiu da área do campus → não recalcula (origem precisa estar no campus).
          if (!noCampus(latlon[0], latlon[1])) {
            ui.showToast("Você saiu da área do campus");
            return;
          }
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

    // Lista lateral de eventos (horizonte 31 dias) — entre FAVORITOS e CATEGORIAS.
    ui.setEventosSidebar(dados.eventosSidebar);

    // Popup de startup: só os eventos ATIVOS HOJE (separado da lista lateral).
    const eventosHojeLocais = locais.filter((l) => l.isEvento);
    if (eventosHojeLocais.length) {
      setTimeout(() => ui.mostrarEventos(eventosHojeLocais), 900);  // após o mapa assentar
    }

    console.log(`[IFrota] mapa pronto — ${locais.length} waypoints carregados`);
    atualizarDoRemoto();
  });
}

// Falha ao abrir: tela legível com "Tentar de novo" (e não um JSON cru). O caso
// mais comum em celular é o WebGL indisponível — Android System WebView antigo.
bootstrap().catch((e) => {
  console.error("[IFrota] erro no bootstrap:", e);
  const detalhe = String(e?.message || e);
  const semWebGL = /webgl/i.test(detalhe);
  const msg = semWebGL
    ? "Este aparelho não conseguiu iniciar o mapa (WebGL indisponível). No Android, atualize o app “Android System WebView” na Play Store e abra o IF-rota de novo."
    : "Não foi possível carregar o IF-rota. Verifique o armazenamento do aparelho e tente de novo.";
  document.body.innerHTML =
    `<div style="max-width:420px;margin:15vh auto 0;padding:24px;font-family:system-ui,sans-serif;text-align:center;color:#333;">` +
      `<div style="font-size:40px;">🗺️</div>` +
      `<p style="font-size:16px;line-height:1.5;">${esc(msg)}</p>` +
      `<button onclick="location.reload()" style="margin-top:12px;padding:12px 22px;border:0;border-radius:10px;background:#2e7d32;color:#fff;font-size:15px;">Tentar de novo</button>` +
      `<details style="margin-top:28px;font-size:11px;color:#888;text-align:left;"><summary>Detalhes técnicos</summary><pre style="white-space:pre-wrap;">${esc(detalhe)}</pre></details>` +
    `</div>`;
  document.body.style.background = "#fafafa";
});
