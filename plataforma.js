// Tela do dono geral da plataforma: todas as empresas, criar empresa para um cliente e excluir
import { sb, estado, h, campo, toast, falha, q, dia, moeda, janela, chamarFuncao, confirmar } from "./lib.js";
import { carregarVinculos, abrirEmpresa, recarregar } from "./app.js";

export async function telaPlataforma(el) {
  async function desenhar() {
    const [empresas, asaasSit, assinaturas] = await Promise.all([
      q(sb.rpc("admin_empresas")), q(sb.rpc("asaas_situacao")), q(sb.from("assinaturas").select("*"))]);
    const assPor = Object.fromEntries((assinaturas ?? []).map((a) => [a.imobiliaria_id, a]));
    el.replaceChildren(
      h("h1", {}, "Todas as empresas"),
      h("p", { class: "suave" }, "Você é o dono geral do CRM e vê todas as empresas. Cada empresa tem o próprio dono, que só enxerga a empresa dele."),
      cartaoAsaas(asaasSit ?? {}, assinaturas ?? []),
      cartaoNova(),
      h("div", { class: "cartao" },
        h("h3", {}, `Empresas (${empresas.length})`),
        h("div", { class: "rolagem-x" }, h("table", { class: "tabela" },
          h("thead", {}, h("tr", {}, ["Empresa", "Dono", "Mensalidade", "Pessoas", "Times", "Leads", "Leads 30 dias", "Criada em", ""].map((c) => h("th", {}, c)))),
          h("tbody", {}, empresas.map((e) => h("tr", {},
            h("td", {}, h("strong", {}, e.nome)),
            h("td", { class: "pequeno" }, e.donos || "", e.dono_pendente ? h("div", { class: "suave" }, `Convite pendente: ${e.dono_pendente}`) : null),
            h("td", {}, celulaCobranca(e, assPor[e.id], asaasSit)),
            h("td", {}, e.pessoas), h("td", {}, e.times), h("td", {}, e.leads), h("td", {}, e.leads_30d),
            h("td", { class: "suave pequeno" }, dia(e.criada_em)),
            h("td", { class: "linha" },
              h("button", { class: "btn mini primario", onclick: () => abrirEmpresa(e.id) }, "Abrir"),
              h("button", { class: "btn mini perigo", onclick: () => excluir(e) }, "Excluir")))))))));
  }

  function cartaoNova() {
    const nome = h("input", { required: true, placeholder: "Ex.: Incorporadora X" });
    const nomeDono = h("input", { placeholder: "Nome do dono" });
    const emailDono = h("input", { type: "email", required: true, placeholder: "dono@empresa.com.br" });
    return h("div", { class: "cartao" },
      h("h3", {}, "Nova empresa"),
      h("form", { onsubmit: async (ev) => {
        ev.preventDefault();
        try {
          await q(sb.rpc("admin_criar_empresa", { p_nome: nome.value.trim(), p_email_dono: emailDono.value.trim(), p_nome_dono: nomeDono.value.trim() || null }));
          await carregarVinculos();
          toast("Empresa criada.");
          recarregar();
        } catch (err) { falha(err); }
      } },
      h("div", { class: "linha" }, campo("Nome da empresa", nome), campo("Nome do dono", nomeDono), campo("E-mail do dono", emailDono)),
      h("button", { class: "btn primario", type: "submit" }, "Criar empresa")),
      h("p", { class: "suave pequeno" }, "A empresa já vem com o funil e as mensagens padrão. Mande o link do CRM para o dono: ",
        h("strong", {}, location.origin + location.pathname),
        ". Ele entra (ou cria a conta) com esse e-mail e já cai como dono da empresa, vendo só ela."));
  }

  // ---------- cobrança automática (Asaas) ----------
  const SITUACAO = { em_dia: ["Em dia", "verde"], atrasada: ["Atrasada", "vermelha"], aguardando: ["Aguardando 1º pagamento", "amarela"], cancelada: ["Cancelada", ""] };
  const FORMAS = { UNDEFINED: "Cliente escolhe (Pix, boleto ou cartão)", PIX: "Pix", BOLETO: "Boleto", CREDIT_CARD: "Cartão de crédito" };

  function cartaoAsaas(sit, assinaturas) {
    const ativas = assinaturas.filter((a) => a.status !== "cancelada");
    const mrr = ativas.reduce((t, a) => t + Number(a.valor || 0), 0);
    const atrasadas = ativas.filter((a) => a.status === "atrasada").length;
    if (sit.configurado && sit.webhook) {
      return h("div", { class: "cartao" },
        h("h3", {}, "Cobrança automática (Asaas)"),
        h("p", {}, h("span", { class: "etiqueta verde" }, "Conectado"), " ", sit.conta ? `Conta ${sit.conta}` : "", sit.ambiente === "sandbox" ? " · ambiente de teste (sandbox)" : ""),
        h("div", { class: "linha" },
          h("div", {}, h("div", { class: "suave pequeno" }, "Receita mensal"), h("strong", {}, moeda(mrr))),
          h("div", {}, h("div", { class: "suave pequeno" }, "Empresas pagando"), h("strong", {}, String(ativas.length))),
          h("div", {}, h("div", { class: "suave pequeno" }, "Atrasadas"), h("strong", {}, String(atrasadas)))),
        h("p", { class: "suave pequeno" }, "O Asaas manda a cobrança por e-mail e WhatsApp/SMS, lembra antes e depois do vencimento, e avisa o CRM quando o cliente paga. ",
          h("a", { href: "#", onclick: (ev) => { ev.preventDefault(); conectarAsaas(sit); } }, "Trocar a chave")));
    }
    return h("div", { class: "cartao" },
      h("h3", {}, "Cobrança automática (Asaas)"),
      h("p", { class: "suave" }, sit.configurado ? "A chave foi salva, mas falta ativar o aviso de pagamentos." : "Conecte sua conta do Asaas para cobrar a mensalidade de cada empresa por Pix, boleto ou cartão, todo mês, sem mexer em nada."),
      h("button", { class: "btn primario", onclick: () => conectarAsaas(sit) }, sit.configurado ? "Ativar avisos de pagamento" : "Conectar Asaas"));
  }

  function conectarAsaas(sit) {
    const chave = h("input", { type: "password", autocomplete: "off", placeholder: sit.configurado ? "Deixe vazio para manter a chave salva" : "$aact_..." });
    const amb = h("select", {}, h("option", { value: "producao" }, "Produção (cobranças reais)"), h("option", { value: "sandbox" }, "Sandbox (teste)"));
    if (sit.ambiente) amb.value = sit.ambiente;
    const botao = h("button", { class: "btn primario", type: "submit" }, "Conectar");
    const fechar = janela("Conectar Asaas", h("form", { onsubmit: async (ev) => {
      ev.preventDefault();
      botao.disabled = true;
      try {
        if (chave.value.trim() || !sit.configurado || amb.value !== sit.ambiente) {
          if (!chave.value.trim()) throw new Error("Cole a chave da API do Asaas.");
          await q(sb.rpc("asaas_salvar_chave", { p_chave: chave.value.trim(), p_ambiente: amb.value }));
        }
        const r = await chamarFuncao("asaas", { acao: "conectar" });
        fechar();
        toast(`Asaas conectado${r.conta ? `: ${r.conta}` : ""}.`);
        desenhar();
      } catch (err) { falha(err); botao.disabled = false; }
    } },
      h("ol", { class: "pequeno" },
        h("li", {}, "Entre no Asaas, vá em Integrações (ou Minha conta → Integrações) e gere uma chave da API."),
        h("li", {}, "Cole a chave abaixo. Ela fica guardada no cofre do servidor e não aparece de novo, nem para você."),
        h("li", {}, "O CRM cadastra sozinho o aviso de pagamentos (webhook) no Asaas.")),
      campo("Chave da API", chave),
      campo("Ambiente", amb, "A chave de produção só funciona em produção, e a de sandbox só no sandbox."),
      botao), { largura: 520 });
  }

  function celulaCobranca(e, a, sit) {
    if (!a || a.status === "cancelada") {
      return h("div", {},
        a ? h("span", { class: "etiqueta" }, "Cancelada") : h("span", { class: "suave pequeno" }, "Sem cobrança"),
        sit?.configurado && sit?.webhook ? h("div", {}, h("button", { class: "btn mini", onclick: () => novaCobranca(e, a) }, "Cobrar")) : null);
    }
    const [txt, cor] = SITUACAO[a.status] ?? [a.status, ""];
    return h("div", {},
      h("strong", {}, moeda(a.valor)), " ", h("span", { class: `etiqueta ${cor}` }, txt),
      a.proximo_vencimento ? h("div", { class: "suave pequeno" }, `Próx.: ${dia(a.proximo_vencimento + "T12:00:00")}`) : null,
      h("div", {}, h("button", { class: "btn mini", onclick: () => detalhes(e, a) }, "Detalhes")));
  }

  function novaCobranca(e, anterior) {
    const nome = h("input", { required: true, value: anterior?.nome_cobranca ?? e.nome });
    const doc = h("input", { required: true, inputmode: "numeric", placeholder: "CPF ou CNPJ", value: anterior?.cpf_cnpj ?? "" });
    const email = h("input", { type: "email", placeholder: "financeiro@empresa.com.br", value: anterior?.email ?? "" });
    const fone = h("input", { inputmode: "tel", placeholder: "(32) 99999-9999", value: anterior?.telefone ?? "" });
    const valor = h("input", { type: "number", min: "1", step: "0.01", required: true, value: anterior?.valor ?? "" });
    const diaV = h("input", { type: "number", min: "1", max: "28", required: true, value: anterior?.dia_vencimento ?? 10 });
    const forma = h("select", {}, Object.entries(FORMAS).map(([k, v]) => h("option", { value: k }, v)));
    const descricao = h("input", { placeholder: `Mensalidade CRM e marketing - ${e.nome}` });
    const botao = h("button", { class: "btn primario", type: "submit" }, "Criar cobrança mensal");
    const fechar = janela(`Cobrança de ${e.nome}`, h("form", { onsubmit: async (ev) => {
      ev.preventDefault();
      botao.disabled = true;
      try {
        await chamarFuncao("asaas", { acao: "assinar", imobiliaria_id: e.id, nome: nome.value, cpf_cnpj: doc.value, email: email.value, telefone: fone.value,
          valor: Number(valor.value), dia: Number(diaV.value), forma: forma.value, descricao: descricao.value });
        fechar();
        toast("Cobrança criada. O Asaas envia a primeira fatura ao cliente.");
        desenhar();
      } catch (err) { falha(err); botao.disabled = false; }
    } },
      h("div", { class: "linha" }, campo("Nome ou razão social", nome), campo("CPF ou CNPJ", doc)),
      h("div", { class: "linha" }, campo("E-mail para a cobrança", email), campo("Celular (WhatsApp/SMS)", fone)),
      h("div", { class: "linha" }, campo("Valor mensal (R$)", valor), campo("Dia do vencimento", diaV, "De 1 a 28")),
      campo("Forma de pagamento", forma), campo("Descrição na fatura", descricao),
      botao), { largura: 620 });
  }

  async function detalhes(e, a) {
    let cobrancas = [];
    try { cobrancas = await q(sb.from("cobrancas").select("*").eq("imobiliaria_id", e.id).neq("status", "DELETED").order("vencimento", { ascending: false }).limit(24)); } catch (err) { falha(err); }
    const ST = { PENDING: ["Aberta", "amarela"], OVERDUE: ["Vencida", "vermelha"], RECEIVED: ["Paga", "verde"], CONFIRMED: ["Paga", "verde"], RECEIVED_IN_CASH: ["Paga", "verde"], REFUNDED: ["Estornada", ""] };
    const valor = h("input", { type: "number", min: "1", step: "0.01", value: a.valor });
    const forma = h("select", {}, Object.entries(FORMAS).map(([k, v]) => h("option", { value: k }, v)));
    forma.value = a.forma;
    const fechar = janela(`Cobrança de ${e.nome}`, h("div", {},
      h("p", {}, h("strong", {}, `${moeda(a.valor)} por mês`), ` · vence dia ${a.dia_vencimento} · ${FORMAS[a.forma] ?? a.forma}`,
        h("br"), h("span", { class: "suave pequeno" }, `${a.nome_cobranca ?? ""} · ${a.cpf_cnpj ?? ""}${a.email ? " · " + a.email : ""}`)),
      h("div", { class: "rolagem-x" }, h("table", { class: "tabela" },
        h("thead", {}, h("tr", {}, ["Vencimento", "Valor", "Situação", "Pago em", ""].map((c) => h("th", {}, c)))),
        h("tbody", {}, cobrancas.length ? cobrancas.map((c) => {
          const [t, cor] = ST[c.status] ?? [c.status, ""];
          return h("tr", {}, h("td", {}, dia(c.vencimento + "T12:00:00")), h("td", {}, moeda(c.valor)), h("td", {}, h("span", { class: `etiqueta ${cor}` }, t)),
            h("td", { class: "pequeno" }, c.pago_em ? dia(c.pago_em.length === 10 ? c.pago_em + "T12:00:00" : c.pago_em) : ""),
            h("td", {}, c.link ? h("a", { href: c.link, target: "_blank", rel: "noopener" }, "Fatura") : ""));
        }) : h("tr", {}, h("td", { colspan: 5, class: "suave" }, "Nenhuma fatura ainda."))))),
      h("h3", {}, "Alterar"),
      h("div", { class: "linha" }, campo("Valor mensal (R$)", valor), campo("Forma", forma)),
      h("div", { class: "linha" },
        h("button", { class: "btn primario", onclick: async () => {
          try { await chamarFuncao("asaas", { acao: "alterar", imobiliaria_id: e.id, valor: Number(valor.value), forma: forma.value }); fechar(); toast("Cobrança alterada."); desenhar(); } catch (err) { falha(err); }
        } }, "Salvar"),
        h("button", { class: "btn", onclick: async () => {
          try { const r = await chamarFuncao("asaas", { acao: "sincronizar", imobiliaria_id: e.id }); fechar(); toast(`${r.cobrancas} faturas atualizadas.`); desenhar(); } catch (err) { falha(err); }
        } }, "Atualizar do Asaas"),
        h("button", { class: "btn perigo", onclick: async () => {
          if (!confirmar(`Cancelar a cobrança mensal de ${e.nome}? As próximas faturas deixam de ser geradas.`)) return;
          try { await chamarFuncao("asaas", { acao: "cancelar", imobiliaria_id: e.id }); fechar(); toast("Cobrança cancelada."); desenhar(); } catch (err) { falha(err); }
        } }, "Cancelar cobrança"))), { largura: 680 });
  }

  async function excluir(e) {
    const digitado = window.prompt(`Excluir ${e.nome} apaga todos os leads, conversas, times e pessoas dela, sem volta.\n\nPara confirmar, digite o nome da empresa:`);
    if (digitado === null) return;
    if (digitado.trim().toLowerCase() !== e.nome.trim().toLowerCase()) return toast("O nome digitado não confere.", true);
    try {
      const apagadas = await q(sb.from("imobiliarias").delete().eq("id", e.id).select("id"));
      if (!apagadas.length) throw new Error("Não foi possível excluir a empresa.");
      await carregarVinculos();
      toast("Empresa excluída.");
      if (estado.empresaId === e.id) {
        localStorage.removeItem("vle:empresa");
        if (estado.vinculos.length) return abrirEmpresa(estado.vinculos[0].imobiliaria_id, "plataforma");
        return location.reload();
      }
      recarregar();
    } catch (err) { falha(err); }
  }

  await desenhar();
}
