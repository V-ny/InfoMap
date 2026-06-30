// Controlador da UI shell — header, search, side panel, bottom sheet, toast.
// Recebe callbacks de domínio (onNav, onThemeChange, onLocate, onSetPos...).
import { store } from "./store.js";
import { selecionarMarcador, limparSelecao, filtrarPorCategoria } from "./markers.js";
import { haversine, formatarDistancia } from "./geo.js";
import { HORARIOS_PADRAO, eventoAtivoHoje, eventoAtivoAgora, agoraReal, eventoAtivoNoContainer, formatarJanela } from "./eventos.js";
import { somPonto, sonsAtivos, setSons } from "./sons.js";
// Backend de fotos: LOCAL (IndexedDB + login local). Pra usar o Firebase (nuvem),
// veja docs/IMPLEMENTACAO-FUTURA-FIREBASE.md.
import { fotosAtivo, registrar, login, logout, onAuth, ehAdmin, listarFotos, enviarFoto, removerFoto } from "./fotos-store.js";
import {
  addLocalCustom, getLocaisCustom, removeLocalCustom,
  addEventoCustom, getEventosCustom, removeEventoCustom,
  getDesativados, desativarBase,
  getCardapios, setCardapio,
  exportarDados, importarDados, limparTudoCustom,
} from "./admin-store.js";

// Categorias (espelha CATEGORIAS do IFrota.py) com ícone FA por categoria
const CATEGORIAS = [
  ["Tudo",           null,      "fa-th-large"],
  ["Ensino",         "#428bca", "fa-graduation-cap"],
  ["Administrativo", "#d9534f", "fa-briefcase"],
  ["Agropecuária",   "#5cb85c", "fa-leaf"],
  ["Acessos",        "#8bc34a", "fa-road"],
  ["Convivência",    "#436978", "fa-coffee"],
  ["Esporte",        "#2e7d32", "fa-futbol-o"],
];

const COR_HEX = {
  green: "#5cb85c", lightgreen: "#8bc34a", red: "#d9534f", blue: "#428bca",
  orange: "#f0ad4e", purple: "#9B479F", pink: "#e91e8c", cadetblue: "#436978",
  darkgreen: "#2e7d32", darkred: "#a23336", darkpurple: "#5B396B",
};

const $ = (id) => document.getElementById(id);

