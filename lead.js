// Ficha do lead (gaveta lateral) e cadastro de lead novo
import {
  sb, estado, h, campo, opcoes, toast, falha, q, janela, confirmar, chamarFuncao,
  dataHora, telefone, moeda, haQuanto, paraInputData, nomeMembro, nomeTime, etapa,
  souGeral, gerencio, souGerenteTime,
} from "./lib.js";

const TIPOS_ATIVIDADE = { nota: "Anotação", ligacao: "Ligação", whatsapp: "WhatsApp", email: "E-mail", visita: "Visita", sistema: "Sistema", etapa: "Etapa", whatsapp_recebido: "WhatsApp recebido" };
const ROTULO_VIA = { cliente: "", equipe: "Equipe", celular: "Celular da empresa", automacao: "Automação", robo: "Robô" };

// Quem pode receber o lead: gerente de time só escolhe gente do próprio time
export function corretoresPossiveis(timeId) {
  let lista = estado.equipe.filter((m) => m.ativo);
  if (souGerenteTime()) lista = lista.filter((m) => m.time_id === estado.eu.time_id);
  else if (timeId) lista = lista.filter((m) => m.time_id === timeId || !m.time_id);
  return lista;
}

export function novoLead(aoSalvar) {
  const nome = h("input", { required: true });
  const tel = h("input", { placeholder: "(32) 99999-9999" });
  const email = h("input", { type: "email" });
  const origem = h("select", {}, opcoes(["manual", "indicação", "site", "whatsapp", "meta ads", "google ads", "portal", "telefone", "visita ao stand"].map((o) => [o, o]), "manual"));
  const msg = h("textarea", { placeholder: "Interesse, observações…" });
  const valor = h("input", { type: "number", min: 0, step: 1000 });
  const time = h("select", {}, opcoes(estado.times.filter((t) => t.ativo), estado.filtroTime && estado.filtroTime !== "sem" ? estado.filtroTime : "", "Rodízio entre todos"));
  const corretor = h("select", {}, opcoes(corretoresPossiveis(), "", "Distribuir no rodízio"));
  time.addEventListener("change", () => corretor.replaceChildren(...opcoes(corretoresPossiveis(time.value || null), "", "Distribuir no rodízio")));

  const fechar = janela("Novo lead", h("form", { onsubmit: async (e) => {
    e.preventDefault();
    try {
      const reg = {
        imobiliaria_id: estado.empresaId, nome: nome.value.trim(), telefone: tel.value || null, email: email.value || null,
        origem: origem.value, mensagem: msg.value || null, valor_negocio: valor.value ? Number(valor.value) : null,
      };
      if (gerencio() && corretor.value) reg.corretor_id = corretor.value;
      if (souGeral() && time.value) reg.time_id = time.value;
      const lead = await q(sb.from("leads").insert(reg).select("id").single());
      fechar();
      toast("Lead cadastrado.");
      aoSalvar?.();
      abrirLead(lead.id, { aoMudar: aoSalvar });
    } catch (err) { falha(err); }
  } },
  campo("Nome", nome),
  h("div", { class: "linha" }, campo("Telefone / WhatsApp", tel), campo("E-mail", email)),
  h("div", { class: "linha" }, campo("Origem", origem), campo("Valor estimado (R$)", valor)),
  souGeral() && estado.times.length ? campo("Time", time) : null,
  gerencio() ? campo("Corretor", corretor) : null,
  campo("Mensagem", msg),
  h("button", { class: "btn primario", type: "submit" }, "Cadastrar")));
}

