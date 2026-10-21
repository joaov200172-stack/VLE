// Configurações da empresa: dados, funil, mensagens prontas, WhatsApp, formulários da Meta e robô
import {
  sb, estado, h, campo, opcoes, toast, falha, q, confirmar, chamarFuncao,
  dataHora, souDono, urlCaptura, SUPABASE_URL,
} from "./lib.js";
import { carregarEmpresa } from "./app.js";

const ABAS = [["empresa", "Empresa"], ["funil", "Funil"], ["mensagens", "Mensagens prontas"], ["whatsapp", "WhatsApp"], ["meta", "Formulários da Meta"], ["robo", "Robô"]];

export async function telaAjustes(el) {
  let aba = sessionStorage.getItem("vle:aba-ajustes") || "empresa";
  const area = h("div");
  const abas = h("div", { class: "abas" });
  el.replaceChildren(h("h1", {}, "Configurações"), abas, area);

  function desenharAbas() {
    abas.replaceChildren(...ABAS.map(([k, t]) => h("button", { class: k === aba ? "ativa" : "", onclick: () => { aba = k; sessionStorage.setItem("vle:aba-ajustes", k); desenharAbas(); } }, t)));
    area.replaceChildren(h("p", { class: "suave" }, "Carregando…"));
    const f = { empresa: abaEmpresa, funil: abaFunil, mensagens: abaMensagens, whatsapp: abaWhatsapp, meta: abaMeta, robo: abaRobo }[aba];
    Promise.resolve(f()).then((n) => area.replaceChildren(n)).catch((e) => area.replaceChildren(h("p", { class: "erro-txt" }, e.message)));
  }
  const redesenhar = () => desenharAbas();

  // ----- empresa -----
  async function abaEmpresa() {
    const nome = h("input", { value: estado.empresa.nome, disabled: !souDono() });
    const minutos = h("input", { type: "number", min: 1, value: estado.empresa.minutos_primeiro_contato, disabled: !souDono() });
    let token = null;
    try { token = await q(sb.rpc("token_captura", { p_imobiliaria_id: estado.empresaId })); } catch { /* sem acesso */ }
    return h("div", {},
      h("div", { class: "cartao" },
        h("h3", {}, "Dados da empresa"),
        campo("Nome", nome),
        campo("Prazo do primeiro contato (minutos)", minutos, "Quando um lead entra, o corretor recebe uma tarefa com este prazo."),
        souDono() ? h("button", { class: "btn primario", onclick: async () => {
          try { await q(sb.from("imobiliarias").update({ nome: nome.value.trim(), minutos_primeiro_contato: Number(minutos.value) }).eq("id", estado.empresaId)); await carregarEmpresa(); toast("Salvo."); } catch (e) { falha(e); }
        } }, "Salvar") : h("p", { class: "suave pequeno" }, "Só o dono altera estes dados.")),
      token ? h("div", { class: "cartao" },
        h("h3", {}, "Captura de leads da empresa (sem time)"),
        h("p", { class: "suave pequeno" }, "Leads enviados para este endereço entram no rodízio entre todos e ficam no time do corretor que receber. Para mandar direto a um time, use o link do time em Equipe e times."),
        h("div", { class: "codigo" }, urlCaptura(token)),
        h("div", { class: "linha", style: { marginTop: "8px" } },
          h("button", { class: "btn mini", onclick: () => navigator.clipboard.writeText(urlCaptura(token)).then(() => toast("Copiado.")) }, "Copiar"),
          souDono() ? h("button", { class: "btn mini perigo", onclick: async () => {
            if (!confirmar("Gerar um endereço novo? O antigo para de funcionar na hora (inclusive nos formulários e integrações).")) return;
            try { await q(sb.rpc("gerar_novo_token_captura", { p_imobiliaria_id: estado.empresaId })); redesenhar(); } catch (e) { falha(e); }
          } }, "Gerar endereço novo") : null)) : null,
      souDono() ? h("div", { class: "cartao" },
        h("h3", {}, "Excluir empresa"),
        h("p", { class: "suave pequeno" }, "Apaga a empresa com todos os leads, conversas, times, pessoas e configurações. Não dá para desfazer."),
        h("button", { class: "btn perigo", onclick: async () => {
          const digitado = window.prompt(`Para confirmar, digite o nome da empresa: ${estado.empresa.nome}`);
          if (digitado === null) return;
          if (digitado.trim().toLowerCase() !== estado.empresa.nome.trim().toLowerCase()) return toast("O nome digitado não confere.", true);
          try {
            const apagadas = await q(sb.from("imobiliarias").delete().eq("id", estado.empresaId).select("id"));
            if (!apagadas.length) throw new Error("Não foi possível excluir a empresa.");
            localStorage.removeItem("vle:empresa");
            location.hash = "";
            location.reload();
          } catch (e) { falha(e); }
        } }, "Excluir esta empresa")) : null);
  }

  // ----- funil -----
  async function abaFunil() {
    await carregarEmpresa();
    const TIPOS = [["aberta", "Em andamento"], ["ganho", "Ganho"], ["perdido", "Perdido"]];
    const linhas = estado.etapas.map((e) => {
      const nome = h("input", { value: e.nome });
      const cor = h("input", { type: "color", value: e.cor, style: { width: "48px", padding: "2px" } });
      const sla = h("input", { type: "number", min: 0, value: e.sla_horas, style: { width: "90px" } });
      const tipo = h("select", { style: { width: "auto" } }, opcoes(TIPOS, e.tipo));
      const ordem = h("input", { type: "number", value: e.ordem, style: { width: "70px" } });
      return h("tr", {},
        h("td", {}, ordem), h("td", {}, nome), h("td", {}, cor), h("td", {}, tipo), h("td", {}, sla),
        h("td", { class: "linha" },
          h("button", { class: "btn mini", onclick: async () => {
            try { await q(sb.from("etapas_funil").update({ nome: nome.value.trim(), cor: cor.value, sla_horas: Number(sla.value), tipo: tipo.value, ordem: Number(ordem.value) }).eq("id", e.id)); await carregarEmpresa(); toast("Etapa salva."); redesenhar(); } catch (err) { falha(err); }
          } }, "Salvar"),
          h("button", { class: "btn mini perigo", onclick: async () => {
            if (!confirmar(`Excluir a etapa ${e.nome}? Só é possível se não houver leads nela.`)) return;
            try { await q(sb.from("etapas_funil").delete().eq("id", e.id)); await carregarEmpresa(); redesenhar(); } catch (err) { falha(err); }
          } }, "Excluir")));
    });
    const novoNome = h("input", { placeholder: "Nome da etapa" });
    return h("div", { class: "cartao" },
      h("h3", {}, "Etapas do funil"),
      h("p", { class: "suave pequeno" }, "O funil é o mesmo para todos os times. \"Prazo\" é quantas horas o lead pode ficar parado na etapa antes de aparecer como atrasado e gerar follow-up."),
      h("div", { class: "rolagem-x" }, h("table", { class: "tabela" },
        h("thead", {}, h("tr", {}, ["Ordem", "Nome", "Cor", "Tipo", "Prazo (h)", ""].map((c) => h("th", {}, c)))), h("tbody", {}, linhas))),
      h("div", { class: "linha", style: { marginTop: "12px" } }, h("div", { style: { flex: 1, minWidth: "200px" } }, novoNome),
        h("button", { class: "btn primario", onclick: async () => {
          if (!novoNome.value.trim()) return;
          const abertas = estado.etapas.filter((e) => e.tipo === "aberta");
          const ordem = (abertas.at(-1)?.ordem ?? 0) + 1;
          try {
            for (const e of estado.etapas.filter((x) => x.ordem >= ordem).sort((a, b) => b.ordem - a.ordem)) await q(sb.from("etapas_funil").update({ ordem: e.ordem + 1 }).eq("id", e.id));
            await q(sb.from("etapas_funil").insert({ imobiliaria_id: estado.empresaId, nome: novoNome.value.trim(), ordem, tipo: "aberta", cor: "#64748b", sla_horas: 48 }));
            await carregarEmpresa(); redesenhar();
          } catch (e) { falha(e); }
        } }, "Adicionar etapa")));
  }

  // ----- mensagens prontas -----
  async function abaMensagens() {
    const modelos = await q(sb.from("modelos_mensagem").select("*").eq("imobiliaria_id", estado.empresaId).order("created_at"));
    const GATILHOS = [["manual", "Só manual (atalho no chat)"], ["etapa", "Ao entrar na etapa"], ["followup", "Follow-up de lead parado"], ["lembrete_visita", "Lembrete de visita"]];
    const editor = (m) => {
      const nome = h("input", { value: m?.nome ?? "" });
      const gatilho = h("select", {}, opcoes(GATILHOS, m?.gatilho ?? "manual"));
      const etapaSel = h("select", {}, opcoes(estado.etapas, m?.etapa_id, "—"));
      const texto = h("textarea", { rows: 3 }, m?.texto ?? "");
      const ativo = h("input", { type: "checkbox", style: { width: "auto" }, checked: m ? m.ativo : true });
      return h("div", { class: "cartao" },
        h("div", { class: "linha" }, campo("Nome", nome), campo("Quando usar", gatilho), campo("Etapa", etapaSel), h("label", { class: "linha pequeno" }, ativo, "Ativa")),
        campo("Texto", texto, "Use {primeiro_nome}, {nome}, {corretor}, {imobiliaria}, {imovel} e {data_visita}."),
        h("div", { class: "linha" },
          h("button", { class: "btn primario", onclick: async () => {
            const reg = { nome: nome.value.trim(), gatilho: gatilho.value, etapa_id: etapaSel.value || null, texto: texto.value, ativo: ativo.checked };
            try {
              if (m) await q(sb.from("modelos_mensagem").update(reg).eq("id", m.id));
              else await q(sb.from("modelos_mensagem").insert({ ...reg, imobiliaria_id: estado.empresaId }));
              toast("Mensagem salva."); redesenhar();
            } catch (e) { falha(e.message.includes("check") ? new Error("Escolha a etapa para mensagens \"Ao entrar na etapa\".") : e); }
          } }, m ? "Salvar" : "Criar mensagem"),
          m ? h("button", { class: "btn perigo", onclick: async () => {
            if (!confirmar(`Excluir a mensagem ${m.nome}?`)) return;
            try { await q(sb.from("modelos_mensagem").delete().eq("id", m.id)); redesenhar(); } catch (e) { falha(e); }
          } }, "Excluir") : null));
    };
    return h("div", {},
      h("p", { class: "suave pequeno" }, "Mensagens \"Ao entrar na etapa\" entram sozinhas na fila do WhatsApp quando o lead muda de etapa."),
      ...modelos.map(editor), h("h3", {}, "Nova mensagem"), editor(null));
  }

  // ----- WhatsApp -----
  async function abaWhatsapp() {
    if (!souDono()) return h("div", { class: "cartao" }, h("p", {}, "Só o dono da empresa conecta o WhatsApp."), h("p", { class: "suave" }, estado.whatsapp ? "O WhatsApp está conectado." : "O WhatsApp ainda não está conectado."));
    const w = await q(sb.from("integracoes_whatsapp").select("*").eq("imobiliaria_id", estado.empresaId).maybeSingle());
    const partes = [];
    if (w) {
      partes.push(h("div", { class: "cartao" },
        h("h3", {}, w.provedor === "meta" ? "WhatsApp oficial da Meta" : "Z-API"),
        h("div", { class: "linha" },
          h("span", { class: "etiqueta " + (w.ativo && !w.ultimo_erro ? "verde" : "vermelha") }, w.ativo ? (w.ultimo_erro ? "Com erro" : "Conectado") : "Desligado"),
          w.numero ? h("strong", {}, w.numero) : null, w.nome_verificado ? h("span", { class: "suave" }, w.nome_verificado) : null),
        w.ultimo_erro ? h("p", { class: "erro-txt pequeno" }, w.ultimo_erro) : null,
        w.ultima_mensagem_em ? h("p", { class: "suave pequeno" }, "Última mensagem recebida: ", dataHora(w.ultima_mensagem_em)) : null,
        h("label", { class: "linha pequeno", style: { margin: "10px 0" } }, h("input", { type: "checkbox", style: { width: "auto" }, checked: w.envio_automatico, onchange: async (e) => {
          try { await q(sb.from("integracoes_whatsapp").update({ envio_automatico: e.target.checked }).eq("imobiliaria_id", estado.empresaId)); toast("Salvo."); } catch (err) { falha(err); }
        } }), "Enviar sozinho as mensagens automáticas da fila (a cada 2 minutos)"),
        w.provedor === "meta" ? h("div", { class: "linha" },
          h("button", { class: "btn", onclick: async () => {
            try { const r = await chamarFuncao("whatsapp-meta", { acao: "testar", imobiliaria_id: estado.empresaId }); toast(`Ligado: ${r.numero} (${r.nome ?? ""})${r.recebendo ? "" : " · atenção: não está recebendo mensagens"}`); } catch (e) { falha(e); }
          } }, "Testar ligação"),
          h("button", { class: "btn perigo", onclick: async () => {
            if (!confirmar("Desconectar o WhatsApp do CRM? O número continua funcionando no celular.")) return;
            try { await chamarFuncao("whatsapp-meta", { acao: "desconectar", imobiliaria_id: estado.empresaId }); await carregarEmpresa(); redesenhar(); } catch (e) { falha(e); }
          } }, "Desconectar"))
          : h("div", {}, h("p", { class: "pequeno" }, "Receber mensagens: cole este endereço na Z-API em Webhooks → \"Ao receber\":"),
            h("div", { class: "codigo" }, `${SUPABASE_URL}/functions/v1/whatsapp-receber?token=${w.webhook_token}`))));
    }
    if (!w || w.provedor !== "meta") partes.push(await cartaoConectarMeta());
    partes.push(cartaoZapi(w?.provedor === "zapi" ? w : null));
    return h("div", {}, ...partes);
  }

  async function cartaoConectarMeta() {
    let cfg = null;
    try { cfg = await chamarFuncao("whatsapp-meta", { acao: "config", imobiliaria_id: estado.empresaId }); } catch (e) { cfg = { erro: e.message }; }
    const pid = h("input", { placeholder: "ID do número de telefone" });
    const token = h("input", { placeholder: "Token de acesso", type: "password" });
    const waba = h("input", { placeholder: "ID da conta do WhatsApp (opcional)" });
    const botaoOficial = cfg?.config_whatsapp && cfg?.app_id
      ? h("button", { class: "btn primario", onclick: () => cadastroIncorporado(cfg).catch(falha) }, "Conectar o WhatsApp da empresa")
      : h("p", { class: "suave pequeno" }, "O botão de conexão com um clique aparece quando o app da Meta estiver aprovado (Provedor de Tecnologia + configuração do Cadastro incorporado). Enquanto isso, use o número de teste ou um token abaixo.");
    return h("div", { class: "cartao" },
      h("h3", {}, "WhatsApp oficial da Meta (grátis)"),
      h("p", { class: "suave pequeno" }, "Usa o mesmo número: o app WhatsApp Business continua no celular e o CRM recebe e envia por ele."),
      botaoOficial,
      h("details", { style: { marginTop: "12px" } }, h("summary", {}, "Conectar com o número de teste da Meta ou um token"),
        h("div", { style: { marginTop: "10px" } },
          h("div", { class: "linha" }, campo("ID do número", pid), campo("Token", token), campo("ID da conta (WABA)", waba)),
          h("button", { class: "btn", onclick: async () => {
            try {
              const r = await chamarFuncao("whatsapp-meta", { acao: "conectar_manual", imobiliaria_id: estado.empresaId, phone_number_id: pid.value, token: token.value, waba_id: waba.value || undefined });
              toast(`Conectado: ${r.numero ?? ""}`); await carregarEmpresa(); redesenhar();
            } catch (e) { falha(e); }
          } }, "Conectar"))));
  }

  async function cadastroIncorporado(cfg) {
    const FB = await carregarSdkFacebook(cfg.app_id, cfg.versao);
    let sessao = {};
    const ouvir = (ev) => {
      if (!/facebook\.com$/.test(new URL(ev.origin).hostname)) return;
      try { const d = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data; if (d?.type === "WA_EMBEDDED_SIGNUP" && d.data) sessao = { ...sessao, ...d.data, evento: d.event }; } catch { /* outra mensagem */ }
    };
    window.addEventListener("message", ouvir);
    FB.login(async (resp) => {
      window.removeEventListener("message", ouvir);
      const code = resp?.authResponse?.code;
      if (!code) return toast("Conexão cancelada.", true);
      try {
        const r = await chamarFuncao("whatsapp-meta", { acao: "conectar", imobiliaria_id: estado.empresaId, code, waba_id: sessao.waba_id, phone_number_id: sessao.phone_number_id, coexistencia: true });
        toast(`WhatsApp conectado: ${r.numero ?? ""}`); await carregarEmpresa(); redesenhar();
      } catch (e) { falha(e); }
    }, { config_id: cfg.config_whatsapp, response_type: "code", override_default_response_type: true, extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" } });
  }

  function cartaoZapi(w) {
    const inst = h("input", { value: w?.instancia_id ?? "" });
    const tok = h("input", { value: w?.token ?? "", type: "password" });
    const cli = h("input", { value: w?.client_token ?? "", type: "password" });
    return h("details", { class: "cartao" }, h("summary", {}, "Alternativa paga: Z-API"),
      h("div", { style: { marginTop: "10px" } },
        h("div", { class: "linha" }, campo("ID da instância", inst), campo("Token da instância", tok), campo("Client-Token (se usar)", cli)),
        h("button", { class: "btn", onclick: async () => {
          try {
            await q(sb.from("integracoes_whatsapp").upsert({ imobiliaria_id: estado.empresaId, provedor: "zapi", instancia_id: inst.value.trim(), token: tok.value.trim(), client_token: cli.value.trim() || null, ativo: true, updated_at: new Date().toISOString() }, { onConflict: "imobiliaria_id" }));
            await carregarEmpresa(); toast("Z-API salva."); redesenhar();
          } catch (e) { falha(e); }
        } }, "Salvar Z-API")));
  }

  // ----- formulários da Meta -----
  async function abaMeta() {
    if (!souDono()) return h("div", { class: "cartao" }, h("p", {}, "Só o dono da empresa conecta as páginas da Meta."));
    const paginas = await q(sb.from("integracoes_meta").select("page_id, page_nome, ativo, leads_recebidos, ultimo_lead_em, ultimo_erro").eq("imobiliaria_id", estado.empresaId));
    let cfg = null;
    try { cfg = await chamarFuncao("meta-leads", { acao: "config", imobiliaria_id: estado.empresaId }); } catch (e) { cfg = { erro: e.message }; }
    const acao = (acaoNome, page_id, extra = {}) => chamarFuncao("meta-leads", { acao: acaoNome, imobiliaria_id: estado.empresaId, page_id, ...extra });
    const lista = paginas.map((p) => h("tr", {},
      h("td", {}, h("strong", {}, p.page_nome ?? p.page_id), p.ultimo_erro ? h("div", { class: "erro-txt pequeno" }, p.ultimo_erro) : null),
      h("td", {}, p.leads_recebidos), h("td", { class: "suave pequeno" }, dataHora(p.ultimo_lead_em)),
      h("td", { class: "linha" },
        h("button", { class: "btn mini", onclick: async () => { try { const r = await acao("testar", p.page_id); toast(`${r.pagina}: ${r.recebendo ? "recebendo leads" : "NÃO está recebendo"} · ${r.formularios} formulários`); } catch (e) { falha(e); } } }, "Testar"),
        h("button", { class: "btn mini", onclick: async () => { try { const r = await acao("importar", p.page_id, { dias: 7 }); toast(`${r.encontrados} leads encontrados, ${r.novos} novos.`); redesenhar(); } catch (e) { falha(e); } } }, "Buscar últimos 7 dias"),
        h("button", { class: "btn mini perigo", onclick: async () => { if (!confirmar("Desconectar esta página?")) return; try { await acao("desconectar", p.page_id); redesenhar(); } catch (e) { falha(e); } } }, "Desconectar"))));
    return h("div", { class: "cartao" },
      h("h3", {}, "Formulários instantâneos (Facebook e Instagram)"),
      h("p", { class: "suave pequeno" }, "Cada formulário preenchido entra na hora como lead, com campanha, anúncio e formulário na ficha."),
      paginas.length ? h("table", { class: "tabela" }, h("thead", {}, h("tr", {}, ["Página", "Leads", "Último lead", ""].map((c) => h("th", {}, c)))), h("tbody", {}, lista)) : h("p", { class: "suave" }, "Nenhuma página conectada."),
      cfg?.pronto ? h("button", { class: "btn primario", style: { marginTop: "12px" }, onclick: () => conectarPagina(cfg).catch(falha) }, "Conectar página do Facebook")
        : h("p", { class: "erro-txt pequeno" }, cfg?.erro ?? "O app da Meta ainda não está configurado."),
      h("p", { class: "suave pequeno" }, "Se o botão não abrir o Facebook, o endereço deste CRM precisa estar em \"Domínios do app\" nas configurações do app da Meta."));
  }

  async function conectarPagina(cfg) {
    const FB = await carregarSdkFacebook(cfg.app_id, cfg.versao);
    const opcoesLogin = cfg.config_id ? { config_id: cfg.config_id } : { scope: "pages_show_list,pages_read_engagement,pages_manage_metadata,pages_manage_ads,leads_retrieval,business_management" };
    FB.login(async (resp) => {
      const userToken = resp?.authResponse?.accessToken;
      if (!userToken) return toast("Conexão cancelada.", true);
      try {
        const { paginas } = await chamarFuncao("meta-leads", { acao: "paginas", imobiliaria_id: estado.empresaId, user_token: userToken });
        const escolha = h("select", {}, opcoes(paginas.map((p) => [p.id, p.nome + (p.ligada === "aqui" ? " (já conectada)" : p.ligada === "outra" ? " (em outra empresa)" : "")])));
        const raiz = document.getElementById("modal-raiz");
        const fundo = h("div", { class: "fundo-modal centro" }, h("div", { class: "janela" },
          h("h2", {}, "Escolha a página"), campo("Página", escolha),
          h("button", { class: "btn primario", onclick: async () => {
            try { const r = await chamarFuncao("meta-leads", { acao: "conectar", imobiliaria_id: estado.empresaId, user_token: userToken, page_id: escolha.value }); fundo.remove(); toast(`Página ${r.pagina} conectada.`); redesenhar(); } catch (e) { falha(e); }
          } }, "Conectar"), " ", h("button", { class: "btn", onclick: () => fundo.remove() }, "Cancelar")));
        raiz.append(fundo);
      } catch (e) { falha(e); }
    }, opcoesLogin);
  }

  // ----- robô -----
  async function abaRobo() {
    const r = await q(sb.from("robos").select("*").eq("imobiliaria_id", estado.empresaId).maybeSingle());
    const ativo = h("input", { type: "checkbox", style: { width: "auto" }, checked: r?.ativo ?? false });
    const iniciar = h("select", {}, opcoes([["whatsapp", "Quando um número novo manda mensagem no WhatsApp"], ["todos", "Em todo lead novo com telefone"], ["manual", "Só quando alguém iniciar pela conversa"]], r?.iniciar ?? "whatsapp"));
    const saudacao = h("textarea", { rows: 3 }, r?.saudacao ?? "Olá, {primeiro_nome}! Aqui é o assistente virtual da {imobiliaria}. Vou te fazer algumas perguntas rápidas.");
    const final = h("textarea", { rows: 3 }, r?.mensagem_final ?? "Obrigado, {primeiro_nome}! Já passei tudo para {corretor}, que vai continuar seu atendimento por aqui.");
    const etapaFim = h("select", {}, opcoes(estado.etapas.filter((e) => e.tipo === "aberta"), r?.etapa_ao_concluir, "Não mudar a etapa"));
    let perguntas = structuredClone(r?.perguntas ?? []);
    const listaPerg = h("div");
    const CAMPOS = [["interesse", "Interesse (comprar/alugar)"], ["bairro", "Região"], ["orcamento", "Orçamento"], ["quartos", "Quartos"], ["livre", "Pergunta livre"]];
    const desenharPerguntas = () => listaPerg.replaceChildren(...perguntas.map((p, i) => h("div", { class: "cartao", style: { padding: "10px" } },
      h("div", { class: "linha" },
        h("label", { class: "linha pequeno" }, h("input", { type: "checkbox", style: { width: "auto" }, checked: p.ativo !== false, onchange: (e) => { p.ativo = e.target.checked; } }), "Ativa"),
        h("select", { style: { width: "auto" }, onchange: (e) => { p.campo = e.target.value; } }, opcoes(CAMPOS, p.campo)),
        p.campo === "livre" || !CAMPOS.some(([c]) => c === p.campo) ? h("input", { placeholder: "Nome do campo na ficha", value: p.rotulo ?? "", style: { maxWidth: "200px" }, oninput: (e) => { p.rotulo = e.target.value; } }) : null,
        h("span", { class: "espaco" }),
        h("button", { class: "btn mini", disabled: i === 0, onclick: () => { [perguntas[i - 1], perguntas[i]] = [perguntas[i], perguntas[i - 1]]; desenharPerguntas(); } }, "↑"),
        h("button", { class: "btn mini perigo", onclick: () => { perguntas.splice(i, 1); desenharPerguntas(); } }, "Remover")),
      h("textarea", { rows: 2, style: { marginTop: "6px" }, oninput: (e) => { p.texto = e.target.value; } }, p.texto ?? ""))));
    desenharPerguntas();
    return h("div", {},
      h("div", { class: "cartao" },
        h("label", { class: "linha" }, ativo, h("strong", {}, "Robô de qualificação ligado")),
        h("p", { class: "suave pequeno" }, "O robô faz as perguntas pelo WhatsApp, preenche a ficha e passa a conversa para o corretor. Precisa do WhatsApp conectado."),
        campo("Quando começar", iniciar), campo("Saudação", saudacao)),
      h("h3", {}, "Perguntas"), listaPerg,
      h("button", { class: "btn", onclick: () => { perguntas.push({ ativo: true, campo: "livre", texto: "" }); desenharPerguntas(); } }, "+ Pergunta"),
      h("div", { class: "cartao", style: { marginTop: "14px" } }, campo("Mensagem final", final), campo("Ao terminar, mover para", etapaFim),
        h("button", { class: "btn primario", onclick: async () => {
          try {
            await q(sb.from("robos").upsert({ imobiliaria_id: estado.empresaId, ativo: ativo.checked, iniciar: iniciar.value, saudacao: saudacao.value, mensagem_final: final.value, perguntas, etapa_ao_concluir: etapaFim.value || null, updated_at: new Date().toISOString() }, { onConflict: "imobiliaria_id" }));
            toast("Robô salvo.");
          } catch (e) { falha(e); }
        } }, "Salvar robô")));
  }

  desenharAbas();
}

let sdk = null;
function carregarSdkFacebook(appId, versao = "v25.0") {
  if (sdk) return sdk;
  sdk = new Promise((ok, erro) => {
    window.fbAsyncInit = () => { window.FB.init({ appId, cookie: true, xfbml: false, version: versao }); ok(window.FB); };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/pt_BR/sdk.js";
    s.async = true;
    s.onerror = () => { sdk = null; erro(new Error("Não foi possível carregar o Facebook. Verifique bloqueadores de anúncio.")); };
    document.head.append(s);
  });
  return sdk;
}