export function initUI({ locais, baseEventos = [], callbacks }) {
  const cb = callbacks || {};
  let currentLocal = null;
  let toastTimer = null;
  let catAtiva = "Tudo";
  let isAdmin = false;   // admin logado (Firebase) — libera upload/delete de fotos

  // ── elementos ──
  const dim = $("dim");
  const sidePanel = $("side-panel");
  const card = $("bottom-card");
  const results = $("results-panel");
  const searchInput = $("search-input");

  // ── TEMA ──
  function refreshThemeIcon() {
    const dark = document.body.classList.contains("dark");
    $("btn-theme").innerHTML = dark
      ? '<i class="fa fa-sun-o"></i>'
      : '<i class="fa fa-moon-o"></i>';
  }
  $("btn-theme").onclick = () => {
    const dark = !document.body.classList.contains("dark");
    document.body.classList.toggle("dark", dark);
    store.setDark(dark);
    refreshThemeIcon();
    cb.onThemeChange?.(dark);
  };
  refreshThemeIcon();

  // ── SOM (feedback sonoro sutil — liga/desliga) ──
  function refreshSomIcon() {
    $("btn-som").innerHTML = sonsAtivos()
      ? '<i class="fa fa-volume-up"></i>'
      : '<i class="fa fa-volume-off"></i>';
  }
  $("btn-som").onclick = () => {
    const on = !sonsAtivos();
    setSons(on);
    refreshSomIcon();
    if (on) somPonto();   // confirma e libera o áudio neste gesto
  };
  refreshSomIcon();

  // ── SIDE PANEL ──
  function openPanel() {
    esconderEventos();   // não deixa o popup de eventos sobrepor o painel
    sidePanel.classList.add("open"); dim.classList.add("show");
  }
  function closePanel() { sidePanel.classList.remove("open"); dim.classList.remove("show"); }
  $("btn-menu").onclick = openPanel;
  dim.onclick = () => { closePanel(); closeCard(); };

  $("pb-locate").onclick = () => { closePanel(); cb.onLocate?.(); };
  $("pb-setpos").onclick = () => { closePanel(); cb.onSetPos?.(); };

  // ── CONTA / LOGIN (backend de fotos local — sempre disponível) ──
  const loginModal = $("login-modal");
  let modoCadastro = false;
  if (fotosAtivo()) {
    $("admin-section").style.display = "";
    onAuth((user) => {
      isAdmin = !!user;
      $("pb-login").style.display = user ? "none" : "";
      $("admin-logado").style.display = user ? "" : "none";
      $("admin-email").textContent = user ? (user.email || "") : "";
      $("gal-admin").style.display = user ? "" : "none";
      const admin = ehAdmin();
      $("admin-gestao").style.display = admin ? "" : "none";  // gestão só p/ admin
      const badge = $("admin-badge");
      badge.textContent = admin ? "Administrador" : "Usuário";
      badge.classList.toggle("admin", admin);
      renderGaleria();  // mostra/esconde botão de delete conforme o login
    });
  }
  function setModoCadastro(v) {
    modoCadastro = v;
    $("login-title").textContent = v ? "Criar conta" : "Entrar";
    $("login-submit").textContent = v ? "Cadastrar" : "Entrar";
    $("login-toggle").textContent = v ? "Já tenho conta" : "Criar conta";
    $("login-erro").textContent = "";
  }
  $("pb-login").onclick = () => {
    closePanel();
    $("login-email").value = ""; $("login-senha").value = "";
    setModoCadastro(false);
    loginModal.classList.add("open");
    $("login-email").focus();
  };
  $("login-close").onclick = () => loginModal.classList.remove("open");
  $("login-toggle").onclick = () => setModoCadastro(!modoCadastro);
  loginModal.addEventListener("click", (e) => { if (e.target === loginModal) loginModal.classList.remove("open"); });
  $("pb-logout").onclick = async () => { closePanel(); await logout(); showToast("Sessão encerrada"); };
  async function submitLogin() {
    const email = $("login-email").value.trim();
    const senha = $("login-senha").value;
    if (!email || !senha) { $("login-erro").textContent = "Preencha e-mail e senha."; return; }
    const btn = $("login-submit"); const txt = btn.textContent;
    btn.disabled = true; btn.textContent = "...";
    try {
      if (modoCadastro) { await registrar(email, senha); showToast("✓ Conta criada"); }
      else { await login(email, senha); showToast("✓ Bem-vindo"); }
      loginModal.classList.remove("open");
    } catch (err) {
      $("login-erro").textContent = err.message || "Erro ao entrar.";
    } finally {
      btn.disabled = false; btn.textContent = txt;
    }
  }
  $("login-submit").onclick = submitLogin;
  $("login-senha").addEventListener("keydown", (e) => { if (e.key === "Enter") submitLogin(); });

  // ── GESTÃO ADMIN (criar pontos / eventos, desativar) ──
  const CATS_ADMIN = ["Ensino", "Administrativo", "Agropecuária", "Acessos", "Convivência", "Esporte"];
  const CAT_COR = {
    Ensino: "blue", Administrativo: "red", "Agropecuária": "green",
    Acessos: "lightgreen", "Convivência": "cadetblue", Esporte: "darkgreen",
  };
  // { icone: nome da classe FontAwesome, nome: rótulo em português }
  const ICONES_ADMIN = [
    { icone: "map-marker", nome: "Marcador / Local" },
    { icone: "book", nome: "Livro / Biblioteca" },
    { icone: "graduation-cap", nome: "Formatura / Ensino" },
    { icone: "briefcase", nome: "Maleta / Administração" },
    { icone: "bullhorn", nome: "Megafone / Anúncios" },
    { icone: "paint-brush", nome: "Pincel / Artes" },
    { icone: "cutlery", nome: "Talheres / Restaurante" },
    { icone: "futbol-o", nome: "Bola / Esporte" },
    { icone: "leaf", nome: "Folha / Natureza" },
    { icone: "sun-o", nome: "Sol" },
    { icone: "paw", nome: "Pata / Animais" },
    { icone: "road", nome: "Estrada / Portaria" },
    { icone: "building", nome: "Prédio" },
    { icone: "flask", nome: "Frasco / Laboratório" },
    { icone: "music", nome: "Música" },
    { icone: "coffee", nome: "Café / Convivência" },
    { icone: "heart", nome: "Coração / Saúde" },
    { icone: "star", nome: "Estrela" },
    { icone: "university", nome: "Universidade" },
    { icone: "medkit", nome: "Kit médico / Saúde" },
  ];
  const DIAS_ADMIN = [["seg", "S"], ["ter", "T"], ["qua", "Q"], ["qui", "Q"], ["sex", "S"], ["sab", "S"], ["dom", "D"]];
  const DIAS_NOME = { seg: "Seg", ter: "Ter", qua: "Qua", qui: "Qui", sex: "Sex", sab: "Sáb", dom: "Dom" };
  const GOLD = "linear-gradient(150deg, #ffe27a, #ffc107 45%, #d4a017)";

  function fillSelect(sel, itens, render) {
    sel.innerHTML = "";
    itens.forEach((it) => {
      const o = document.createElement("option");
      const { value, label } = render(it);
      o.value = value; o.textContent = label;
      sel.appendChild(o);
    });
  }
  function openAdmModal(id) { $(id).classList.add("open"); }
  function closeAdmModal(id) { $(id).classList.remove("open"); }
  [["ponto-modal", "ponto-close"], ["evento-modal", "evento-close"], ["gerenciar-modal", "gerenciar-close"], ["predio-modal", "predio-close"], ["cardapio-modal", "cardapio-close"]]
    .forEach(([mid, cid]) => {
      $(cid).onclick = () => closeAdmModal(mid);
      $(mid).addEventListener("click", (e) => { if (e.target === $(mid)) closeAdmModal(mid); });
    });

  // ----- NOVO / EDITAR PONTO -----
  let pontoCoords = null, pontoTipo = "", editandoPonto = null, pontoDisp = "1";
  [...$("ponto-tipo").children].forEach((b) => {
    b.onclick = () => {
      pontoTipo = b.dataset.tipo;
      [...$("ponto-tipo").children].forEach((x) => x.classList.toggle("on", x === b));
    };
  });
  // disponibilidade (interdição / obra)
  function setPontoDisp(disponivel) {
    pontoDisp = disponivel ? "1" : "0";
    [...$("ponto-disp").children].forEach((x) => x.classList.toggle("on", x.dataset.disp === pontoDisp));
    $("ponto-motivo").style.display = pontoDisp === "0" ? "" : "none";
  }
  [...$("ponto-disp").children].forEach((b) => {
    b.onclick = () => setPontoDisp(b.dataset.disp === "1");
  });
  function pontoModalTitulo(t) { $("ponto-modal").querySelector(".adm-title").textContent = t; }
  $("pb-novo-ponto").onclick = () => {
    closePanel();
    pontoCoords = null; pontoTipo = ""; editandoPonto = null;
    [...$("ponto-tipo").children].forEach((x) => x.classList.toggle("on", x.dataset.tipo === ""));
    $("ponto-nome").value = ""; $("ponto-desc").value = "";
    $("ponto-motivo").value = ""; setPontoDisp(true);
    $("ponto-erro").textContent = "";
    $("ponto-loc-info").textContent = "Local: não definido"; $("ponto-loc-info").classList.remove("ok");
    fillSelect($("ponto-cat"), CATS_ADMIN, (c) => ({ value: c, label: c }));
    fillSelect($("ponto-icone"), ICONES_ADMIN, (i) => ({ value: i.icone, label: i.nome }));
    pontoModalTitulo("Novo ponto de interesse");
    openAdmModal("ponto-modal");
  };
  // Edita um ponto simples (preserva agenda/fotos/cardápio que o form não toca).
  function abrirEditorPonto(local) {
    closePanel();
    editandoPonto = local;
    pontoCoords = local.coords || null;
    pontoTipo = local.tipo === "refeitorio" ? "refeitorio" : "";
    [...$("ponto-tipo").children].forEach((x) => x.classList.toggle("on", x.dataset.tipo === pontoTipo));
    $("ponto-nome").value = local.nome || ""; $("ponto-desc").value = local.desc || "";
    $("ponto-motivo").value = local.motivo || ""; setPontoDisp(local.disponivel !== false);
    $("ponto-erro").textContent = "";
    $("ponto-loc-info").textContent = pontoCoords ? `Local: ${pontoCoords[0].toFixed(5)}, ${pontoCoords[1].toFixed(5)}` : "Local: não definido";
    $("ponto-loc-info").classList.toggle("ok", !!pontoCoords);
    fillSelect($("ponto-cat"), CATS_ADMIN, (c) => ({ value: c, label: c }));
    $("ponto-cat").value = local.cat || CATS_ADMIN[0];
    fillSelect($("ponto-icone"), ICONES_ADMIN, (i) => ({ value: i.icone, label: i.nome }));
    $("ponto-icone").value = local.icone || "map-marker";
    pontoModalTitulo("Editar ponto");
    openAdmModal("ponto-modal");
  }
  $("ponto-loc").onclick = () => {
    closeAdmModal("ponto-modal");
    cb.onPedirLocalMapa?.((latlon) => {
      pontoCoords = latlon;
      $("ponto-loc-info").textContent = `Local: ${latlon[0].toFixed(5)}, ${latlon[1].toFixed(5)}`;
      $("ponto-loc-info").classList.add("ok");
      openAdmModal("ponto-modal");
    });
  };
  $("ponto-salvar").onclick = () => {
    const nome = $("ponto-nome").value.trim();
    if (!nome) { $("ponto-erro").textContent = "Informe o nome."; return; }
    if (!pontoCoords) { $("ponto-erro").textContent = "Escolha o local no mapa."; return; }
    const cat = $("ponto-cat").value;
    let novo;
    if (editandoPonto) {
      // preserva campos que o form não edita (agenda, fotos, cardapio, salas...)
      novo = { ...editandoPonto };
      ["isEvento", "evento", "cor_hex", "_temp", "custom"].forEach((k) => delete novo[k]);
      novo.coords = pontoCoords;
    } else {
      novo = { nome, coords: pontoCoords };
    }
    novo.nome = nome; novo.cat = cat; novo.cor = CAT_COR[cat] || "green";
    novo.icone = $("ponto-icone").value; novo.desc = $("ponto-desc").value.trim();
    if (pontoTipo === "refeitorio") novo.tipo = "refeitorio"; else delete novo.tipo;
    // disponibilidade (interdição / obra)
    if (pontoDisp === "0") {
      novo.disponivel = false;
      const m = $("ponto-motivo").value.trim();
      if (m) novo.motivo = m; else delete novo.motivo;
    } else { delete novo.disponivel; delete novo.motivo; }
    // upsert por nome
    removeLocalCustom(nome);
    if (editandoPonto && editandoPonto.nome !== nome) removeLocalCustom(editandoPonto.nome);
    addLocalCustom(novo);
    closeAdmModal("ponto-modal");
    cb.onAdminChange?.();
    showToast(editandoPonto ? "✏️ Atualizado" : (pontoTipo === "refeitorio" ? "🍽️ Refeitório criado" : "📍 Ponto criado"));
  };

  // ----- NOVO EVENTO -----
  let eventoCoords = null;
  function renderDiasChips() {
    const wrap = $("evento-dias"); wrap.innerHTML = "";
    DIAS_ADMIN.forEach(([key, letra]) => {
      const b = document.createElement("button");
      b.className = "adm-dia"; b.dataset.dia = key; b.textContent = letra;
      b.onclick = () => b.classList.toggle("on");
      wrap.appendChild(b);
    });
  }
  function waypointsSelecionaveis() {
    return locais.filter((l) => !l._temp);   // exclui marcadores temporários de evento
  }
  // Atalho dos tempos de aula → preenche os campos de hora livres.
  function preencherAulaSelects() {
    const set = new Set();
    HORARIOS_PADRAO.forEach(({ slots }) => slots.forEach(([a, b]) => { set.add(a); set.add(b); }));
    const horas = [...set].sort();
    const ini = $("evento-aula-ini"), fim = $("evento-aula-fim");
    ini.innerHTML = '<option value="">Início (aula)…</option>';
    fim.innerHTML = '<option value="">Fim (aula)…</option>';
    horas.forEach((h) => { ini.appendChild(new Option(h, h)); fim.appendChild(new Option(h, h)); });
  }
  $("evento-aula-ini").onchange = (e) => { if (e.target.value) $("evento-hora-ini").value = e.target.value; };
  $("evento-aula-fim").onchange = (e) => { if (e.target.value) $("evento-hora-fim").value = e.target.value; };
  // Repetição: Semanal / Mensal / Única — mostra/esconde os campos certos.
  let eventoRep = "semanal";
  function aplicarRepeticaoUI() {
    $("evento-unica-box").style.display = eventoRep === "unica" ? "" : "none";
    $("evento-recorr-box").style.display = eventoRep === "unica" ? "none" : "";
    $("evento-semana-box").style.display = eventoRep === "mensal" ? "" : "none";
  }
  [...$("evento-rep").children].forEach((b) => {
    b.onclick = () => {
      eventoRep = b.dataset.rep;
      [...$("evento-rep").children].forEach((x) => x.classList.toggle("on", x === b));
      aplicarRepeticaoUI();
    };
  });
  $("pb-novo-evento").onclick = () => {
    closePanel();
    eventoCoords = null;
    ["evento-nome", "evento-desc", "evento-inicio", "evento-fim", "evento-atividade",
     "evento-hora-ini", "evento-hora-fim", "evento-data"]
      .forEach((id) => { $(id).value = ""; });
    eventoRep = "semanal";
    [...$("evento-rep").children].forEach((x) => x.classList.toggle("on", x.dataset.rep === "semanal"));
    aplicarRepeticaoUI();
    preencherAulaSelects();
    $("evento-erro").textContent = "";
    $("evento-loc-info").textContent = "Local: não definido"; $("evento-loc-info").classList.remove("ok");
    $("evento-temp").style.display = "none";
    // alvo: waypoints existentes + opção de ponto temporário
    const sel = $("evento-alvo"); sel.innerHTML = "";
    const optVazio = document.createElement("option"); optVazio.value = ""; optVazio.textContent = "— escolher local existente —"; sel.appendChild(optVazio);
    waypointsSelecionaveis().forEach((l) => {
      const o = document.createElement("option"); o.value = l.nome; o.textContent = l.nome; sel.appendChild(o);
    });
    const optNovo = document.createElement("option"); optNovo.value = "__novo__"; optNovo.textContent = "+ Ponto temporário (no mapa)"; sel.appendChild(optNovo);
    fillSelect($("evento-icone"), ICONES_ADMIN, (i) => ({ value: i.icone, label: i.nome }));
    renderDiasChips();
    openAdmModal("evento-modal");
  };
  $("evento-alvo").onchange = () => {
    $("evento-temp").style.display = $("evento-alvo").value === "__novo__" ? "" : "none";
  };
  $("evento-loc").onclick = () => {
    closeAdmModal("evento-modal");
    cb.onPedirLocalMapa?.((latlon) => {
      eventoCoords = latlon;
      $("evento-loc-info").textContent = `Local: ${latlon[0].toFixed(5)}, ${latlon[1].toFixed(5)}`;
      $("evento-loc-info").classList.add("ok");
      openAdmModal("evento-modal");
    });
  };
  $("evento-salvar").onclick = () => {
    const nome = $("evento-nome").value.trim();
    const alvo = $("evento-alvo").value;
    if (!nome) { $("evento-erro").textContent = "Informe o nome do evento."; return; }
    if (!alvo) { $("evento-erro").textContent = "Escolha onde o evento acontece."; return; }
    const ev = { nome, desc: $("evento-desc").value.trim() };
    let dias;
    if (eventoRep === "unica") {
      const data = $("evento-data").value;
      if (!data) { $("evento-erro").textContent = "Escolha a data do evento."; return; }
      ev.repete = "unica"; ev.data = data;
      dias = [["dom", "seg", "ter", "qua", "qui", "sex", "sab"][new Date(data + "T00:00:00").getDay()]];
      ev.dias = dias;   // dia da semana derivado (p/ a agenda/horários)
    } else {
      dias = [...$("evento-dias").querySelectorAll(".adm-dia.on")].map((b) => b.dataset.dia);
      if (!dias.length) { $("evento-erro").textContent = "Selecione ao menos um dia."; return; }
      ev.dias = dias;
      const ini = $("evento-inicio").value, fim = $("evento-fim").value;
      if (ini) ev.inicio = ini;
      if (fim) ev.fim = fim;
      if (eventoRep === "mensal") { ev.repete = "mensal"; ev.semanaMes = $("evento-semana").value; }
    }
    const hIni = $("evento-hora-ini").value, hFim = $("evento-hora-fim").value;
    const atv = $("evento-atividade").value.trim();
    if (hIni && hFim && hFim <= hIni) {
      $("evento-erro").textContent = "O horário de fim deve ser depois do início."; return;
    }
    if (hIni) {
      ev.horaInicio = hIni;             // o ícone aparece nesse horário (livre)…
      if (hFim) ev.horaFim = hFim;      // …e some nesse (senão, fica até o fim do dia)
      ev.atividade = atv || "";         // rótulo usado na marcação da agenda
      ev.horarios = {};
      dias.forEach((d) => { ev.horarios[d] = [[hIni, atv || "Atividade"]]; });
    }
    if (alvo === "__novo__") {
      if (!eventoCoords) { $("evento-erro").textContent = "Escolha o local do ponto temporário."; return; }
      ev.coords = eventoCoords; ev.icone = $("evento-icone").value; ev.cor = "orange"; ev.cat = "Eventos";
    } else {
      ev.local = alvo;
    }
    addEventoCustom(ev);
    closeAdmModal("evento-modal");
    cb.onAdminChange?.();
    showToast("⭐ Evento criado");
  };

  // ----- NOVO / EDITAR PRÉDIO / BLOCO -----
  const TIPOS_SALA = ["Sala", "Laboratório", "Banheiro", "Administração", "Auditório", "Coordenação", "Biblioteca"];
  let predioCoords = null, editandoNome = null, predioDisp = "1";   // editandoNome != null → modo edição
  // Modelo em edição (reconstruído na tela a cada add/remove/toggle).
  let ed = { tipo: "bloco", salas: [], andares: [] };
  function setPredioDisp(disponivel) {
    predioDisp = disponivel ? "1" : "0";
    [...$("predio-disp").children].forEach((x) => x.classList.toggle("on", x.dataset.disp === predioDisp));
    $("predio-motivo").style.display = predioDisp === "0" ? "" : "none";
  }
  [...$("predio-disp").children].forEach((b) => {
    b.onclick = () => setPredioDisp(b.dataset.disp === "1");
  });

  function novaSala() { return { nome: "", tipo: "Sala", evento: null, disponivel: true, motivo: "" }; }
  function novoAndar() { return { nome: "", salas: [novaSala()] }; }
  function clonarSalaEd(s) {
    return {
      nome: s.nome || "", tipo: s.tipo || "Sala",
      disponivel: s.disponivel !== false, motivo: s.motivo || "",
      evento: s.evento ? {
        nome: s.evento.nome || s.nome, dias: (s.evento.dias || []).slice(),
        horaInicio: s.evento.horaInicio || "", horaFim: s.evento.horaFim || "", atividade: s.evento.atividade || "",
      } : null,
    };
  }
  function predioModalTitulo(t) { $("predio-modal").querySelector(".adm-title").textContent = t; }

  // Carrega um prédio/bloco existente no editor (edição → sobrepõe por nome ao salvar).
  function abrirEditorPredio(local) {
    closePanel();
    editandoNome = local.nome;
    predioCoords = local.coords || null;
    ed = local.andares
      ? { tipo: "predio", salas: [novaSala()], andares: local.andares.map((a) => ({ nome: a.nome || "", salas: (a.salas || []).map(clonarSalaEd) })) }
      : { tipo: "bloco", salas: (local.salas || []).map(clonarSalaEd), andares: [novoAndar()] };
    $("predio-nome").value = local.nome || ""; $("predio-erro").textContent = "";
    $("predio-motivo").value = local.motivo || ""; setPredioDisp(local.disponivel !== false);
    $("predio-loc-info").textContent = predioCoords ? `Local: ${predioCoords[0].toFixed(5)}, ${predioCoords[1].toFixed(5)}` : "Local: não definido";
    $("predio-loc-info").classList.toggle("ok", !!predioCoords);
    fillSelect($("predio-cat"), CATS_ADMIN, (c) => ({ value: c, label: c }));
    $("predio-cat").value = local.cat || CATS_ADMIN[0];
    fillSelect($("predio-icone"), ICONES_ADMIN, (i) => ({ value: i.icone, label: i.nome }));
    $("predio-icone").value = local.icone || "building";
    [...$("predio-tipo").children].forEach((b) => b.classList.toggle("on", b.dataset.tipo === ed.tipo));
    renderEditorPredio();
    predioModalTitulo("Editar prédio / bloco");
    openAdmModal("predio-modal");
  }

  $("pb-novo-predio").onclick = () => {
    closePanel();
    predioCoords = null; editandoNome = null;
    ed = { tipo: "bloco", salas: [novaSala()], andares: [novoAndar()] };
    $("predio-nome").value = ""; $("predio-erro").textContent = "";
    $("predio-motivo").value = ""; setPredioDisp(true);
    $("predio-loc-info").textContent = "Local: não definido"; $("predio-loc-info").classList.remove("ok");
    fillSelect($("predio-cat"), CATS_ADMIN, (c) => ({ value: c, label: c }));
    fillSelect($("predio-icone"), ICONES_ADMIN, (i) => ({ value: i.icone, label: i.nome }));
    $("predio-icone").value = "building";
    [...$("predio-tipo").children].forEach((b) => b.classList.toggle("on", b.dataset.tipo === ed.tipo));
    renderEditorPredio();
    predioModalTitulo("Novo prédio / bloco");
    openAdmModal("predio-modal");
  };
  [...$("predio-tipo").children].forEach((b) => {
    b.onclick = () => {
      ed.tipo = b.dataset.tipo;
      [...$("predio-tipo").children].forEach((x) => x.classList.toggle("on", x === b));
      renderEditorPredio();
    };
  });
  $("predio-loc").onclick = () => {
    closeAdmModal("predio-modal");
    cb.onPedirLocalMapa?.((latlon) => {
      predioCoords = latlon;
      $("predio-loc-info").textContent = `Local: ${latlon[0].toFixed(5)}, ${latlon[1].toFixed(5)}`;
      $("predio-loc-info").classList.add("ok");
      openAdmModal("predio-modal");
    });
  };

  // Sub-bloco de configuração de evento de uma sala (dias + horário + atividade).
  function editorEventoSala(sala) {
    const box = document.createElement("div");
    box.className = "ed-evento";
    const tem = !!sala.evento;
    const head = document.createElement("label");
    head.className = "ed-ev-toggle";
    head.innerHTML = `<input type="checkbox" ${tem ? "checked" : ""}> <i class="fa fa-star"></i> Evento nesta sala`;
    head.querySelector("input").onchange = (e) => {
      sala.evento = e.target.checked
        ? { nome: sala.nome || "Evento", dias: [], horaInicio: "", horaFim: "", atividade: "" }
        : null;
      renderEditorPredio();
    };
    box.appendChild(head);
    if (tem) {
      const dias = document.createElement("div");
      dias.className = "adm-dias";
      DIAS_ADMIN.forEach(([key, letra]) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "adm-dia" + (sala.evento.dias.includes(key) ? " on" : "");
        b.textContent = letra;
        b.onclick = () => {
          const i = sala.evento.dias.indexOf(key);
          if (i >= 0) sala.evento.dias.splice(i, 1); else sala.evento.dias.push(key);
          b.classList.toggle("on");
        };
        dias.appendChild(b);
      });
      box.appendChild(dias);
      const row = document.createElement("div");
      row.className = "adm-row";
      row.innerHTML =
        `<input class="login-input ed-ini" type="time" title="Início" value="${sala.evento.horaInicio || ""}">` +
        `<input class="login-input ed-fim" type="time" title="Fim" value="${sala.evento.horaFim || ""}">`;
      row.querySelector(".ed-ini").oninput = (e) => { sala.evento.horaInicio = e.target.value; };
      row.querySelector(".ed-fim").oninput = (e) => { sala.evento.horaFim = e.target.value; };
      box.appendChild(row);
      const atv = document.createElement("input");
      atv.className = "login-input"; atv.placeholder = "Atividade (ex: Maratona)"; atv.value = sala.evento.atividade || "";
      atv.oninput = (e) => { sala.evento.atividade = e.target.value; };
      box.appendChild(atv);
    }
    return box;
  }

  // Linha de edição de uma sala (nome + tipo + remover + evento).
  function editorSala(sala, onRemove) {
    const wrap = document.createElement("div");
    wrap.className = "ed-sala" + (sala.disponivel === false ? " interdito" : "");
    const top = document.createElement("div");
    top.className = "ed-sala-top";
    const nome = document.createElement("input");
    nome.className = "login-input"; nome.placeholder = "Nome da sala"; nome.value = sala.nome;
    nome.oninput = (e) => { sala.nome = e.target.value; };
    const tipo = document.createElement("select");
    tipo.className = "login-input ed-tipo";
    TIPOS_SALA.forEach((t) => { const o = document.createElement("option"); o.value = t; o.textContent = t; tipo.appendChild(o); });
    tipo.value = sala.tipo;
    tipo.onchange = (e) => { sala.tipo = e.target.value; };
    const del = document.createElement("button");
    del.type = "button"; del.className = "ed-del"; del.innerHTML = '<i class="fa fa-trash"></i>';
    del.onclick = onRemove;
    top.appendChild(nome); top.appendChild(tipo); top.appendChild(del);
    wrap.appendChild(top);
    // Disponibilidade — banheiros e instalações sem horário usam SÓ isto (sem programação).
    const disp = document.createElement("label");
    disp.className = "ed-disp";
    disp.innerHTML = `<input type="checkbox" ${sala.disponivel === false ? "" : "checked"}> <i class="fa fa-ban"></i> Disponível (desmarque p/ interditar)`;
    const motivo = document.createElement("input");
    motivo.className = "login-input ed-motivo";
    motivo.placeholder = "Motivo da interdição (ex: Em obras)";
    motivo.value = sala.motivo || "";
    motivo.style.display = sala.disponivel === false ? "" : "none";
    disp.querySelector("input").onchange = (e) => {
      sala.disponivel = e.target.checked;
      motivo.style.display = e.target.checked ? "none" : "";
      wrap.classList.toggle("interdito", !e.target.checked);
      if (e.target.checked) { sala.motivo = ""; motivo.value = ""; }
    };
    motivo.oninput = (e) => { sala.motivo = e.target.value; };
    wrap.appendChild(disp); wrap.appendChild(motivo);
    wrap.appendChild(editorEventoSala(sala));
    return wrap;
  }

  function botaoAdd(txt, onClick) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "ed-add"; b.innerHTML = `<i class="fa fa-plus"></i> ${txt}`;
    b.onclick = onClick;
    return b;
  }

  function renderEditorPredio() {
    const box = $("predio-editor"); box.innerHTML = "";
    if (ed.tipo === "bloco") {
      const lbl = document.createElement("label"); lbl.className = "adm-label"; lbl.textContent = "Salas"; box.appendChild(lbl);
      ed.salas.forEach((sala, i) => box.appendChild(editorSala(sala, () => { ed.salas.splice(i, 1); renderEditorPredio(); })));
      box.appendChild(botaoAdd("Adicionar sala", () => { ed.salas.push(novaSala()); renderEditorPredio(); }));
    } else {
      ed.andares.forEach((andar, ai) => {
        const card = document.createElement("div"); card.className = "ed-andar";
        const head = document.createElement("div"); head.className = "ed-andar-head";
        const nome = document.createElement("input");
        nome.className = "login-input"; nome.placeholder = "Andar (ex: Térreo, 1º Andar)"; nome.value = andar.nome;
        nome.oninput = (e) => { andar.nome = e.target.value; };
        const del = document.createElement("button");
        del.type = "button"; del.className = "ed-del"; del.innerHTML = '<i class="fa fa-trash"></i>';
        del.onclick = () => { ed.andares.splice(ai, 1); renderEditorPredio(); };
        head.appendChild(nome); head.appendChild(del); card.appendChild(head);
        andar.salas.forEach((sala, si) => card.appendChild(editorSala(sala, () => { andar.salas.splice(si, 1); renderEditorPredio(); })));
        card.appendChild(botaoAdd("Adicionar sala", () => { andar.salas.push(novaSala()); renderEditorPredio(); }));
        box.appendChild(card);
      });
      box.appendChild(botaoAdd("Adicionar andar", () => { ed.andares.push(novoAndar()); renderEditorPredio(); }));
    }
  }

  // Limpa o modelo p/ salvar: remove salas sem nome e eventos incompletos.
  function limparSala(s) {
    const out = { nome: s.nome.trim(), tipo: s.tipo };
    if (s.disponivel === false) {
      out.disponivel = false;
      const m = (s.motivo || "").trim();
      if (m) out.motivo = m;
    }
    if (s.evento && s.evento.dias.length && s.evento.horaInicio) {
      out.evento = {
        nome: (s.nome.trim() || "Evento"), dias: s.evento.dias.slice(),
        horaInicio: s.evento.horaInicio, atividade: (s.evento.atividade || "").trim(),
      };
      if (s.evento.horaFim) out.evento.horaFim = s.evento.horaFim;
    }
    return out;
  }
  $("predio-salvar").onclick = () => {
    const nome = $("predio-nome").value.trim();
    if (!nome) { $("predio-erro").textContent = "Informe o nome."; return; }
    if (!predioCoords) { $("predio-erro").textContent = "Escolha o local no mapa."; return; }
    const cat = $("predio-cat").value;
    const base = { nome, coords: predioCoords, cat, cor: CAT_COR[cat] || "green", icone: $("predio-icone").value, tipo: ed.tipo };
    if (predioDisp === "0") {
      base.disponivel = false;
      const m = $("predio-motivo").value.trim();
      if (m) base.motivo = m;
    }
    if (ed.tipo === "bloco") {
      const salas = ed.salas.filter((s) => s.nome.trim()).map(limparSala);
      if (!salas.length) { $("predio-erro").textContent = "Adicione ao menos uma sala."; return; }
      base.salas = salas;
    } else {
      const andares = ed.andares
        .map((a) => ({ nome: a.nome.trim(), salas: a.salas.filter((s) => s.nome.trim()).map(limparSala) }))
        .filter((a) => a.nome && a.salas.length);
      if (!andares.length) { $("predio-erro").textContent = "Adicione ao menos um andar com salas."; return; }
      base.andares = andares;
    }
    // upsert por nome: edição sobrepõe o existente (inclui os do JSON, por sombra)
    removeLocalCustom(base.nome);
    if (editandoNome && editandoNome !== base.nome) removeLocalCustom(editandoNome);
    addLocalCustom(base);
    closeAdmModal("predio-modal");
    cb.onAdminChange?.();
    showToast(editandoNome ? "✏️ Atualizado" : (ed.tipo === "predio" ? "🏢 Prédio criado" : "🧱 Bloco criado"));
  };

  // ----- CARDÁPIO (admin) -----
  function cardapioDoPonto(nome) {
    const over = getCardapios()[nome];
    if (over) return over;
    const l = locais.find((x) => x.nome === nome);
    return (l && l.cardapio) || null;
  }
  function carregarCardapioNoForm(nome) {
    const c = cardapioDoPonto(nome) || {};
    $("card-inicio").value = c.inicio || "";
    $("card-fim").value = c.fim || "";
    const wrap = $("card-dias"); wrap.innerHTML = "";
    DIAS_CARD.forEach(([key, label]) => {
      const lbl = document.createElement("label"); lbl.className = "adm-label"; lbl.textContent = label;
      const ta = document.createElement("textarea");
      ta.className = "login-input"; ta.rows = 4; ta.dataset.dia = key;
      ta.value = ((c.dias && c.dias[key]) || []).join("\n");
      wrap.appendChild(lbl); wrap.appendChild(ta);
    });
  }
  $("pb-cardapio").onclick = () => {
    closePanel();
    $("card-erro").textContent = "";
    const sel = $("card-ponto"); sel.innerHTML = "";
    // cardápio só para pontos com classe de alimentação (refeitório)
    const pts = locais.filter((l) => l.tipo === "refeitorio");
    if (!pts.length) {
      showToast("Crie um ponto do tipo Refeitório primeiro");
      return;
    }
    pts.forEach((l) => { const o = document.createElement("option"); o.value = l.nome; o.textContent = l.nome; sel.appendChild(o); });
    carregarCardapioNoForm(sel.value);
    openAdmModal("cardapio-modal");
  };
  $("card-ponto").onchange = () => carregarCardapioNoForm($("card-ponto").value);
  $("card-salvar").onclick = () => {
    const nome = $("card-ponto").value;
    if (!nome) { $("card-erro").textContent = "Escolha o ponto."; return; }
    const dias = {};
    [...$("card-dias").querySelectorAll("textarea")].forEach((ta) => {
      const itens = ta.value.split("\n").map((s) => s.trim()).filter(Boolean);
      if (itens.length) dias[ta.dataset.dia] = itens;
    });
    if (!Object.keys(dias).length) { $("card-erro").textContent = "Preencha ao menos um dia."; return; }
    const base = cardapioDoPonto(nome) || {};
    setCardapio(nome, {
      inicio: $("card-inicio").value || base.inicio || "",
      fim: $("card-fim").value || base.fim || "",
      obs: base.obs || "Cardápio sujeito a alterações sem aviso prévio.",
      refeicoes: base.refeicoes || [["Almoço", "11:00 às 13:00"], ["Jantar", "17:00 às 18:20"]],
      dias,
    });
    closeAdmModal("cardapio-modal");
    cb.onAdminChange?.();
    showToast("🍽️ Cardápio atualizado");
  };

  // ----- GERENCIAR -----
  function renderGerenciar() {
    const desativados = new Set(getDesativados());
    // eventos ativos: base (não desativados) + custom
    const baseAtivos = (baseEventos || []).filter((e) => !desativados.has(e.nome))
      .map((e) => ({ nome: e.nome, local: e.local, icone: e.icone, fonte: "base" }));
    const custom = getEventosCustom().map((e) => ({ id: e.id, nome: e.nome, local: e.local, icone: e.icone, fonte: "custom" }));
    const eventos = baseAtivos.concat(custom);
    const wrapE = $("gerenciar-eventos"); wrapE.innerHTML = "";
    if (!eventos.length) { wrapE.innerHTML = '<div class="adm-vazio">Nenhum evento ativo.</div>'; }
    eventos.forEach((e) => {
      const row = document.createElement("div"); row.className = "adm-item";
      row.innerHTML =
        `<span class="adm-item-ico" style="background:${GOLD}"><i class="fa fa-${e.icone || "star"}"></i></span>` +
        `<span class="adm-item-txt"><span class="adm-item-nome">${e.nome}</span>` +
        `<span class="adm-item-sub">${e.local ? e.local : "ponto temporário"} · ${e.fonte === "base" ? "padrão" : "criado por você"}</span></span>` +
        `<button class="adm-item-btn">Desativar</button>`;
      row.querySelector("button").onclick = () => {
        if (e.fonte === "custom") removeEventoCustom(e.id);
        else desativarBase(e.nome);
        cb.onAdminChange?.();
        renderGerenciar();
        showToast("Evento desativado");
      };
      wrapE.appendChild(row);
    });
    // pontos criados pelo admin
    const pontos = getLocaisCustom();
    const wrapP = $("gerenciar-pontos"); wrapP.innerHTML = "";
    if (!pontos.length) { wrapP.innerHTML = '<div class="adm-vazio">Nenhum ponto criado.</div>'; }
    pontos.forEach((p) => {
      const hex = COR_HEX[p.cor] || "#5cb85c";
      const row = document.createElement("div"); row.className = "adm-item";
      row.innerHTML =
        `<span class="adm-item-ico" style="background:${hex}"><i class="fa fa-${p.icone || "map-marker"}"></i></span>` +
        `<span class="adm-item-txt"><span class="adm-item-nome">${p.nome}</span>` +
        `<span class="adm-item-sub">${p.cat || ""}</span></span>` +
        `<button class="adm-item-btn">Remover</button>`;
      row.querySelector("button").onclick = () => {
        if (!confirm(`Remover o ponto "${p.nome}"?`)) return;
        removeLocalCustom(p.nome);
        cb.onAdminChange?.();
        renderGerenciar();
        showToast("Ponto removido");
      };
      wrapP.appendChild(row);
    });
  }
  $("pb-gerenciar").onclick = () => { closePanel(); renderGerenciar(); openAdmModal("gerenciar-modal"); };

  // ----- EXPORTAR / IMPORTAR (backup das edições do admin → arquivo JSON) -----
  $("pb-exportar").onclick = () => {
    const dados = exportarDados();
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ifrota-dados.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    closePanel();
    showToast(`💾 Exportado: ${dados.locais.length} pontos, ${dados.eventos.length} eventos`);
  };
  $("pb-limpar").onclick = () => {
    if (!confirm("Limpar tudo que foi criado/editado localmente neste navegador? (os pontos já gravados no app permanecem)")) return;
    limparTudoCustom();
    closePanel();
    cb.onAdminChange?.();
    showToast("🧹 Dados locais limpos");
  };
  $("pb-importar").onclick = () => $("import-file").click();
  $("import-file").onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";   // permite reimportar o mesmo arquivo
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      const r = importarDados(obj, { mesclar: true });
      closePanel();
      cb.onAdminChange?.();   // remonta dados + marcadores
      showToast(`✅ Importado: ${r.locais} pontos, ${r.eventos} eventos`);
    } catch (err) {
      showToast("Erro ao importar: " + (err.message || "arquivo inválido"));
    }
  };

  // ── EVENTOS (lista lateral, próximos 7 dias) ──
  // entries: [{ ev, local }]. Clicar direciona pro evento (sem popup).
  function setEventosSidebar(entries) {
    const lista = entries || [];
    const wrap = $("eventos-list");
    const section = $("eventos-section");
    section.style.display = lista.length ? "" : "none";
    wrap.innerHTML = "";
    lista.forEach(({ ev, local, salaPath }) => {
      const item = document.createElement("button");
      item.className = "evento-item";
      const quando = ev._quando || "";
      const janela = formatarJanela(ev);   // duração (ex.: 20:15–22:00)
      // eventos de sala mostram onde (Prédio · Sala)
      const onde = ev._sala && local ? `${local.nome} · ${ev._sala}` : "";
      const sub = [quando, janela, onde].filter(Boolean).join(" · ");
      item.innerHTML =
        `<span class="evento-ico"><i class="fa fa-${(local && local.icone) || ev.icone || "star"}"></i></span>` +
        `<span class="evento-txt"><span class="evento-nome">${ev.nome}</span>` +
        (sub ? `<span class="evento-quando">${sub}</span>` : "") + `</span>`;
      item.onclick = () => {
        closePanel();
        if (local) { cb.onSelectResult?.(local); openCard(local, salaPath ? { salaPath } : {}); }
      };
      wrap.appendChild(item);
    });
  }

  // ── CATEGORIAS ──
  const catList = $("cat-list");
  CATEGORIAS.forEach(([nome, cor, icon]) => {
    const btn = document.createElement("button");
    btn.className = "cat-btn" + (nome === "Tudo" ? " active" : "");
    btn.innerHTML = cor
      ? `<span class="swatch" style="background:${cor}"></span>${nome}`
      : `<span class="ico"><i class="fa ${icon}"></i></span>${nome}`;
    btn.onclick = () => {
      catAtiva = nome;
      catList.querySelectorAll(".cat-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      filtrarPorCategoria(nome);
    };
    catList.appendChild(btn);
  });

  // ── FAVORITOS ──
  function renderFavoritos() {
    const wrap = $("fav-list");
    wrap.innerHTML = "";
    const favs = store.getFavoritos();
    if (!favs.length) {
      const e = document.createElement("div");
      e.className = "fav-empty";
      e.textContent = "Nenhum favorito ainda";
      wrap.appendChild(e);
      return;
    }
    favs.forEach((nome) => {
      const local = locais.find((l) => l.nome === nome);
      if (!local) return;
      const hex = local.cor_hex || COR_HEX[local.cor] || "#5cb85c";
      const item = document.createElement("button");
      item.className = "fav-item";
      item.innerHTML =
        `<span class="fav-ico" style="background:${hex}"><i class="fa fa-${local.icone || "map-marker"}"></i></span>` +
        `<span class="fav-nome">${local.nome}</span>` +
        `<span class="fav-star"><i class="fa fa-star"></i></span>`;
      item.onclick = () => {
        closePanel();
        cb.onSelectResult?.(local);
        openCard(local);
      };
      wrap.appendChild(item);
    });
  }
  renderFavoritos();

  // ── CARDÁPIO SEMANAL (refeitório) ──
  const DIAS_CARD = [["seg", "Segunda"], ["ter", "Terça"], ["qua", "Quarta"], ["qui", "Quinta"], ["sex", "Sexta"]];
  const ddmm = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  function parseData(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  const reVeg = /^\s*(op(ç|c)[aã]o\s+vegetariana|vegetariano)\s*:\s*/i;
  function popularCardapio(card) {
    const sec = $("card-cardapio-sec"), wrap = $("cardapio");
    if (!card || !card.dias) { sec.style.display = "none"; return; }
    sec.style.display = ""; wrap.innerHTML = "";

    const ini = parseData(card.inicio), fim = parseData(card.fim);
    const ag = agoraReal();
    const hoje = new Date(ag); hoje.setHours(0, 0, 0, 0);
    const nowMin = ag.getHours() * 60 + ag.getMinutes();
    const naSemana = !!(ini && fim && hoje.getTime() >= ini.getTime() && hoje.getTime() <= fim.getTime());
    const vencido = !!(fim && hoje.getTime() > fim.getTime());

    const head = document.createElement("div"); head.className = "cardapio-head";
    let htm = "";
    if (vencido) htm += `<div class="cardapio-aviso"><i class="fa fa-exclamation-triangle"></i> Cardápio desatualizado — semana de ${ddmm(ini)} a ${ddmm(fim)} já passou.</div>`;
    if (ini && fim) htm += `<div class="cardapio-semana"><i class="fa fa-calendar-o"></i> Semana de ${ddmm(ini)} a ${ddmm(fim)}</div>`;
    if (card.refeicoes && card.refeicoes.length)
      htm += `<div class="cardapio-refeicoes">${card.refeicoes.map(([n, h]) => {
        const m = /(\d{1,2}):(\d{2}).*?(\d{1,2}):(\d{2})/.exec(h);
        const aberto = naSemana && m && nowMin >= (+m[1]) * 60 + (+m[2]) && nowMin < (+m[3]) * 60 + (+m[4]);
        return `<span class="${aberto ? "aberto" : ""}"><b>${n}</b> · ${h}${aberto ? ' <em>· aberto agora</em>' : ""}</span>`;
      }).join("")}</div>`;
    head.innerHTML = htm; if (htm) wrap.appendChild(head);

    const hojeKey = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"][hoje.getDay()];
    let openIdx = 0;   // padrão: segunda
    if (ini && fim && hoje.getTime() >= ini.getTime() && hoje.getTime() <= fim.getTime()) {
      const di = DIAS_CARD.findIndex(([k]) => k === hojeKey);
      if (di >= 0) openIdx = di;
    }

    DIAS_CARD.forEach(([key, label], i) => {
      const itens = card.dias[key] || [];
      const data = ini ? new Date(ini) : null; if (data) data.setDate(ini.getDate() + i);
      const ehHoje = !!(data && data.getTime() === hoje.getTime());
      const row = document.createElement("div");
      row.className = "day-acc" + (ehHoje ? " today" : "");
      const hb = document.createElement("button"); hb.className = "day-head";
      hb.innerHTML =
        `<span class="day-label">${ehHoje ? "HOJE" : label}<span class="day-date">${data ? ddmm(data) : ""}</span></span>` +
        `<span class="day-sum">${itens.length ? `${itens.length} itens` : "—"}</span>` +
        `<span class="day-chevron"><i class="fa fa-chevron-down"></i></span>`;
      const body = document.createElement("div"); body.className = "day-body";
      if (!itens.length) body.innerHTML = '<div class="day-empty">Sem cardápio neste dia</div>';
      else itens.forEach((it, idx) => {
        const veg = reVeg.test(it);
        const el = document.createElement("div");
        el.className = "cardapio-item" + (idx === 0 && !veg ? " principal" : "") + (veg ? " veg" : "");
        el.innerHTML = veg ? `<i class="fa fa-leaf"></i> ${it.replace(reVeg, "")}` : it;
        body.appendChild(el);
      });
      hb.onclick = () => row.classList.toggle("open");
      if (i === openIdx) row.classList.add("open");
      row.appendChild(hb); row.appendChild(body);
      wrap.appendChild(row);
    });
    if (card.obs) {
      const obs = document.createElement("div"); obs.className = "cardapio-obs"; obs.textContent = card.obs;
      wrap.appendChild(obs);
    }
  }

  // ── NAVEGADOR DE ANDARES/SALAS (prédios e blocos) ──
  // Um ponto é "container" quando tem `salas` (bloco, 1 nível) ou `andares`
  // (prédio: andares → salas). Cada sala é um mini-ponto com tipo/desc/agenda/fotos.
  const ICONES_SALA = {
    "Sala": "users", "Laboratório": "flask", "Banheiro": "tint",
    "Administração": "briefcase", "Auditório": "bullhorn", "Biblioteca": "book",
    "Coordenação": "id-badge",
  };
  const COR_SALA = {
    "Sala": "#428bca", "Laboratório": "#9B479F", "Banheiro": "#436978",
    "Administração": "#d9534f", "Auditório": "#e6b422", "Biblioteca": "#2e7d32",
    "Coordenação": "#a23336",
  };
  const DOW_KEY = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
  function ehContainer(l) { return !!(l && (Array.isArray(l.andares) || Array.isArray(l.salas))); }
  function salaTemHoje(sala) {
    const itens = sala.agenda && sala.agenda[DOW_KEY[agoraReal().getDay()]];
    return Array.isArray(itens) && itens.length > 0;
  }
  // Há programação semanal real? (algum dia com itens). Banheiros/instalações sem
  // horário ficam vazios — não mostramos a grade só com "vago".
  function temAgenda(ag) {
    return !!ag && Object.keys(ag).some((k) => Array.isArray(ag[k]) && ag[k].length);
  }
  // Status de disponibilidade (interdição / obra). Vale p/ ponto OU sala.
  function renderStatus(obj) {
    const el = $("card-status");
    const interdito = !!(obj && obj.disponivel === false);
    card.classList.toggle("interdito", interdito);
    if (!interdito) { el.style.display = "none"; el.innerHTML = ""; return; }
    el.style.display = "";
    const motivo = (obj.motivo || "").trim();
    el.innerHTML = `<i class="fa fa-exclamation-triangle"></i> <span><b>Interditado</b>${motivo ? " · " + motivo : ""}</span>`;
  }
  // Partes DEPENDENTES DO TEMPO (cardápio + agenda + status) — re-renderizáveis ao vivo.
  function renderTempoDe(obj) {
    const ehRef = obj.tipo === "refeitorio";
    // cardápio é EXCLUSIVO da classe "refeitorio" (como prédio/bloco têm a sua)
    popularCardapio(ehRef ? obj.cardapio : null);
    let ag = obj.agenda;
    if (obj.evento) ag = { ...(obj.agenda || {}), ...(obj.evento.horarios || {}) };
    // Agenda só quando há programação/evento. Refeitório não mostra (o cardápio já
    // cumpre essa função); instalações sem horário (banheiros) também ficam sem grade.
    const aSec = $("card-agenda-sec");
    const temProg = !ehRef && (!!obj.evento || temAgenda(ag));
    if (temProg) { aSec.style.display = ""; popularAgenda(ag, obj.evento); }
    else { aSec.style.display = "none"; $("agenda").innerHTML = ""; }
    renderStatus(obj);
  }
  // Conteúdo completo de um objeto (ponto OU sala): tempo + galeria.
  function exibirConteudo(obj) {
    renderTempoDe(obj);
    popularGaleria(obj.fotos, obj.nome);
  }
  // Atualiza o card ABERTO em tempo real (chrome + cardápio + agenda), sem mexer
  // na galeria (evitar re-fetch e resetar a foto que o usuário está vendo).
  function atualizarCardAoVivo() {
    if (!currentLocal || !card.classList.contains("open")) return;
    const local = currentLocal;
    const ehEvento = ehContainer(local)
      ? eventoAtivoNoContainer(local)
      : !!(local.evento && eventoAtivoAgora(local.evento));
    $("card-icon").style.background = ehEvento
      ? "linear-gradient(150deg, #ffe27a, #ffc107 45%, #d4a017)"
      : (local.cor_hex || COR_HEX[local.cor] || "#5cb85c");
    card.classList.toggle("event", ehEvento);
    $("card-evento-badge").style.display = ehEvento ? "" : "none";
    if (ehContainer(local)) cnRender(true);   // preserva cnPath; re-avalia tudo
    else renderTempoDe(local);
  }

  let cnLocal = null, cnPath = [];
  function abrirNavegador(local, alvoPath) {
    cnLocal = local; cnPath = Array.isArray(alvoPath) ? alvoPath.slice() : [];
    $("card-niveis").style.display = "";
    cnRender();
  }
  function cnNode() {
    const l = cnLocal;
    if (l.andares) {
      if (cnPath.length === 0) return { nivel: "andares", itens: l.andares };
      const andar = l.andares[cnPath[0]] || {};
      if (cnPath.length === 1) return { nivel: "salas", itens: andar.salas || [] };
      return { nivel: "sala", sala: (andar.salas || [])[cnPath[1]] || {} };
    }
    if (cnPath.length === 0) return { nivel: "salas", itens: l.salas || [] };
    return { nivel: "sala", sala: (l.salas || [])[cnPath[0]] || {} };
  }
  // Reposiciona a galeria: logo APÓS o navegador de andares/salas (fachada do
  // prédio/bloco, abaixo da seleção) ou no fim (galeria normal de sala/ponto).
  // No-op se já está na posição.
  function galeriaNoTopo(aposNiveis) {
    const exp = $("card-expanded"), g = $("card-galeria-sec"), niveis = $("card-niveis");
    if (aposNiveis) { if (niveis.nextElementSibling !== g) exp.insertBefore(g, niveis.nextSibling); }
    else { if (exp.lastChild !== g) exp.appendChild(g); }
  }
  function cnRender(semGaleria) {
    const node = cnNode();
    cnRenderCrumb();
    const lista = $("cn-lista"), label = $("cn-label");
    const aSec = $("card-agenda-sec"), gSec = $("card-galeria-sec"), cSec = $("card-cardapio-sec");
    if (node.nivel === "sala") {
      lista.style.display = "none"; lista.innerHTML = ""; label.style.display = "none";
      galeriaNoTopo(false);   // galeria da sala fica no lugar normal (fim)
      aSec.style.display = ""; gSec.style.display = "";
      if (semGaleria) renderTempoDe(node.sala); else exibirConteudo(node.sala);
    } else {
      lista.style.display = ""; label.style.display = "";
      label.textContent = node.nivel === "andares" ? "ANDARES" : "SALAS";
      aSec.style.display = "none"; cSec.style.display = "none";
      renderStatus(cnLocal);   // interdição do prédio/bloco inteiro (se houver)
      // Galeria da FACHADA do prédio/bloco — só no nível principal do navegador.
      const noTopo = cnPath.length === 0;
      const temFotos = noTopo && Array.isArray(cnLocal.fotos) && cnLocal.fotos.length > 0;
      galeriaNoTopo(temFotos);   // fachada do prédio/bloco vai pro TOPO do card
      gSec.style.display = temFotos ? "" : "none";
      if (temFotos && !semGaleria) popularGaleria(cnLocal.fotos, cnLocal.nome);
      cnRenderLista(node);
    }
  }
  function cnItemRow({ ico, badge, cor, nome, sub, evento, interd }) {
    const row = document.createElement("button");
    row.className = "cn-item" + (evento ? " evento" : "") + (interd ? " interdito" : "");
    // evento ativo → ícone dourado (sobrepõe a cor do tipo)
    const bg = evento ? "linear-gradient(150deg,#ffe27a,#ffc107 45%,#d4a017)" : (cor || "var(--panel-tit)");
    const ic = badge != null
      ? `<span class="cn-ico badge"${evento ? ` style="background:${bg}"` : ""}>${badge}</span>`
      : `<span class="cn-ico" style="background:${bg}"><i class="fa fa-${ico}"></i></span>`;
    row.innerHTML = ic +
      `<span class="cn-txt"><span class="cn-nome">${nome}${evento ? ' <i class="fa fa-star cn-star"></i>' : ""}</span>` +
      (sub ? `<span class="cn-sub">${sub}</span>` : "") + "</span>" +
      `<span class="cn-chevron"><i class="fa fa-chevron-right"></i></span>`;
    return row;
  }
  function cnRenderLista(node) {
    const lista = $("cn-lista"); lista.innerHTML = "";
    if (node.nivel === "andares") {
      node.itens.forEach((andar, i) => {
        const n = (andar.salas || []).length;
        // andar fica dourado se contém alguma sala com evento ativo agora
        const ev = (andar.salas || []).some((s) => s.evento && eventoAtivoAgora(s.evento));
        const row = cnItemRow({
          badge: i === 0 ? "T" : `${i}º`, nome: andar.nome,
          sub: ev ? "evento acontecendo agora" : `${n} ${n === 1 ? "espaço" : "espaços"}`, evento: ev,
        });
        row.onclick = () => { cnPath = [i]; cnRender(); };
        lista.appendChild(row);
      });
    } else {
      node.itens.forEach((sala, i) => {
        const tp = sala.tipo || "Sala";
        const interd = sala.disponivel === false;
        const ev = !interd && !!(sala.evento && eventoAtivoAgora(sala.evento));
        const motivo = (sala.motivo || "").trim();
        let sub;
        if (interd) sub = motivo ? `${tp} · interditado · ${motivo}` : `${tp} · interditado`;
        else if (ev) sub = `${tp} · evento agora`;
        else sub = tp + (salaTemHoje(sala) ? " · programação hoje" : "");
        const row = cnItemRow({ ico: ICONES_SALA[tp] || "map-pin", cor: COR_SALA[tp], nome: sala.nome, sub, evento: ev, interd });
        row.onclick = () => { cnPath = [...cnPath, i]; cnRender(); };
        lista.appendChild(row);
      });
    }
  }
  function cnRenderCrumb() {
    const crumb = $("cn-crumb"); crumb.innerHTML = "";
    const l = cnLocal;
    const segs = [{ label: l.nome, path: [] }];
    if (l.andares) {
      if (cnPath.length >= 1) segs.push({ label: (l.andares[cnPath[0]] || {}).nome, path: [cnPath[0]] });
      if (cnPath.length >= 2) segs.push({ label: ((l.andares[cnPath[0]] || {}).salas || [])[cnPath[1]].nome, path: cnPath.slice() });
    } else if (cnPath.length >= 1) {
      segs.push({ label: (l.salas || [])[cnPath[0]].nome, path: cnPath.slice() });
    }
    segs.forEach((s, i) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "cn-sep"; sep.innerHTML = "<i class='fa fa-angle-right'></i>";
        crumb.appendChild(sep);
      }
      const last = i === segs.length - 1;
      const el = document.createElement(last ? "span" : "button");
      el.className = "cn-seg" + (last ? " atual" : "");
      el.textContent = s.label;
      if (!last) el.onclick = () => { cnPath = s.path; cnRender(); };
      crumb.appendChild(el);
    });
  }

  // ── BOTTOM CARD ──
  function openCard(local, opts = {}) {
    somPonto();   // toque sutil ao abrir um ponto de interesse
    currentLocal = local;
    // Estilização de evento (interna E externa) só durante o PERÍODO ATIVO: selo,
    // ícone dourado e acentos. Em prédios/blocos, vale se ALGUMA sala tem evento ativo.
    const ehEvento = ehContainer(local)
      ? eventoAtivoNoContainer(local)
      : !!(local.evento && eventoAtivoAgora(local.evento));
    const iconEl = $("card-icon");
    // Evento: fundo do ícone dourado (igual ao marcador/popup); senão cor da categoria.
    iconEl.style.background = ehEvento
      ? "linear-gradient(150deg, #ffe27a, #ffc107 45%, #d4a017)"
      : (local.cor_hex || COR_HEX[local.cor] || "#5cb85c");
    iconEl.innerHTML = `<i class="fa fa-${local.icone || "map-marker"}"></i>`;
    card.classList.toggle("event", ehEvento);   // acentos dourados via CSS
    $("card-evento-badge").style.display = ehEvento ? "" : "none";
    $("card-title").textContent = local.nome || "";
    const tipoLabel = local.andares ? "Prédio" : (local.salas ? "Bloco" : (local.tipo === "refeitorio" ? "Refeitório" : ""));
    $("card-cat").textContent = (local.cat || "") + (tipoLabel ? ` · ${tipoLabel}` : "");
    $("card-desc").textContent = local.desc || "";

    // distância se houver posição
    const pos = store.getLastPos();
    const distEl = $("card-distance");
    if (pos) {
      const d = haversine(pos[0], pos[1], local.coords[0], local.coords[1]);
      const eta = Math.max(1, Math.round(d / 1.4 / 60));
      distEl.textContent = `📍 ${formatarDistancia(d)} · ~${eta} min a pé`;
      distEl.style.display = "";
    } else {
      distEl.style.display = "none";
    }

    refreshFavIcon();
    $("card-edit").style.display = ehAdmin() ? "" : "none";
    // Prédios/blocos: navegador de andares/salas (opcionalmente já numa sala alvo).
    // Pontos normais: agenda+galeria direto.
    if (ehContainer(local)) {
      abrirNavegador(local, opts.salaPath);
    } else {
      galeriaNoTopo(false);   // ponto simples: galeria no fim (após agenda)
      $("card-niveis").style.display = "none";
      $("card-agenda-sec").style.display = "";
      $("card-galeria-sec").style.display = "";
      exibirConteudo(local);
    }
    selecionarMarcador(local.nome);
    // Abre numa sala-alvo (busca/sidebar) → já expandido; senão compacto.
    card.classList.toggle("expanded", !!opts.salaPath);
    card.classList.add("open");
  }

  function closeCard() {
    card.classList.remove("open", "expanded");
    currentLocal = null;
    limparSelecao();
  }

  $("card-close").onclick = closeCard;
  $("card-nav").onclick = () => { if (currentLocal) cb.onNav?.(currentLocal); };
  // Editar (admin): abre o editor certo pré-preenchido.
  $("card-edit").onclick = () => {
    if (!currentLocal) return;
    const l = currentLocal;
    closeCard();
    if (ehContainer(l)) abrirEditorPredio(l);
    else abrirEditorPonto(l);
  };

  // ── EXPANDIR/COLAPSAR (swipe) ──
  function setExpanded(v) { card.classList.toggle("expanded", v); }
  (function initCardDrag() {
    // Área de gesto ampliada: a alça + a linha do cabeçalho do card.
    const zonas = [card.querySelector(".card-handle-bar"), card.querySelector(".card-head-row")];
    let startY = null, dragging = false, sobreBotao = false;
    const ehBotao = (el) => !!(el && el.closest && el.closest("button"));
    const onDown = (e) => { startY = e.clientY; dragging = true; sobreBotao = ehBotao(e.target); };
    const onUp = (e) => {
      if (!dragging) return;
      dragging = false;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 28) {
        setExpanded(dy < 0);                  // swipe vertical (mesmo iniciando sobre botão)
      } else if (!sobreBotao) {
        setExpanded(!card.classList.contains("expanded"));  // toque (fora de botão) alterna
      }
    };
    zonas.forEach((z) => {
      if (!z) return;
      z.addEventListener("pointerdown", onDown);
      z.addEventListener("pointerup", onUp);
    });
  })();

  // ── AGENDA SEMANAL (accordion: cada dia abre mostrando os horários) ──
  const DIAS = [["Segunda","seg"],["Terça","ter"],["Quarta","qua"],["Quinta","qui"],
                ["Sexta","sex"],["Sábado","sab"],["Domingo","dom"]];
  // diasEvento: Set de chaves de dia que são dias de evento (pintados de dourado).
  const minDe = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  };
  // Monta a grade de horários-padrão do campus (anexo) para um dia: todos os slots
  // dos 3 turnos, com --- separando os turnos. Cada slot mostra a atividade
  // agendada (se houver alguma cujo horário caia na faixa) ou fica "vago".
  // `janela` (opcional) = { iniMin, fimMin, label }: início/fim LIVRES do evento.
  // Os slots-padrão que se sobrepõem à janela são marcados como evento — ou seja,
  // o início é livre mas a marcação cobre só esses horários (slots) do dia.
  function montarGradeHorarios(lista, janela) {
    const itens = (lista || [])
      .filter((e) => Array.isArray(e) && e.length >= 2)
      .map(([hora, atv]) => ({ min: minDe(hora), hora, atv }))
      .filter((x) => x.min != null);
    const usados = new Set();
    const frag = document.createDocumentFragment();
    HORARIOS_PADRAO.forEach(({ turno, slots }, ti) => {
      if (ti > 0) {
        const sep = document.createElement("div");
        sep.className = "agenda-sep"; sep.textContent = "———";
        frag.appendChild(sep);
      }
      const cap = document.createElement("div");
      cap.className = "agenda-turno"; cap.textContent = turno;
      frag.appendChild(cap);
      slots.forEach(([ini, fim]) => {
        const iniM = minDe(ini), fimM = minDe(fim);
        const aqui = [];
        itens.forEach((x, idx) => { if (x.min >= iniM && x.min < fimM) { usados.add(idx); aqui.push(x); } });
        const coberto = !!janela && iniM < janela.fimMin && fimM > janela.iniMin;
        const slot = document.createElement("div");
        let atv;
        if (aqui.length) { atv = aqui.map((a) => a.atv).join(" · "); slot.className = "agenda-slot cheio" + (coberto ? " evento" : ""); }
        else if (coberto) { atv = janela.label || "Evento"; slot.className = "agenda-slot cheio evento"; }
        else { atv = "vago"; slot.className = "agenda-slot vago"; }
        slot.innerHTML = `<span class="as-hora">${ini} – ${fim}</span><span class="as-atv">${atv}</span>`;
        frag.appendChild(slot);
      });
    });
    // Atividades com horário fora dos slots-padrão — não some, vai pro fim.
    const sobra = itens.filter((x, idx) => !usados.has(idx));
    if (sobra.length) {
      const sep = document.createElement("div");
      sep.className = "agenda-sep"; sep.textContent = "———";
      frag.appendChild(sep);
      const cap = document.createElement("div");
      cap.className = "agenda-turno"; cap.textContent = "Outros horários";
      frag.appendChild(cap);
      sobra.forEach((x) => {
        const slot = document.createElement("div");
        slot.className = "agenda-slot cheio";
        slot.innerHTML = `<span class="as-hora">${x.hora}</span><span class="as-atv">${x.atv}</span>`;
        frag.appendChild(slot);
      });
    }
    return frag;
  }

  // Janela LIVRE do evento (início/fim em minutos) p/ marcar a grade. null se o
  // evento não tem horaInicio (= ativo o dia todo, sem marcação específica).
  function janelaDoEventoUI(evento) {
    if (!evento) return null;
    const ini = minDe(evento.horaInicio);
    if (ini == null) return null;
    const fim = minDe(evento.horaFim);
    return { iniMin: ini, fimMin: fim != null ? fim : 24 * 60, label: evento.atividade || evento.nome || "Evento" };
  }

  function popularAgenda(agenda, evento) {
    const wrap = $("agenda");
    wrap.innerHTML = "";
    const ag = agenda || {};
    const janelaBase = janelaDoEventoUI(evento);
    const ativoAgora = evento ? eventoAtivoAgora(evento) : false;

    // Datas reais da SEMANA atual (segunda → domingo), para cada dia ter sua data.
    // Assim a programação não é "infinita": cada ocorrência é uma data concreta,
    // limitada por inicio/fim do evento.
    const hoje = agoraReal(); hoje.setHours(0, 0, 0, 0);
    const hojeMs = hoje.getTime();
    const monday = new Date(hoje);
    monday.setDate(hoje.getDate() + (hoje.getDay() === 0 ? -6 : 1 - hoje.getDay()));

    DIAS.forEach(([label, key], i) => {
      const data = new Date(monday);
      data.setDate(monday.getDate() + i);
      data.setHours(0, 0, 0, 0);
      const ehHoje = data.getTime() === hojeMs;
      const passou = data.getTime() < hojeMs;
      const dataStr = `${String(data.getDate()).padStart(2, "0")}/${String(data.getMonth() + 1).padStart(2, "0")}`;

      // o evento OCORRE nesta data? (dia da semana + dentro de inicio/fim)
      const ocorre = !!(evento && eventoAtivoHoje(evento, data));
      // dourado só quando o evento está ATIVO AGORA (hoje e dentro da janela)
      const gold = ehHoje && ativoAgora;
      const janela = ocorre ? janelaBase : null;

      const lista = (ag[key] || []).filter((e) => Array.isArray(e) && e.length >= 2);

      const row = document.createElement("div");
      row.className = "day-acc" + (ehHoje ? " today" : "") + (passou ? " past" : "") + (gold ? " evento" : "");

      const head = document.createElement("button");
      head.className = "day-head";
      const n = lista.length;
      const dur = evento ? formatarJanela(evento) : "";
      let resumo;
      if (gold) resumo = dur ? `Agora · ${dur}` : "Acontecendo agora";
      else if (ocorre && janela) resumo = dur || "Evento";
      else if (n) resumo = `${n} ${n > 1 ? "atividades" : "atividade"}`;
      else resumo = "Sem programação";
      head.innerHTML =
        `<span class="day-label">${ehHoje ? "HOJE" : label}<span class="day-date">${dataStr}</span></span>` +
        `<span class="day-sum">${resumo}</span>` +
        `<span class="day-chevron"><i class="fa fa-chevron-down"></i></span>`;

      const body = document.createElement("div");
      body.className = "day-body";
      body.appendChild(montarGradeHorarios(lista, janela));   // grade-padrão (anexo) + marcação da janela

      head.onclick = () => row.classList.toggle("open");
      if (ehHoje) row.classList.add("open");   // dia atual já vem expandido
      row.appendChild(head); row.appendChild(body);
      wrap.appendChild(row);
    });
  }

  // ── GALERIA ──
  // galFotos: [{ src, cloud, foto }]. Fotos locais (locais.json) + fotos da nuvem
  // (Firebase) ficam juntas; todos os usuários veem as da nuvem.
  let galFotos = [], galIdx = 0, galLocalNome = null;
  function popularGaleria(fotos, localNome) {
    galLocalNome = localNome || null;
    galFotos = (Array.isArray(fotos) ? fotos.filter(Boolean) : [])
      .map((src) => ({ src, cloud: false, foto: null }));
    galIdx = 0;
    renderGaleria();
    carregarFotosNuvem(localNome);  // async: anexa fotos da nuvem quando chegarem
  }
  async function carregarFotosNuvem(localNome) {
    if (!fotosAtivo() || !localNome) return;
    const cloud = await listarFotos(localNome);
    if (galLocalNome !== localNome) return;  // card já mudou
    const novos = cloud.map((f) => ({ src: f.url, cloud: true, foto: f }));
    // evita duplicar se recarregar
    galFotos = galFotos.filter((g) => !g.cloud).concat(novos);
    renderGaleria();
  }
  function renderGaleria() {
    const hero = $("gal-hero");
    const n = galFotos.length;
    const temNav = n > 1;
    $("gal-prev").style.display = temNav ? "flex" : "none";
    $("gal-next").style.display = temNav ? "flex" : "none";
    $("gal-counter").style.display = n ? "block" : "none";
    $("gal-dots").innerHTML = "";
    const item = galFotos[galIdx];
    // botão de remover: só admin e só em foto da nuvem
    $("gal-del").style.display = (isAdmin && item && item.cloud) ? "flex" : "none";
    if (!n) {
      hero.style.backgroundImage = "";
      hero.innerHTML = '<i class="fa fa-camera"></i>';
      hero.onclick = null;
      return;
    }
    const path = item.src;
    const img = new Image();
    img.onload = () => { hero.style.backgroundImage = `url("${path}")`; hero.innerHTML = ""; };
    img.onerror = () => { hero.style.backgroundImage = ""; hero.innerHTML = '<i class="fa fa-camera"></i>'; };
    img.src = path;
    hero.onclick = () => abrirViewer(galIdx);
    $("gal-counter").textContent = `${galIdx + 1} / ${n}`;
    if (temNav) {
      for (let i = 0; i < n; i++) {
        const d = document.createElement("div");
        d.className = "gal-dot" + (i === galIdx ? " active" : "");
        $("gal-dots").appendChild(d);
      }
    }
  }
  function navGaleria(delta) {
    if (galFotos.length < 2) return;
    galIdx = (galIdx + delta + galFotos.length) % galFotos.length;
    renderGaleria();
  }
  $("gal-prev").onclick = () => navGaleria(-1);
  $("gal-next").onclick = () => navGaleria(1);

  // ── UPLOAD / DELETE (admin) ──
  $("gal-upload").onclick = () => $("gal-file").click();
  $("gal-file").onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";  // permite reenviar o mesmo arquivo
    if (!file || !galLocalNome) return;
    const btn = $("gal-upload");
    btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Enviando...';
    try {
      await enviarFoto(galLocalNome, file);
      showToast("📷 Foto adicionada");
      await carregarFotosNuvem(galLocalNome);
      galIdx = galFotos.length - 1;  // mostra a recém-enviada
      renderGaleria();
    } catch (err) {
      showToast("Erro ao enviar: " + (err.message || err));
    } finally {
      btn.disabled = false; btn.innerHTML = '<i class="fa fa-plus"></i> Adicionar foto';
    }
  };
  $("gal-del").onclick = async () => {
    const item = galFotos[galIdx];
    if (!item || !item.cloud || !item.foto) return;
    if (!confirm("Remover esta foto?")) return;
    try {
      await removerFoto(item.foto);
      showToast("Foto removida");
      galIdx = Math.max(0, galIdx - 1);
      await carregarFotosNuvem(galLocalNome);
      renderGaleria();
    } catch (err) {
      showToast("Erro ao remover: " + (err.message || err));
    }
  };

  // ── VISUALIZADOR FULLSCREEN ──
  const viewer = $("photo-viewer");
  let pvIdx = 0;
  function abrirViewer(idx) {
    if (!galFotos.length) return;
    pvIdx = idx;
    renderViewer();
    viewer.classList.add("open");
  }
  function fecharViewer() { viewer.classList.remove("open"); }
  function renderViewer() {
    const n = galFotos.length;
    const path = galFotos[pvIdx] && galFotos[pvIdx].src;
    const img = $("pv-img");
    const probe = new Image();
    probe.onload = () => { img.src = path; viewer.classList.remove("no-img"); };
    probe.onerror = () => { img.removeAttribute("src"); viewer.classList.add("no-img"); };
    probe.src = path;
    $("pv-counter").textContent = `${pvIdx + 1} / ${n}`;
    $("pv-prev").style.display = n > 1 ? "flex" : "none";
    $("pv-next").style.display = n > 1 ? "flex" : "none";
  }
  function navViewer(delta) {
    if (galFotos.length < 2) return;
    pvIdx = (pvIdx + delta + galFotos.length) % galFotos.length;
    renderViewer();
  }
  $("pv-close").onclick = fecharViewer;
  $("pv-prev").onclick = () => navViewer(-1);
  $("pv-next").onclick = () => navViewer(1);
  viewer.addEventListener("click", (e) => { if (e.target === viewer) fecharViewer(); });
  document.addEventListener("keydown", (e) => {
    if (!viewer.classList.contains("open")) return;
    if (e.key === "Escape") fecharViewer();
    else if (e.key === "ArrowLeft") navViewer(-1);
    else if (e.key === "ArrowRight") navViewer(1);
  });

  function refreshFavIcon() {
    if (!currentLocal) return;
    const fav = store.isFavorito(currentLocal.nome);
    const btn = $("card-fav");
    btn.classList.toggle("active", fav);
    btn.innerHTML = fav ? '<i class="fa fa-star"></i>' : '<i class="fa fa-star-o"></i>';
  }
  $("card-fav").onclick = () => {
    if (!currentLocal) return;
    const agora = store.toggleFavorito(currentLocal.nome);
    refreshFavIcon();
    renderFavoritos();   // mantém a lista do painel sincronizada
    showToast(agora ? `★ ${currentLocal.nome} favoritado` : "☆ Removido dos favoritos");
  };

  // ── SEARCH ──
  // Índice de busca: pontos de topo + salas (com caminho Prédio › Andar › Sala).
  function indiceBusca() {
    const out = [];
    for (const l of locais) {
      if (l._temp) continue;
      out.push({ nome: l.nome, sub: l.cat || "", ico: l.icone || "map-marker", cor: l.cor_hex || COR_HEX[l.cor] || "#5cb85c", local: l, path: null });
      if (l.andares) {
        l.andares.forEach((a, ai) => (a.salas || []).forEach((s, si) => {
          out.push({ nome: s.nome, sub: `${l.nome} › ${a.nome}`, cor: COR_SALA[s.tipo] || "#5cb85c", ico: ICONES_SALA[s.tipo], local: l, path: [ai, si] });
        }));
      } else if (l.salas) {
        l.salas.forEach((s, si) => out.push({ nome: s.nome, sub: l.nome, cor: COR_SALA[s.tipo] || "#5cb85c", ico: ICONES_SALA[s.tipo], local: l, path: [si] }));
      }
    }
    return out;
  }
  function abrirResultado(r) {
    results.classList.remove("open"); searchInput.value = "";
    cb.onSelectResult?.(r.local);              // voa até o ponto/prédio
    openCard(r.local, r.path ? { salaPath: r.path } : {});
  }
  function renderResults(q) {
    const term = q.trim().toLowerCase();
    if (!term) { results.classList.remove("open"); results.innerHTML = ""; return; }
    const matches = indiceBusca()
      .filter((r) => r.nome.toLowerCase().includes(term) || r.sub.toLowerCase().includes(term))
      .slice(0, 10);
    results.innerHTML = "";
    if (!matches.length) {
      results.innerHTML = '<div class="result-vazio">Nenhum resultado</div>';
      results.classList.add("open"); return;
    }
    matches.forEach((r) => {
      const item = document.createElement("button");
      item.className = "result-item";
      const icone = `<span class="result-ico" style="background:${r.cor}"><i class="fa fa-${r.ico || "map-marker"}"></i></span>`;
      item.innerHTML = `${icone}<span class="result-txt"><span class="result-nome">${r.nome}</span>${r.sub ? `<span class="result-sub">${r.sub}</span>` : ""}</span>`;
      item.onclick = () => abrirResultado(r);
      results.appendChild(item);
    });
    results.classList.add("open");
  }
  searchInput.addEventListener("input", (e) => renderResults(e.target.value));
  $("search-btn").onclick = () => {
    const term = searchInput.value.trim().toLowerCase();
    if (!term) return;
    const m = indiceBusca().find((r) => r.nome.toLowerCase().includes(term));
    if (m) abrirResultado(m);
  };
  document.addEventListener("click", (e) => {
    if (!results.contains(e.target) && e.target !== searchInput && !$("search-btn").contains(e.target)) {
      results.classList.remove("open");
    }
  });

  // ── ROUTE BANNER ──
  function showRouteBanner(local, distM, etaMin) {
    const hex = local.cor_hex || COR_HEX[local.cor] || "#5cb85c";
    $("rb-icon").style.background = hex;
    $("rb-icon").innerHTML = `<i class="fa fa-${local.icone || "map-marker"}"></i>`;
    $("rb-name").textContent = local.nome || "";
    const arr = new Date(Date.now() + etaMin * 60000);
    $("rb-arrival").textContent =
      `${String(arr.getHours()).padStart(2, "0")}:${String(arr.getMinutes()).padStart(2, "0")}`;
    $("rb-summary").textContent = `${etaMin} min · ${formatarDistancia(distM)}`;
    $("route-banner").classList.add("open");
  }
  function hideRouteBanner() { $("route-banner").classList.remove("open"); }
  $("rb-close").onclick = () => { hideRouteBanner(); cb.onClearRoute?.(); };

  // ── TOAST ──
  function showToast(text, ms = 1800) {
    const t = $("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  }

  // ── POPUP DE EVENTOS ──
  const eventPopup = $("event-popup");
  let epTimer = null;
  function focarEvento(local) {
    esconderEventos();
    cb.onSelectResult?.(local);   // voa até o evento
    openCard(local);
  }
  function esconderEventos() {
    clearTimeout(epTimer);
    eventPopup.classList.add("hiding");
    eventPopup.classList.remove("show");
    setTimeout(() => eventPopup.classList.remove("hiding"), 450);
  }
  // eventLocais: locais marcados como evento ativos hoje.
  function mostrarEventos(eventLocais) {
    if (!eventLocais || !eventLocais.length) return;
    const body = $("ep-body");
    body.innerHTML = "";
    const nomeEv = (l) => (l.evento ? l.evento.nome : l.nome);
    const subEv = (l) => (nomeEv(l) === l.nome ? (l.cat || "Evento no campus") : l.nome);
    if (eventLocais.length === 1) {
      const l = eventLocais[0];
      const el = document.createElement("div");
      el.className = "ep-single";
      el.innerHTML =
        `<div class="ep-badge"><i class="fa fa-${l.icone || "star"}"></i></div>` +
        `<div class="ep-info">` +
          `<div class="ep-head"><span class="ep-live"></span>EVENTO ACONTECENDO AGORA</div>` +
          `<div class="ep-name">${nomeEv(l)}</div>` +
          `<div class="ep-sub"><i class="fa fa-map-marker"></i>${subEv(l)}</div>` +
        `</div>` +
        `<div class="ep-go"><i class="fa fa-chevron-right"></i></div>`;
      el.onclick = () => focarEvento(l);
      body.appendChild(el);
    } else {
      const head = document.createElement("div");
      head.className = "ep-multi-head";
      head.innerHTML = `<span class="ep-live"></span>${eventLocais.length} eventos acontecendo agora`;
      body.appendChild(head);
      eventLocais.forEach((l) => {
        const it = document.createElement("button");
        it.className = "ep-item";
        it.innerHTML =
          `<span class="ep-dot"><i class="fa fa-${l.icone || "star"}"></i></span>` +
          `<span class="ep-item-txt"><span class="ep-item-nome">${nomeEv(l)}</span>` +
          `<span class="ep-item-sub">${subEv(l)}</span></span>` +
          `<span class="ep-arrow"><i class="fa fa-chevron-right"></i></span>`;
        it.onclick = () => focarEvento(l);
        body.appendChild(it);
      });
    }
    // reinicia slide + barra de descarga
    eventPopup.classList.remove("show", "hiding");
    void eventPopup.offsetWidth;   // reflow força reinício das animações
    eventPopup.classList.add("show");
    clearTimeout(epTimer);
    epTimer = setTimeout(esconderEventos, 5000);
  }

  // ── ACESSIBILIDADE & POLISH ──
  // Esc fecha o que estiver aberto (modais admin → login → foto → popup → busca).
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const adm = document.querySelector(".adm-modal.open");
    if (adm) return void adm.classList.remove("open");
    if ($("login-modal").classList.contains("open")) return void $("login-modal").classList.remove("open");
    if ($("photo-viewer").classList.contains("open")) return void $("photo-viewer").classList.remove("open");
    if ($("event-popup").classList.contains("show")) return void esconderEventos();
    if ($("results-panel").classList.contains("open")) return void $("results-panel").classList.remove("open");
  });
  // aria-label a partir do title nos botões só-ícone (sem rótulo de texto).
  document.querySelectorAll("button[title]:not([aria-label])").forEach((b) => b.setAttribute("aria-label", b.getAttribute("title")));
  $("search-input").setAttribute("aria-label", "Buscar local no campus");

  // Instalar PWA: mostra o botão quando o navegador permite instalar.
  let deferredInstall = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); deferredInstall = e; $("install-section").style.display = "";
  });
  $("pwa-install").onclick = async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => {});
    deferredInstall = null; $("install-section").style.display = "none";
  };
  window.addEventListener("appinstalled", () => { $("install-section").style.display = "none"; });

  // API pública (main.js usa)
  return {
    openCard, closeCard, closePanel,
    showRouteBanner, hideRouteBanner,
    showToast, mostrarEventos, setEventosSidebar, atualizarCardAoVivo,
  };
}
