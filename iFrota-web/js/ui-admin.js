// Editores do ADMIN — pontos de interesse, eventos, prédios/blocos, cardápio,
// gerenciar (desativar/remover) e exportar/importar. Extraído do ui.js, que
// mantém o shell (card, galeria, busca, painel, toasts). Recebe do initUI as
// funções do shell que usa (closePanel, showToast) e os callbacks de domínio,
// e devolve os editores que o botão "editar" do card abre.
import { HORARIOS_PADRAO } from "./eventos.js";
import { COR_HEX } from "./config.js";
import {
  addLocalCustom, getLocaisCustom, removeLocalCustom,
  addEventoCustom, getEventosCustom, removeEventoCustom,
  getDesativados, desativarBase,
  getCardapios, setCardapio,
  exportarDados, importarDados, limparTudoCustom,
} from "./admin-store.js";

const $ = (id) => document.getElementById(id);

// Dias úteis do formulário de cardápio (espelha DIAS_CARD do ui.js).
const DIAS_CARD = [["seg", "Segunda"], ["ter", "Terça"], ["qua", "Quarta"], ["qui", "Quinta"], ["sex", "Sexta"]];

export function initAdminUI({ locais, baseEventos = [], cb = {}, closePanel, showToast }) {
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

  return { abrirEditorPonto, abrirEditorPredio };
}