// ---------------- ficha ----------------
export async function abrirLead(id, { aba = "conversa", aoMudar } = {}) {
  const raiz = document.getElementById("modal-raiz");
  const corpo = h("div", { class: "gaveta-corpo" }, h("p", { class: "suave" }, "Carregando…"));
  const titulo = h("div", { style: { minWidth: 0 } });
  let canal = null;
  const fechar = () => { fundo.remove(); if (canal) sb.removeChannel(canal); if (mudou) aoMudar?.(); };
  let mudou = false;
  const gaveta = h("div", { class: "gaveta" },
    h("div", { class: "gaveta-topo" }, titulo, h("button", { class: "fechar", onclick: fechar, "aria-label": "Fechar" }, "×")), corpo);
  const fundo = h("div", { class: "fundo-modal", onclick: (e) => { if (e.target === fundo) fechar(); } }, gaveta);
  raiz.append(fundo);

  let lead, atividades, chat, tarefas, visitas, robo;
  async function carregar() {
    [lead, atividades, chat, tarefas, visitas, robo] = await Promise.all([
      q(sb.from("leads").select("*").eq("id", id).single()),
      q(sb.from("atividades").select("*").eq("lead_id", id).order("created_at")),
      q(sb.from("mensagens_chat").select("*").eq("lead_id", id).order("created_at")),
      q(sb.from("tarefas").select("*").eq("lead_id", id).order("vence_em")),
      q(sb.from("visitas").select("*").eq("lead_id", id).order("data_hora")),
      q(sb.from("robo_conversas").select("status, motivo").eq("lead_id", id).maybeSingle()),
    ]);
  }

  try { await carregar(); } catch (e) { corpo.replaceChildren(h("p", { class: "erro-txt" }, e.message)); return; }
  if (lead.nao_lidas > 0) { sb.from("leads").update({ nao_lidas: 0 }).eq("id", id).then(() => { mudou = true; }); }

  canal = sb.channel("lead-" + id)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensagens_chat", filter: `lead_id=eq.${id}` }, async () => {
      chat = await q(sb.from("mensagens_chat").select("*").eq("lead_id", id).order("created_at"));
      if (abaAtual === "conversa") desenharAba();
    }).subscribe();

  let abaAtual = aba;
  const areaAba = h("div");
  const abas = h("div", { class: "abas" });

  function desenhar() {
    const e = etapa(lead.etapa_id);
    titulo.replaceChildren(
      h("h2", { style: { margin: 0 } }, lead.nome),
      h("div", { class: "linha pequeno suave" },
        e ? h("span", { class: "etiqueta", style: { background: e.cor + "22", color: e.cor } }, e.nome) : null,
        lead.time_id ? h("span", { class: "etiqueta time" }, nomeTime(lead.time_id)) : null,
        h("span", {}, lead.origem), h("span", {}, "entrou há " + haQuanto(lead.created_at))));
    corpo.replaceChildren(dados(), h("div", { class: "cartao", style: { minWidth: 0 } }, abas, areaAba));
    desenharAbas();
  }

  function desenharAbas() {
    const lista = [["conversa", "Conversa"], ["historico", "Histórico"], ["tarefas", `Tarefas (${tarefas.filter((t) => !t.concluida_em).length})`], ["visitas", `Visitas (${visitas.length})`]];
    abas.replaceChildren(...lista.map(([k, t]) => h("button", { class: k === abaAtual ? "ativa" : "", onclick: () => { abaAtual = k; desenharAbas(); } }, t)));
    desenharAba();
  }

  function desenharAba() {
    const f = { conversa: abaConversa, historico: abaHistorico, tarefas: abaTarefas, visitas: abaVisitas }[abaAtual];
    areaAba.replaceChildren(f());
  }

  // ----- dados do lead -----
  function dados() {
    const nome = h("input", { value: lead.nome });
    const tel = h("input", { value: lead.telefone ?? "" });
    const email = h("input", { type: "email", value: lead.email ?? "" });
    const etapaSel = h("select", {}, opcoes(estado.etapas, lead.etapa_id));
    const motivo = h("input", { value: lead.motivo_perda ?? "", placeholder: "Ex.: comprou com outro, sem crédito…", list: "motivos-perda" });
    const campoMotivo = campo("Motivo da perda", motivo);
    const mostraMotivo = () => { campoMotivo.style.display = etapa(etapaSel.value)?.tipo === "perdido" ? "" : "none"; };
    etapaSel.addEventListener("change", mostraMotivo);
    const time = h("select", {}, opcoes(estado.times, lead.time_id, "Sem time"));
    const corretor = h("select", { disabled: !gerencio() }, opcoes(corretoresPossiveis(lead.time_id), lead.corretor_id, "Sem corretor"));
    const interesse = h("select", {}, opcoes([["venda", "Comprar"], ["locacao", "Alugar"], ["venda_locacao", "Comprar ou alugar"]], lead.interesse, "—"));
    const orcamento = h("input", { type: "number", min: 0, value: lead.orcamento ?? "" });
    const valor = h("input", { type: "number", min: 0, value: lead.valor_negocio ?? "" });
    const bairro = h("input", { value: lead.bairro_interesse ?? "" });
    const quartos = h("input", { type: "number", min: 0, max: 20, value: lead.quartos_interesse ?? "" });
    const mensagem = h("textarea", {}, lead.mensagem ?? "");

    const salvar = async () => {
      try {
        const upd = {
          nome: nome.value.trim(), telefone: tel.value || null, email: email.value || null, etapa_id: etapaSel.value,
          interesse: interesse.value || null, orcamento: orcamento.value ? Number(orcamento.value) : null,
          valor_negocio: valor.value ? Number(valor.value) : null, bairro_interesse: bairro.value || null,
          quartos_interesse: quartos.value ? Number(quartos.value) : null, mensagem: mensagem.value || null,
          motivo_perda: etapa(etapaSel.value)?.tipo === "perdido" ? (motivo.value || null) : lead.motivo_perda,
        };
        if (gerencio() && (corretor.value || null) !== lead.corretor_id) upd.corretor_id = corretor.value || null;
        if (souGeral() && (time.value || null) !== lead.time_id) upd.time_id = time.value || null;
        await q(sb.from("leads").update(upd).eq("id", id));
        mudou = true;
        await carregar();
        desenhar();
        toast("Lead salvo.");
      } catch (e) { falha(e); }
    };

    const qual = Object.entries(lead.qualificacao ?? {}).filter(([, v]) => v !== null && v !== "");
    const wa = lead.telefone ? "https://wa.me/55" + String(lead.telefone).replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "") : null;
    const caixa = h("div", { class: "cartao" },
      h("div", { class: "linha", style: { marginBottom: "10px" } },
        lead.telefone ? h("a", { class: "btn mini", href: "tel:" + lead.telefone }, "Ligar") : null,
        wa ? h("a", { class: "btn mini", href: wa, target: "_blank", rel: "noopener" }, "Abrir no WhatsApp") : null,
        h("span", { class: "espaco" }),
        gerencio() ? h("button", { class: "btn mini perigo", onclick: excluir }, "Excluir") : null),
      campo("Nome", nome),
      h("div", { class: "linha" }, campo("Telefone", tel), campo("E-mail", email)),
      campo("Etapa", etapaSel), campoMotivo,
      souGeral() && estado.times.length ? campo("Time", time) : null,
      campo("Corretor", corretor),
      h("div", { class: "linha" }, campo("Interesse", interesse), campo("Quartos", quartos)),
      h("div", { class: "linha" }, campo("Orçamento (R$)", orcamento), campo("Valor do negócio (R$)", valor)),
      campo("Região / bairro", bairro),
      campo("Mensagem", mensagem),
      h("button", { class: "btn primario", onclick: salvar }, "Salvar"),
      h("datalist", { id: "motivos-perda" }, ["Comprou com outro", "Sem crédito aprovado", "Desistiu da compra", "Preço acima do orçamento", "Não respondeu", "Localização", "Contato inválido"].map((m) => h("option", { value: m }))));
    mostraMotivo();

    const extra = h("div", { class: "cartao pequeno" },
      h("h3", {}, "Origem"),
      h("div", {}, "Entrou em ", dataHora(lead.created_at), " por ", h("strong", {}, lead.origem)),
      lead.anuncio_titulo || lead.anuncio_id ? h("div", {}, "Anúncio: ", lead.anuncio_url ? h("a", { href: lead.anuncio_url, target: "_blank", rel: "noopener" }, lead.anuncio_titulo ?? lead.anuncio_id) : (lead.anuncio_titulo ?? lead.anuncio_id)) : null,
      lead.anuncio_texto ? h("div", { class: "suave" }, lead.anuncio_texto) : null,
      qual.length ? [h("h3", { style: { marginTop: "12px" } }, "Qualificação do robô"), ...qual.map(([k, v]) => h("div", {}, h("span", { class: "suave" }, k + ": "), String(v)))] : null);
    return h("div", {}, caixa, extra);
  }

  async function excluir() {
    if (!confirmar(`Excluir o lead ${lead.nome}? Isso apaga o histórico dele e não tem volta.`)) return;
    try {
      await q(sb.from("leads").delete().eq("id", id));
      mudou = true;
      fechar();
      toast("Lead excluído.");
    } catch (e) { falha(e); }
  }

  // ----- conversa -----
  function abaConversa() {
    const linha = h("div", { class: "linha-tempo" });
    const eventos = chat.map((m) => ({ ...m, _t: "chat" }));
    if (!eventos.length) linha.append(h("p", { class: "suave" }, estado.whatsapp ? "Nenhuma mensagem ainda. Escreva abaixo para começar a conversa." : "O WhatsApp da empresa ainda não está conectado. As mensagens que você mandar abrem no WhatsApp e ficam registradas no histórico."));
    for (const m of eventos) {
      const saida = m.direcao === "saida";
      linha.append(h("div", { class: "bolha" + (saida ? " saida" : "") + (m.via === "robo" ? " robo" : "") },
        m.texto,
        h("span", { class: "quando" }, [ROTULO_VIA[m.via] || (m.autor_id ? nomeMembro(m.autor_id) : ""), dataHora(m.created_at)].filter(Boolean).join(" · "))));
    }
    setTimeout(() => { linha.scrollTop = linha.scrollHeight; }, 0);

    const texto = h("textarea", { placeholder: estado.whatsapp ? "Escreva a mensagem…" : "Escreva a mensagem (abre no WhatsApp)…", rows: 2 });
    const enviar = h("button", { class: "btn primario" }, "Enviar");
    enviar.addEventListener("click", async () => {
      const t = texto.value.trim();
      if (!t) return;
      if (!lead.telefone) return toast("Este lead não tem telefone.", true);
      enviar.disabled = true;
      try {
        if (estado.whatsapp) {
          const m = await q(sb.from("mensagens_whatsapp").insert({ imobiliaria_id: estado.empresaId, lead_id: id, telefone: lead.telefone, texto: t, responsavel_id: estado.usuario.id }).select("id").single());
          const r = await chamarFuncao("whatsapp-enviar", { mensagem_ids: [m.id] });
          if (r?.erros) throw new Error(r.detalhes?.[0]?.erro ?? "Não foi possível enviar.");
        } else {
          window.open("https://wa.me/55" + String(lead.telefone).replace(/\D/g, "") + "?text=" + encodeURIComponent(t), "_blank", "noopener");
          await q(sb.from("atividades").insert({ imobiliaria_id: estado.empresaId, lead_id: id, autor_id: estado.usuario.id, tipo: "whatsapp", descricao: t }));
        }
        texto.value = "";
        mudou = true;
        await carregar();
        desenharAba();
      } catch (e) { falha(e); } finally { enviar.disabled = false; }
    });
    texto.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) enviar.click(); });

    const modelos = h("select", { style: { width: "auto" }, onchange: async (e) => {
      if (!e.target.value) return;
      const mm = (await q(sb.from("modelos_mensagem").select("texto").eq("id", e.target.value).single())).texto;
      const primeiro = (lead.nome ?? "").split(" ")[0];
      texto.value = mm.replaceAll("{primeiro_nome}", primeiro).replaceAll("{nome}", lead.nome).replaceAll("{corretor}", nomeMembro(lead.corretor_id) || estado.eu?.nome || "")
        .replaceAll("{imobiliaria}", estado.empresa.nome).replaceAll("{empresa}", estado.empresa.nome);
      e.target.value = "";
    } }, h("option", { value: "" }, "Mensagens prontas…"));
    sb.from("modelos_mensagem").select("id, nome").eq("imobiliaria_id", estado.empresaId).eq("ativo", true).order("nome")
      .then(({ data }) => modelos.append(...(data ?? []).map((m) => h("option", { value: m.id }, m.nome))));

    const roboBotao = !estado.whatsapp ? null : robo?.status === "ativo"
      ? h("button", { class: "btn mini", onclick: async () => { try { await q(sb.rpc("robo_parar_lead", { p_lead_id: id })); robo = { status: "parado" }; toast("Robô parado; a conversa é sua."); desenharAba(); } catch (e) { falha(e); } } }, "Parar o robô")
      : h("button", { class: "btn mini", onclick: async () => { try { const r = await q(sb.rpc("robo_iniciar_lead", { p_lead_id: id })); toast(r || "Robô iniciado."); robo = { status: "ativo" }; desenharAba(); } catch (e) { falha(e); } } }, "Qualificar com o robô");

    return h("div", {},
      robo?.status === "ativo" ? h("p", { class: "etiqueta amarela" }, "O robô está conversando com este lead") : null,
      linha,
      h("div", { class: "linha", style: { marginTop: "8px" } }, modelos, roboBotao),
      h("div", { class: "compositor" }, texto, enviar));
  }

  // ----- histórico -----
  function abaHistorico() {
    const tipo = h("select", { style: { width: "auto" } }, opcoes([["nota", "Anotação"], ["ligacao", "Ligação"], ["whatsapp", "WhatsApp"], ["email", "E-mail"], ["visita", "Visita"]], "nota"));
    const texto = h("textarea", { placeholder: "O que aconteceu?" });
    const lista = h("div", { class: "linha-tempo" });
    for (const a of [...atividades].reverse()) {
      lista.append(h("div", { class: "bolha" + (a.tipo === "sistema" || a.tipo === "etapa" ? " evento" : "") },
        h("strong", {}, TIPOS_ATIVIDADE[a.tipo] ?? a.tipo), " ", a.descricao,
        h("span", { class: "quando" }, [a.autor_id ? nomeMembro(a.autor_id) : null, dataHora(a.created_at)].filter(Boolean).join(" · "))));
    }
    return h("div", {},
      h("div", { class: "compositor" }, tipo, texto, h("button", { class: "btn primario", onclick: async () => {
        if (!texto.value.trim()) return;
        try {
          await q(sb.from("atividades").insert({ imobiliaria_id: estado.empresaId, lead_id: id, autor_id: estado.usuario.id, tipo: tipo.value, descricao: texto.value.trim() }));
          mudou = true;
          await carregar();
          desenharAba();
        } catch (e) { falha(e); }
      } }, "Registrar")),
      h("div", { style: { marginTop: "12px" } }, lista));
  }

  // ----- tarefas -----
  function abaTarefas() {
    const tituloT = h("input", { placeholder: "Ex.: Ligar para confirmar documentos" });
    const quando = h("input", { type: "datetime-local", value: paraInputData(new Date(Date.now() + 86400000)) });
    const resp = h("select", { style: { width: "auto" } }, opcoes(corretoresPossiveis(lead.time_id), lead.corretor_id ?? estado.usuario.id));
    const lista = h("table", { class: "tabela" }, h("tbody", {}, tarefas.map((t) => h("tr", {},
      h("td", {}, h("input", { type: "checkbox", style: { width: "auto" }, checked: !!t.concluida_em, onchange: async (e) => {
        try { await q(sb.from("tarefas").update({ concluida_em: e.target.checked ? new Date().toISOString() : null }).eq("id", t.id)); mudou = true; await carregar(); desenharAbas(); } catch (err) { falha(err); }
      } })),
      h("td", { style: { textDecoration: t.concluida_em ? "line-through" : "" } }, t.titulo, t.automatica ? h("span", { class: "suave pequeno" }, " · automática") : null),
      h("td", { class: "pequeno " + (!t.concluida_em && t.vence_em && new Date(t.vence_em) < new Date() ? "erro-txt" : "suave") }, dataHora(t.vence_em)),
      h("td", { class: "pequeno suave" }, nomeMembro(t.responsavel_id))))));
    return h("div", {},
      h("div", { class: "linha" }, h("div", { class: "campo", style: { flex: 2 } }, h("label", {}, "Nova tarefa"), tituloT), campo("Para quando", quando), gerencio() ? campo("Responsável", resp) : null),
      h("button", { class: "btn primario", onclick: async () => {
        if (!tituloT.value.trim()) return;
        try {
          await q(sb.from("tarefas").insert({ imobiliaria_id: estado.empresaId, lead_id: id, titulo: tituloT.value.trim(), vence_em: new Date(quando.value).toISOString(), responsavel_id: gerencio() ? resp.value : estado.usuario.id, tipo: "outro" }));
          mudou = true; await carregar(); desenharAbas();
        } catch (e) { falha(e); }
      } }, "Adicionar tarefa"),
      h("div", { style: { marginTop: "12px" } }, tarefas.length ? lista : h("p", { class: "suave" }, "Nenhuma tarefa.")));
  }

  // ----- visitas -----
  function abaVisitas() {
    const quando = h("input", { type: "datetime-local", value: paraInputData(new Date(Date.now() + 86400000)) });
    const obs = h("input", { placeholder: "Local, empreendimento, unidade…" });
    const STATUS = { agendada: "Agendada", realizada: "Realizada", cancelada: "Cancelada", nao_compareceu: "Não compareceu" };
    return h("div", {},
      h("div", { class: "linha" }, campo("Data e hora", quando), h("div", { class: "campo", style: { flex: 2 } }, h("label", {}, "Observações"), obs)),
      h("button", { class: "btn primario", onclick: async () => {
        try {
          await q(sb.from("visitas").insert({ imobiliaria_id: estado.empresaId, lead_id: id, corretor_id: lead.corretor_id ?? estado.usuario.id, data_hora: new Date(quando.value).toISOString(), observacoes: obs.value || null }));
          toast("Visita agendada. O lead foi para \"Visita agendada\".");
          mudou = true; await carregar(); desenhar();
        } catch (e) { falha(e); }
      } }, "Agendar visita"),
      h("table", { class: "tabela", style: { marginTop: "12px" } }, h("tbody", {}, visitas.map((v) => h("tr", {},
        h("td", {}, dataHora(v.data_hora)),
        h("td", {}, v.observacoes ?? ""),
        h("td", {}, h("select", { style: { width: "auto" }, onchange: async (e) => {
          try { await q(sb.from("visitas").update({ status: e.target.value }).eq("id", v.id)); mudou = true; await carregar(); } catch (err) { falha(err); }
        } }, opcoes(Object.entries(STATUS), v.status))))))));
  }

  desenhar();
}

export function resumoLead(l) {
  return [telefone(l.telefone), l.valor_negocio ? moeda(l.valor_negocio) : null].filter(Boolean).join(" · ");
}
