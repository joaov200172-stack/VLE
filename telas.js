// Telas do dia a dia: painel, funil, leads, conversas, tarefas e relatórios
import {
  sb, estado, h, campo, opcoes, toast, falha, q, comFiltroTime, janela,
  dataHora, telefone, moeda, haQuanto, paraInputData, nomeMembro, nomeTime, etapa,
  souGeral, gerencio,
} from "./lib.js";
import { abrirLead, novoLead, corretoresPossiveis } from "./lead.js";

const CAMPOS_LEAD = "id, nome, telefone, origem, corretor_id, time_id, etapa_id, etapa_desde, nao_lidas, valor_negocio, orcamento, created_at, ultimo_contato_em, ultima_mensagem_em";
const timeDoFiltro = () => (souGeral() && estado.filtroTime && estado.filtroTime !== "sem" ? estado.filtroTime : null);

function seletorPeriodo(valor, aoMudar) {
  return h("select", { style: { width: "auto" }, onchange: (e) => aoMudar(Number(e.target.value)) },
    opcoes([[7, "Últimos 7 dias"], [30, "Últimos 30 dias"], [90, "Últimos 90 dias"], [365, "Últimos 12 meses"]], valor));
}

function tabela(colunas, linhas, vazio = "Nada por aqui ainda.") {
  if (!linhas.length) return h("p", { class: "suave" }, vazio);
  return h("div", { class: "rolagem-x" }, h("table", { class: "tabela" },
    h("thead", {}, h("tr", {}, colunas.map((c) => h("th", {}, c)))),
    h("tbody", {}, linhas.map((l) => h("tr", {}, l.map((c) => h("td", {}, c)))))));
}

// ---------------- painel ----------------
export async function telaPainel(el) {
  let dias = Number(localStorage.getItem("vle:dias") || 30);
  async function desenhar() {
    el.replaceChildren(h("p", { class: "suave" }, "Carregando…"));
    const p = await q(sb.rpc("painel_time", { p_imobiliaria_id: estado.empresaId, p_dias: dias, p_time_id: timeDoFiltro() }));
    let porTime = null;
    if (souGeral() && estado.times.length && !estado.filtroTime) {
      const desde = new Date(Date.now() - dias * 86400000).toISOString();
      const leads = await q(sb.from("leads").select("time_id, etapa_id").eq("imobiliaria_id", estado.empresaId).gte("created_at", desde).limit(10000));
      const mapa = new Map();
      for (const l of leads) {
        const k = l.time_id ?? "sem";
        const r = mapa.get(k) ?? { total: 0, ganhos: 0, abertos: 0 };
        r.total++;
        const t = etapa(l.etapa_id)?.tipo;
        if (t === "ganho") r.ganhos++;
        if (t === "aberta") r.abertos++;
        mapa.set(k, r);
      }
      porTime = [...estado.times.map((t) => [t.id, t.nome]), ["sem", "Sem time"]].filter(([k]) => mapa.has(k))
        .map(([k, nome]) => { const r = mapa.get(k); return [nome, r.total, r.abertos, r.ganhos, r.total ? Math.round((r.ganhos / r.total) * 100) + "%" : "—"]; });
    }
    const conv = p.total_leads ? Math.round((p.ganhos / p.total_leads) * 100) : 0;
    el.replaceChildren(
      h("div", { class: "linha", style: { marginBottom: "14px" } }, h("h1", { style: { margin: 0 } }, "Painel"), h("span", { class: "espaco" }),
        seletorPeriodo(dias, (d) => { dias = d; localStorage.setItem("vle:dias", d); desenhar().catch(falha); }),
        h("button", { class: "btn primario", onclick: () => novoLead(() => desenhar().catch(falha)) }, "+ Novo lead")),
      h("div", { class: "grade" },
        indicador("Leads no período", p.total_leads),
        indicador("Em aberto", p.em_aberto),
        indicador("Negócios fechados", p.ganhos, conv + "% de conversão"),
        indicador("Perdidos", p.perdidos),
        indicador("1ª resposta (média)", p.tempo_medio_resposta_min !== null ? p.tempo_medio_resposta_min + " min" : "—"),
        indicador("Tarefas atrasadas", p.tarefas_atrasadas),
        indicador("Visitas nos próximos 7 dias", p.visitas_proximos_7_dias)),
      porTime ? h("div", { class: "cartao" }, h("h3", {}, "Por time"), tabela(["Time", "Leads", "Em aberto", "Fechados", "Conversão"], porTime)) : null,
      h("div", { class: "cartao" }, h("h3", {}, "Por corretor"),
        tabela(["Corretor", "Leads", "Fechados", "1ª resposta"], (p.por_corretor ?? []).map((c) => [c.corretor, c.total, c.ganhos, c.resposta_min !== null ? c.resposta_min + " min" : "—"]))),
      h("div", { class: "cartao" }, h("h3", {}, "Por origem"),
        tabela(["Origem", "Leads", "Fechados"], (p.por_origem ?? []).map((c) => [c.origem, c.total, c.ganhos]))),
      h("div", { class: "cartao" }, h("h3", {}, "Leads por anúncio"),
        tabela(["Anúncio", "Leads", "Atendidos", "Fechados"], (p.por_anuncio ?? []).map((c) => [c.url ? h("a", { href: c.url, target: "_blank", rel: "noopener" }, c.anuncio) : c.anuncio, c.total, c.atendidos, c.ganhos]), "Nenhum lead de anúncio no período.")));
  }
  await desenhar();
}

