// Tela do dono geral da plataforma: todas as empresas, criar empresa para um cliente e excluir
import { sb, estado, h, campo, toast, falha, q, dia } from "./lib.js";
import { carregarVinculos, abrirEmpresa, recarregar } from "./app.js";

export async function telaPlataforma(el) {
  async function desenhar() {
    const empresas = await q(sb.rpc("admin_empresas"));
    el.replaceChildren(
      h("h1", {}, "Todas as empresas"),
      h("p", { class: "suave" }, "Você é o dono geral do CRM e vê todas as empresas. Cada empresa tem o próprio dono, que só enxerga a empresa dele."),
      cartaoNova(),
      h("div", { class: "cartao" },
        h("h3", {}, `Empresas (${empresas.length})`),
        h("div", { class: "rolagem-x" }, h("table", { class: "tabela" },
          h("thead", {}, h("tr", {}, ["Empresa", "Dono", "Pessoas", "Times", "Leads", "Leads 30 dias", "Criada em", ""].map((c) => h("th", {}, c)))),
          h("tbody", {}, empresas.map((e) => h("tr", {},
            h("td", {}, h("strong", {}, e.nome)),
            h("td", { class: "pequeno" }, e.donos || "", e.dono_pendente ? h("div", { class: "suave" }, `Convite pendente: ${e.dono_pendente}`) : null),
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
