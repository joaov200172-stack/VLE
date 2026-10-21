// Equipe e times: criar times, colocar pessoas nos times, convidar e ver o link de captura de cada time
import {
  sb, estado, h, campo, opcoes, toast, falha, q, janela, confirmar,
  dataHora, nomeTime, PAPEIS, souDono, souGeral, souGerenteTime, urlCaptura,
} from "./lib.js";
import { carregarEmpresa } from "./app.js";

export async function telaEquipe(el) {
  async function desenhar() {
    await carregarEmpresa();
    let convites = [];
    try { convites = await q(sb.from("convites").select("*").eq("imobiliaria_id", estado.empresaId).is("aceito_em", null).order("created_at", { ascending: false })); } catch { /* sem acesso */ }
    let leadsPorTime = new Map();
    if (souGeral() && estado.times.length) {
      const ls = await q(sb.from("leads").select("time_id").eq("imobiliaria_id", estado.empresaId).not("time_id", "is", null).limit(20000));
      for (const l of ls) leadsPorTime.set(l.time_id, (leadsPorTime.get(l.time_id) ?? 0) + 1);
    }
    el.replaceChildren(
      h("h1", {}, "Equipe e times"),
      souGeral() ? cartaoTimes(leadsPorTime) : cartaoMeuTime(),
      cartaoMembros(),
      cartaoConvites(convites));
  }

  // ----- times -----
  function cartaoTimes(leadsPorTime) {
    const nome = h("input", { placeholder: "Ex.: Time Barra, Time SJ, Lançamento X" });
    return h("div", { class: "cartao" },
      h("h3", {}, "Times"),
      h("p", { class: "suave pequeno" }, "Cada time vê só os próprios leads. O dono e os gerentes sem time (gerentes gerais) veem tudo. Leads que entram pelo link de captura do time já caem nele e são distribuídos no rodízio do time."),
      h("form", { class: "linha", onsubmit: async (e) => {
        e.preventDefault();
        if (!nome.value.trim()) return;
        try { await q(sb.from("times").insert({ imobiliaria_id: estado.empresaId, nome: nome.value.trim() })); toast("Time criado."); desenhar(); } catch (err) { falha(err); }
      } }, h("div", { style: { flex: 1, minWidth: "200px" } }, nome), h("button", { class: "btn primario", type: "submit" }, "Criar time")),
      estado.times.length ? h("div", { class: "rolagem-x", style: { marginTop: "12px" } }, h("table", { class: "tabela" },
        h("thead", {}, h("tr", {}, ["Time", "Pessoas", "Leads", "Situação", ""].map((c) => h("th", {}, c)))),
        h("tbody", {}, estado.times.map((t) => h("tr", {},
          h("td", {}, h("strong", {}, t.nome)),
          h("td", {}, estado.equipe.filter((m) => m.time_id === t.id).length),
          h("td", {}, leadsPorTime.get(t.id) ?? 0),
          h("td", {}, t.ativo ? h("span", { class: "etiqueta verde" }, "Ativo") : h("span", { class: "etiqueta" }, "Pausado")),
          h("td", { class: "linha" },
            h("button", { class: "btn mini", onclick: () => linkCaptura(t) }, "Link de captura"),
            h("button", { class: "btn mini", onclick: async () => {
              const novo = window.prompt("Novo nome do time:", t.nome);
              if (!novo?.trim()) return;
              try { await q(sb.from("times").update({ nome: novo.trim() }).eq("id", t.id)); desenhar(); } catch (e) { falha(e); }
            } }, "Renomear"),
            h("button", { class: "btn mini", onclick: async () => {
              try { await q(sb.from("times").update({ ativo: !t.ativo }).eq("id", t.id)); desenhar(); } catch (e) { falha(e); }
            } }, t.ativo ? "Pausar" : "Ativar"),
            h("button", { class: "btn mini perigo", onclick: async () => {
              if (!confirmar(`Excluir o time ${t.nome}? As pessoas e os leads dele ficam sem time (visíveis só para o dono e gerentes gerais).`)) return;
              try { await q(sb.from("times").delete().eq("id", t.id)); toast("Time excluído."); desenhar(); } catch (e) { falha(e); }
            } }, "Excluir"))))))) : h("p", { class: "suave", style: { marginTop: "12px" } }, "Nenhum time ainda."));
  }

  function cartaoMeuTime() {
    const t = estado.times.find((x) => x.id === estado.eu.time_id);
    return h("div", { class: "cartao" }, h("h3", {}, "Meu time: ", t?.nome ?? ""),
      h("p", { class: "suave pequeno" }, "Você gerencia os leads e as pessoas deste time."),
      t ? h("button", { class: "btn", onclick: () => linkCaptura(t) }, "Link de captura do time") : null);
  }

  async function linkCaptura(t) {
    try {
      const token = await q(sb.rpc("token_captura_time", { p_time_id: t.id }));
      const url = urlCaptura(token);
      const html = `<form action="${url}&redirect=https://seusite.com.br/obrigado" method="POST">\n  <input name="nome" placeholder="Nome" required>\n  <input name="telefone" placeholder="WhatsApp" required>\n  <input name="email" type="email" placeholder="E-mail">\n  <input name="website" style="display:none">\n  <button>Quero saber mais</button>\n</form>`;
      const copiar = (txt) => navigator.clipboard.writeText(txt).then(() => toast("Copiado."));
      janela(`Captura de leads · ${t.nome}`, h("div", {},
        h("p", { class: "pequeno" }, "Todo lead enviado para este endereço entra direto no ", h("strong", {}, t.nome), " e vai para o rodízio do time."),
        campo("Endereço (POST)", h("div", { class: "codigo" }, url)),
        h("button", { class: "btn mini", onclick: () => copiar(url) }, "Copiar endereço"),
        h("p", { class: "pequeno", style: { marginTop: "14px" } }, "Formulário pronto para colar no site ou landing page:"),
        h("div", { class: "codigo", style: { whiteSpace: "pre-wrap" } }, html),
        h("button", { class: "btn mini", onclick: () => copiar(html) }, "Copiar formulário"),
        h("p", { class: "suave pequeno", style: { marginTop: "14px" } }, "Também serve para Make, Zapier, RD Station e portais: envie nome, telefone, e-mail e mensagem em JSON. Acrescente &origem=nome-da-origem ao endereço para identificar de onde veio."),
        souGeral() ? h("button", { class: "btn mini perigo", onclick: async () => {
          if (!confirmar("Gerar um endereço novo? O antigo para de funcionar na hora.")) return;
          try { await q(sb.rpc("gerar_novo_token_time", { p_time_id: t.id })); toast("Endereço novo gerado. Abra de novo para copiar."); } catch (e) { falha(e); }
        } }, "Gerar endereço novo") : null), { largura: 640 });
    } catch (e) { falha(e); }
  }

  // ----- pessoas -----
  function cartaoMembros() {
    let lista = estado.equipe;
    if (souGerenteTime()) lista = lista.filter((m) => m.time_id === estado.eu.time_id);
    const atualizar = async (m, upd) => {
      try { await q(sb.from("membros").update(upd).eq("imobiliaria_id", m.imobiliaria_id).eq("user_id", m.user_id)); toast("Salvo."); await carregarEmpresa(); } catch (e) { falha(e); desenhar(); }
    };
    return h("div", { class: "cartao" },
      h("h3", {}, "Pessoas"),
      h("div", { class: "rolagem-x" }, h("table", { class: "tabela" },
        h("thead", {}, h("tr", {}, ["Nome", "Papel", "Time", "Recebe leads", "Ativo"].map((c) => h("th", {}, c)))),
        h("tbody", {}, lista.map((m) => {
          const eu = m.user_id === estado.usuario.id;
          return h("tr", {},
            h("td", {}, h("strong", {}, m.nome), h("div", { class: "suave pequeno" }, m.email ?? "")),
            h("td", {}, souDono() && !eu
              ? h("select", { style: { width: "auto" }, onchange: (e) => atualizar(m, { papel: e.target.value }) }, opcoes(Object.entries(PAPEIS), m.papel))
              : PAPEIS[m.papel]),
            h("td", {}, souGeral() && m.papel !== "dono"
              ? h("select", { style: { width: "auto" }, onchange: (e) => atualizar(m, { time_id: e.target.value || null }) }, opcoes(estado.times, m.time_id, m.papel === "gerente" ? "Sem time (gerente geral)" : "Sem time"))
              : (nomeTime(m.time_id) || "—")),
            h("td", {}, h("input", { type: "checkbox", style: { width: "auto" }, checked: m.recebe_leads, onchange: (e) => atualizar(m, { recebe_leads: e.target.checked }) })),
            h("td", {}, h("input", { type: "checkbox", style: { width: "auto" }, checked: m.ativo, disabled: eu || (m.papel === "dono" && !souDono()), onchange: (e) => atualizar(m, { ativo: e.target.checked }) })));
        })))),
      h("p", { class: "suave pequeno" }, "Gerente com time vê e distribui só os leads do time. Gerente sem time é gerente geral e vê tudo. Desmarque \"Ativo\" para tirar o acesso de alguém sem apagar o histórico."));
  }

  // ----- convites -----
  function cartaoConvites(convites) {
    const email = h("input", { type: "email", required: true, placeholder: "pessoa@email.com" });
    const nome = h("input", { placeholder: "Nome" });
    const papel = h("select", {}, opcoes(souGeral() ? [["corretor", "Corretor"], ["gerente", "Gerente"]] : [["corretor", "Corretor"]], "corretor"));
    const time = h("select", {}, opcoes(estado.times.filter((t) => t.ativo), estado.filtroTime && estado.filtroTime !== "sem" ? estado.filtroTime : "", "Sem time"));
    const link = location.origin + location.pathname;
    return h("div", { class: "cartao" },
      h("h3", {}, "Convidar pessoa"),
      h("form", { onsubmit: async (e) => {
        e.preventDefault();
        try {
          await q(sb.from("convites").insert({
            imobiliaria_id: estado.empresaId, email: email.value.trim().toLowerCase(), nome: nome.value.trim() || null,
            papel: papel.value, time_id: souGeral() ? (time.value || null) : estado.eu.time_id,
          }));
          toast("Convite criado. Mande o link do CRM para a pessoa criar a conta com esse e-mail.");
          desenhar();
        } catch (err) { falha(err); }
      } },
      h("div", { class: "linha" }, campo("E-mail", email), campo("Nome", nome), campo("Papel", papel), souGeral() && estado.times.length ? campo("Time", time) : null),
      h("button", { class: "btn primario", type: "submit" }, "Convidar")),
      h("p", { class: "suave pequeno" }, "A pessoa entra em ", h("a", { href: link }, link), ", clica em \"Criar conta\" com o mesmo e-mail e já cai na empresa e no time certo."),
      convites.length ? h("div", {}, h("h3", { style: { marginTop: "14px" } }, "Convites pendentes"),
        h("table", { class: "tabela" }, h("tbody", {}, convites.map((c) => h("tr", {},
          h("td", {}, c.email), h("td", {}, PAPEIS[c.papel]), h("td", {}, nomeTime(c.time_id) || "Sem time"), h("td", { class: "suave pequeno" }, dataHora(c.created_at)),
          h("td", {}, h("button", { class: "btn mini perigo", onclick: async () => {
            try { await q(sb.from("convites").delete().eq("id", c.id)); desenhar(); } catch (e) { falha(e); }
          } }, "Cancelar"))))))) : null);
  }

  await desenhar();
}