function indicador(rotulo, valor, sub) {
  return h("div", { class: "cartao", style: { marginBottom: 0 } }, h("div", { class: "suave pequeno" }, rotulo), h("div", { class: "numero" }, valor ?? 0), sub ? h("div", { class: "suave pequeno" }, sub) : null);
}

// ---------------- funil ----------------
export async function telaFunil(el) {
  let busca = "", corretor = "";
  const caixa = h("div", { class: "funil" });
  const inputBusca = h("input", { placeholder: "Buscar nome ou telefone", style: { maxWidth: "240px" }, oninput: (e) => { busca = e.target.value.trim().toLowerCase(); desenharColunas(); } });
  const selCorretor = gerencio() ? h("select", { style: { width: "auto" }, onchange: (e) => { corretor = e.target.value; desenharColunas(); } }, opcoes(corretoresPossiveis(timeDoFiltro()), "", "Todos os corretores")) : null;
  el.replaceChildren(
    h("div", { class: "linha", style: { marginBottom: "12px" } }, h("h1", { style: { margin: 0 } }, "Funil"), h("span", { class: "espaco" }), inputBusca, selCorretor,
      h("button", { class: "btn primario", onclick: () => novoLead(carregar) }, "+ Novo lead")),
    caixa);

  let leads = [];
  async function carregar() {
    const limite = new Date(Date.now() - 60 * 86400000).toISOString();
    // fechados e perdidos aparecem só dos últimos 60 dias
    const fechados = estado.etapas.filter((e) => e.tipo !== "aberta").map((e) => e.id);
    let c = sb.from("leads").select(CAMPOS_LEAD).eq("imobiliaria_id", estado.empresaId).order("updated_at", { ascending: false }).limit(2000);
    c = comFiltroTime(c);
    if (fechados.length) c = c.or(`etapa_id.not.in.(${fechados.join(",")}),updated_at.gte.${limite}`);
    leads = await q(c);
    desenharColunas();
  }

  function desenharColunas() {
    const filtrados = leads.filter((l) => (!busca || l.nome.toLowerCase().includes(busca) || (l.telefone ?? "").includes(busca.replace(/\D/g, "") || "§")) && (!corretor || l.corretor_id === corretor));
    caixa.replaceChildren(...estado.etapas.map((e) => {
      const daEtapa = filtrados.filter((l) => l.etapa_id === e.id);
      const soma = daEtapa.reduce((s, l) => s + Number(l.valor_negocio ?? l.orcamento ?? 0), 0);
      const lista = h("div", { class: "coluna-lista" }, daEtapa.map((l) => cartaoLead(l, e)));
      const col = h("div", { class: "coluna", style: { "--cor": e.cor } },
        h("div", { class: "coluna-topo" }, e.nome, h("span", { class: "etiqueta" }, daEtapa.length), h("span", { class: "soma" }, soma ? moeda(soma) : "")), lista);
      col.addEventListener("dragover", (ev) => { ev.preventDefault(); col.classList.add("alvo"); });
      col.addEventListener("dragleave", () => col.classList.remove("alvo"));
      col.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        col.classList.remove("alvo");
        const id = ev.dataTransfer.getData("text/plain");
        const l = leads.find((x) => x.id === id);
        if (!l || l.etapa_id === e.id) return;
        const upd = { etapa_id: e.id };
        if (e.tipo === "perdido") {
          const motivo = window.prompt("Motivo da perda (opcional):", "");
          if (motivo === null) return;
          upd.motivo_perda = motivo || null;
        }
        const antes = l.etapa_id;
        l.etapa_id = e.id;
        l.etapa_desde = new Date().toISOString();
        desenharColunas();
        try { await q(sb.from("leads").update(upd).eq("id", id)); } catch (err) { l.etapa_id = antes; desenharColunas(); falha(err); }
      });
      return col;
    }));
  }

  function cartaoLead(l, e) {
    const atrasado = e.tipo === "aberta" && e.sla_horas && Date.now() - new Date(l.etapa_desde).getTime() > e.sla_horas * 3600000;
    const c = h("div", { class: "card-lead" + (atrasado ? " atrasado" : ""), draggable: "true", onclick: () => abrirLead(l.id, { aoMudar: carregar }) },
      h("div", { class: "nome" }, l.nome, l.nao_lidas ? h("span", { class: "bolinha" }, l.nao_lidas) : null),
      h("div", { class: "info" },
        l.telefone ? h("span", {}, telefone(l.telefone)) : null,
        l.valor_negocio || l.orcamento ? h("span", {}, moeda(l.valor_negocio ?? l.orcamento)) : null),
      h("div", { class: "info" },
        h("span", {}, nomeMembro(l.corretor_id) || "Sem corretor"),
        souGeral() && l.time_id ? h("span", { class: "etiqueta time" }, nomeTime(l.time_id)) : null,
        h("span", { title: "Tempo nesta etapa" }, haQuanto(l.etapa_desde))));
    c.addEventListener("dragstart", (ev) => ev.dataTransfer.setData("text/plain", l.id));
    return c;
  }

  await carregar();
  const canal = sb.channel("funil-" + estado.empresaId)
    .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `imobiliaria_id=eq.${estado.empresaId}` }, () => { clearTimeout(canal._t); canal._t = setTimeout(() => carregar().catch(() => {}), 800); })
    .subscribe();
  return { sair: () => sb.removeChannel(canal) };
}

// ---------------- leads ----------------
export async function telaLeads(el) {
  let busca = "", filtroEtapa = "", filtroCorretor = "", filtroOrigem = "", pagina = 0, espera = null;
  const POR_PAGINA = 50;
  const corpo = h("div");
  const total = h("span", { class: "suave pequeno" });
  el.replaceChildren(
    h("div", { class: "linha", style: { marginBottom: "12px" } }, h("h1", { style: { margin: 0 } }, "Leads"), total, h("span", { class: "espaco" }),
      h("button", { class: "btn", onclick: exportar }, "Exportar CSV"),
      h("button", { class: "btn primario", onclick: () => novoLead(carregar) }, "+ Novo lead")),
    h("div", { class: "cartao" },
      h("div", { class: "linha" },
        h("input", { placeholder: "Buscar nome, telefone ou e-mail", style: { maxWidth: "280px" }, oninput: (e) => { busca = e.target.value.trim(); pagina = 0; clearTimeout(espera); espera = setTimeout(carregar, 300); } }),
        h("select", { style: { width: "auto" }, onchange: (e) => { filtroEtapa = e.target.value; pagina = 0; carregar(); } }, opcoes(estado.etapas, "", "Todas as etapas")),
        gerencio() ? h("select", { style: { width: "auto" }, onchange: (e) => { filtroCorretor = e.target.value; pagina = 0; carregar(); } }, opcoes(corretoresPossiveis(timeDoFiltro()), "", "Todos os corretores")) : null,
        h("input", { placeholder: "Origem", style: { maxWidth: "140px" }, onchange: (e) => { filtroOrigem = e.target.value.trim(); pagina = 0; carregar(); } })),
      corpo));

  function consulta(campos, comContagem) {
    let c = sb.from("leads").select(campos, comContagem ? { count: "exact" } : undefined).eq("imobiliaria_id", estado.empresaId);
    c = comFiltroTime(c);
    if (filtroEtapa) c = c.eq("etapa_id", filtroEtapa);
    if (filtroCorretor) c = c.eq("corretor_id", filtroCorretor);
    if (filtroOrigem) c = c.ilike("origem", `%${filtroOrigem}%`);
    if (busca) {
      const d = busca.replace(/\D/g, "");
      const termo = busca.replace(/[,()]/g, " ");
      c = c.or([`nome.ilike.%${termo}%`, `email.ilike.%${termo}%`, d.length >= 4 ? `telefone.ilike.%${d}%` : null].filter(Boolean).join(","));
    }
    return c.order("created_at", { ascending: false });
  }

  async function carregar() {
    try {
      const { data, count, error } = await consulta(CAMPOS_LEAD + ", email", true).range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
      if (error) throw error;
      total.textContent = `${count ?? 0} leads`;
      corpo.replaceChildren(
        h("div", { class: "rolagem-x" }, h("table", { class: "tabela" },
          h("thead", {}, h("tr", {}, ["Nome", "Telefone", "Etapa", "Corretor", souGeral() ? "Time" : null, "Origem", "Entrou"].filter(Boolean).map((c) => h("th", {}, c)))),
          h("tbody", {}, data.map((l) => {
            const e = etapa(l.etapa_id);
            return h("tr", { class: "clicavel", onclick: () => abrirLead(l.id, { aoMudar: carregar }) },
              h("td", {}, h("strong", {}, l.nome), l.nao_lidas ? [" ", h("span", { class: "bolinha" }, l.nao_lidas)] : null),
              h("td", {}, telefone(l.telefone)),
              h("td", {}, e ? h("span", { class: "etiqueta", style: { background: e.cor + "22", color: e.cor } }, e.nome) : ""),
              h("td", {}, nomeMembro(l.corretor_id) || h("span", { class: "suave" }, "—")),
              souGeral() ? h("td", {}, l.time_id ? h("span", { class: "etiqueta time" }, nomeTime(l.time_id)) : h("span", { class: "suave" }, "—")) : null,
              h("td", {}, l.origem),
              h("td", { class: "suave pequeno" }, dataHora(l.created_at)));
          })))),
        !data.length ? h("p", { class: "suave" }, "Nenhum lead encontrado.") : null,
        h("div", { class: "linha", style: { marginTop: "10px" } },
          h("button", { class: "btn mini", disabled: pagina === 0, onclick: () => { pagina--; carregar(); } }, "← Anteriores"),
          h("span", { class: "suave pequeno" }, `Página ${pagina + 1}`),
          h("button", { class: "btn mini", disabled: (pagina + 1) * POR_PAGINA >= (count ?? 0), onclick: () => { pagina++; carregar(); } }, "Próximos →")));
    } catch (e) { falha(e); }
  }

  async function exportar() {
    try {
      const dados = await q(consulta("nome, telefone, email, origem, etapa_id, corretor_id, time_id, valor_negocio, created_at, motivo_perda").limit(10000));
      const linhas = [["Nome", "Telefone", "E-mail", "Origem", "Etapa", "Corretor", "Time", "Valor", "Entrou em", "Motivo da perda"]];
      for (const l of dados) linhas.push([l.nome, l.telefone, l.email, l.origem, etapa(l.etapa_id)?.nome, nomeMembro(l.corretor_id), nomeTime(l.time_id), l.valor_negocio, dataHora(l.created_at), l.motivo_perda]);
      const csv = linhas.map((r) => r.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(";")).join("\n");
      const a = h("a", { href: URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })), download: "leads.csv" });
      a.click();
    } catch (e) { falha(e); }
  }

  await carregar();
}

// ---------------- conversas ----------------
export async function telaConversas(el) {
  let filtro = "todas", busca = "";
  const lista = h("div", { class: "lista-conversas" });
  el.replaceChildren(
    h("div", { class: "linha", style: { marginBottom: "12px" } }, h("h1", { style: { margin: 0 } }, "Conversas"),
      estado.whatsapp ? null : h("span", { class: "etiqueta amarela" }, "WhatsApp não conectado")),
    h("div", { class: "cartao" },
      h("div", { class: "linha", style: { marginBottom: "8px" } },
        h("select", { style: { width: "auto" }, onchange: (e) => { filtro = e.target.value; carregar(); } },
          opcoes([["todas", "Todas"], ["nao_lidas", "Não lidas"], ["minhas", "Minhas"], ["robo", "Com o robô"]], filtro)),
        h("input", { placeholder: "Buscar nome ou telefone", style: { maxWidth: "260px" }, oninput: (e) => { busca = e.target.value; clearTimeout(lista._t); lista._t = setTimeout(carregar, 300); } })),
      lista));

  async function carregar() {
    try {
      let itens = await q(sb.rpc("caixa_entrada", { p_imobiliaria_id: estado.empresaId, p_filtro: filtro, p_busca: busca || null, p_limite: 200 }));
      if (souGeral() && estado.filtroTime) {
        const ids = itens.map((i) => i.lead_id);
        if (ids.length) {
          let c = sb.from("leads").select("id").in("id", ids);
          c = comFiltroTime(c);
          const ok = new Set((await q(c)).map((x) => x.id));
          itens = itens.filter((i) => ok.has(i.lead_id));
        }
      }
      lista.replaceChildren(...(itens.length ? itens.map((i) => h("div", { class: "item", onclick: () => abrirLead(i.lead_id, { aoMudar: carregar }) },
        h("div", { class: "linha" }, h("strong", {}, i.nome), i.nao_lidas ? h("span", { class: "bolinha" }, i.nao_lidas) : null,
          i.robo_status === "ativo" ? h("span", { class: "etiqueta amarela" }, "robô") : null,
          h("span", { class: "espaco" }), h("span", { class: "suave pequeno" }, haQuanto(i.ultima_em))),
        h("div", { class: "suave pequeno", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
          i.ultima_direcao === "saida" ? "Você: " : "", i.ultimo_texto ?? ""),
        h("div", { class: "suave pequeno" }, [telefone(i.telefone), nomeMembro(i.corretor_id)].filter(Boolean).join(" · "))))
        : [h("p", { class: "suave" }, "Nenhuma conversa.")]));
    } catch (e) { falha(e); }
  }
  await carregar();
  const canal = sb.channel("conversas-" + estado.empresaId)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensagens_chat", filter: `imobiliaria_id=eq.${estado.empresaId}` }, () => carregar())
    .subscribe();
  return { sair: () => sb.removeChannel(canal) };
}

// ---------------- tarefas ----------------
export async function telaTarefas(el) {
  let quem = "minhas", mostrarFeitas = false;
  const corpo = h("div");
  el.replaceChildren(
    h("div", { class: "linha", style: { marginBottom: "12px" } }, h("h1", { style: { margin: 0 } }, "Tarefas"), h("span", { class: "espaco" }),
      gerencio() ? h("select", { style: { width: "auto" }, onchange: (e) => { quem = e.target.value; carregar(); } }, opcoes([["minhas", "Minhas"], ["todas", "Da equipe"]], quem)) : null,
      h("label", { class: "linha pequeno" }, h("input", { type: "checkbox", style: { width: "auto" }, onchange: (e) => { mostrarFeitas = e.target.checked; carregar(); } }), "Mostrar concluídas"),
      h("button", { class: "btn primario", onclick: nova }, "+ Nova tarefa")),
    h("div", { class: "cartao" }, corpo));

  async function carregar() {
    try {
      let c = sb.from("tarefas").select("*, leads(nome, time_id)").eq("imobiliaria_id", estado.empresaId).order("vence_em", { ascending: true, nullsFirst: false }).limit(300);
      if (quem === "minhas") c = c.eq("responsavel_id", estado.usuario.id);
      if (!mostrarFeitas) c = c.is("concluida_em", null);
      let tarefas = await q(c);
      if (souGeral() && estado.filtroTime) {
        const doTime = (t) => { const tm = t.leads?.time_id ?? estado.equipe.find((m) => m.user_id === t.responsavel_id)?.time_id ?? null; return estado.filtroTime === "sem" ? !tm : tm === estado.filtroTime; };
        tarefas = tarefas.filter(doTime);
      }
      const agora = Date.now();
      corpo.replaceChildren(tarefas.length ? h("div", { class: "rolagem-x" }, h("table", { class: "tabela" }, h("tbody", {}, tarefas.map((t) => h("tr", {},
        h("td", { style: { width: "30px" } }, h("input", { type: "checkbox", style: { width: "auto" }, checked: !!t.concluida_em, onchange: async (e) => {
          try { await q(sb.from("tarefas").update({ concluida_em: e.target.checked ? new Date().toISOString() : null }).eq("id", t.id)); carregar(); } catch (err) { falha(err); }
        } })),
        h("td", {}, h("div", { style: { textDecoration: t.concluida_em ? "line-through" : "" } }, t.titulo),
          t.leads ? h("a", { href: "#", class: "pequeno", onclick: (e) => { e.preventDefault(); abrirLead(t.lead_id, { aba: "tarefas", aoMudar: carregar }); } }, t.leads.nome) : null),
        h("td", { class: "pequeno " + (!t.concluida_em && t.vence_em && new Date(t.vence_em).getTime() < agora ? "erro-txt" : "suave") }, dataHora(t.vence_em)),
        h("td", { class: "pequeno suave" }, nomeMembro(t.responsavel_id))))))) : h("p", { class: "suave" }, "Nenhuma tarefa pendente. 🎉"));
    } catch (e) { falha(e); }
  }

  function nova() {
    const titulo = h("input", { required: true });
    const quando = h("input", { type: "datetime-local", value: paraInputData(new Date(Date.now() + 3600000)) });
    const resp = h("select", {}, opcoes(corretoresPossiveis(), estado.usuario.id));
    const fechar = janela("Nova tarefa", h("form", { onsubmit: async (e) => {
      e.preventDefault();
      try {
        await q(sb.from("tarefas").insert({ imobiliaria_id: estado.empresaId, titulo: titulo.value.trim(), vence_em: new Date(quando.value).toISOString(), responsavel_id: gerencio() ? resp.value : estado.usuario.id, tipo: "outro" }));
        fechar(); carregar();
      } catch (err) { falha(err); }
    } }, campo("O que fazer", titulo), campo("Para quando", quando), gerencio() ? campo("Responsável", resp) : null, h("button", { class: "btn primario", type: "submit" }, "Criar")));
  }

  await carregar();
}

// ---------------- relatórios ----------------
export async function telaRelatorios(el) {
  let dias = Number(localStorage.getItem("vle:dias") || 30);
  async function desenhar() {
    el.replaceChildren(h("p", { class: "suave" }, "Carregando…"));
    const r = await q(sb.rpc("relatorio_time", { p_imobiliaria_id: estado.empresaId, p_dias: dias, p_time_id: timeDoFiltro() }));
    const res = r.resumo ?? {};
    const maxFunil = Math.max(1, ...(r.funil ?? []).map((f) => f.alcancaram));
    el.replaceChildren(
      h("div", { class: "linha", style: { marginBottom: "14px" } }, h("h1", { style: { margin: 0 } }, "Relatórios"), h("span", { class: "espaco" }),
        seletorPeriodo(dias, (d) => { dias = d; localStorage.setItem("vle:dias", d); desenhar().catch(falha); })),
      souGeral() && estado.filtroTime === "sem" ? h("p", { class: "suave pequeno" }, "O relatório mostra todos os leads; escolha um time no topo para ver só o dele.") : null,
      h("div", { class: "grade" },
        indicador("Leads", res.total), indicador("Fechados", res.ganhos, moeda(res.valor_ganho)),
        indicador("Em aberto", res.abertos, moeda(res.valor_aberto)), indicador("Perdidos", res.perdidos, moeda(res.valor_perdido)),
        indicador("Ciclo de venda", res.ciclo_dias !== null && res.ciclo_dias !== undefined ? res.ciclo_dias + " dias" : "—")),
      h("div", { class: "cartao" }, h("h3", {}, "Funil (quantos chegaram a cada etapa)"),
        ...(r.funil ?? []).map((f) => h("div", { style: { marginBottom: "8px" } },
          h("div", { class: "linha pequeno" }, h("strong", {}, f.nome), h("span", { class: "espaco" }), `${f.alcancaram} chegaram · ${f.agora} agora · ${moeda(f.valor_agora)}`),
          h("div", { class: "barra" }, h("span", { style: { width: (f.alcancaram / maxFunil) * 100 + "%", background: f.cor } }))))),
      h("div", { class: "cartao" }, h("h3", {}, "Tempo médio em cada etapa"),
        tabela(["Etapa", "Horas", "Passagens"], (r.tempo_etapa ?? []).map((t) => [t.nome, t.horas, t.passagens]))),
      h("div", { class: "cartao" }, h("h3", {}, "Por corretor"),
        tabela(["Corretor", "Leads", "Fechados", "Perdidos", "Valor fechado"], (r.por_corretor ?? []).map((c) => [c.corretor, c.total, c.ganhos, c.perdidos, moeda(c.valor_ganho)]))),
      h("div", { class: "cartao" }, h("h3", {}, "Por origem"),
        tabela(["Origem", "Leads", "Fechados", "Perdidos"], (r.por_origem ?? []).map((c) => [c.origem, c.total, c.ganhos, c.perdidos]))),
      h("div", { class: "cartao" }, h("h3", {}, "Motivos de perda"),
        tabela(["Motivo", "Leads", "Valor"], (r.perdas ?? []).map((c) => [c.motivo, c.total, moeda(c.valor)]))),
      r.robo?.iniciadas ? h("div", { class: "cartao" }, h("h3", {}, "Robô de qualificação"),
        tabela(["Iniciadas", "Concluídas", "Pediram corretor", "Sem resposta", "Equipe assumiu"], [[r.robo.iniciadas, r.robo.concluidas, r.robo.pediram_corretor, r.robo.sem_resposta, r.robo.equipe_assumiu]])) : null);
  }
  await desenhar();
}
