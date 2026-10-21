// Entrada do CRM: login, escolha da empresa, menu e rotas
import { PRODUTO } from "./config.js";
import { sb, estado, h, campo, opcoes, toast, falha, q, traduzirErro, souGeral, gerencio, souDono, souAdmin } from "./lib.js";
import { telaPainel, telaFunil, telaLeads, telaConversas, telaTarefas, telaRelatorios } from "./telas.js";
import { telaEquipe } from "./equipe.js";
import { telaAjustes } from "./ajustes.js";
import { telaPlataforma } from "./plataforma.js";

const app = document.getElementById("app");

const ROTAS = [
  { id: "plataforma", nome: "Todas as empresas", tela: telaPlataforma, so: souAdmin },
  { id: "painel", nome: "Painel", tela: telaPainel },
  { id: "funil", nome: "Funil", tela: telaFunil },
  { id: "leads", nome: "Leads", tela: telaLeads },
  { id: "conversas", nome: "Conversas", tela: telaConversas },
  { id: "tarefas", nome: "Tarefas", tela: telaTarefas },
  { id: "relatorios", nome: "Relatórios", tela: telaRelatorios, so: gerencio },
  { id: "equipe", nome: "Equipe e times", tela: telaEquipe, so: gerencio },
  { id: "ajustes", nome: "Configurações", tela: telaAjustes, so: souGeral },
];

// ---------------- login ----------------
function telaLogin(modo = "entrar") {
  const email = h("input", { type: "email", autocomplete: "email", required: true });
  const senha = h("input", { type: "password", autocomplete: modo === "criar" ? "new-password" : "current-password", required: true, minlength: 6 });
  const nome = h("input", { autocomplete: "name", required: true });
  const msg = h("p", { class: "pequeno" });
  const botao = h("button", { class: "btn primario", type: "submit", style: { width: "100%", justifyContent: "center" } },
    { entrar: "Entrar", criar: "Criar conta", recuperar: "Enviar link" }[modo]);

  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      botao.disabled = true;
      msg.className = "pequeno";
      msg.textContent = "";
      try {
        const redirect = location.origin + location.pathname;
        if (modo === "entrar") {
          const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: senha.value });
          if (error) throw error;
        } else if (modo === "criar") {
          const { data, error } = await sb.auth.signUp({ email: email.value.trim(), password: senha.value, options: { data: { nome: nome.value.trim() }, emailRedirectTo: redirect } });
          if (error) throw error;
          if (data.user && !data.user.identities?.length) msg.textContent = "Este e-mail já tem conta. Volte e clique em Entrar; se não lembrar a senha, use \"Esqueci a senha\".";
          else if (!data.session) msg.textContent = "Conta criada. Enviamos um link de confirmação para o seu e-mail (veja também o spam); depois de confirmar, entre aqui.";
        } else {
          const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: redirect });
          if (error) throw error;
          msg.textContent = "Se o e-mail tiver conta, enviamos um link para criar uma senha nova.";
        }
      } catch (err) {
        msg.className = "pequeno erro-txt";
        msg.textContent = traduzirErro(err.message);
      } finally {
        botao.disabled = false;
      }
    },
  },
  modo === "criar" ? campo("Seu nome", nome) : null,
  campo("E-mail", email),
  modo !== "recuperar" ? campo("Senha", senha) : null,
  botao, msg);

  const link = (texto, m) => h("a", { href: "#", onclick: (e) => { e.preventDefault(); telaLogin(m); } }, texto);
  app.replaceChildren(h("div", { class: "tela-login" }, h("div", { class: "caixa-login" },
    h("div", { class: "marca" }, h("div", { class: "logo" }, "VLE"), h("strong", {}, `${PRODUTO} CRM`)),
    form,
    h("p", { class: "pequeno suave" },
      modo === "entrar" ? [link("Criar conta", "criar"), " · ", link("Esqueci a senha", "recuperar")] : link("Voltar para entrar", "entrar")))));
}

function telaNovaSenha() {
  const senha = h("input", { type: "password", minlength: 6, required: true, autocomplete: "new-password" });
  app.replaceChildren(h("div", { class: "tela-login" }, h("div", { class: "caixa-login" },
    h("h2", {}, "Crie uma senha nova"),
    h("form", { onsubmit: async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.updateUser({ password: senha.value });
      if (error) return toast(traduzirErro(error.message), true);
      toast("Senha alterada.");
      iniciar();
    } }, campo("Senha nova", senha), h("button", { class: "btn primario", type: "submit" }, "Salvar")))));
}

// ---------------- empresa ----------------
function telaSemAcesso() {
  app.replaceChildren(h("div", { class: "tela-login" }, h("div", { class: "caixa-login" },
    h("div", { class: "marca" }, h("div", { class: "logo" }, "VLE"), h("strong", {}, `${PRODUTO} CRM`)),
    h("p", {}, "Sua conta ainda não está ligada a nenhuma empresa."),
    h("p", { class: "suave pequeno" }, "Peça ao responsável pela sua empresa um convite para o e-mail ", h("strong", {}, estado.usuario.email), ". Depois de convidado, é só entrar de novo."),
    h("p", { class: "pequeno" }, h("a", { href: "#", onclick: (e) => { e.preventDefault(); location.reload(); } }, "Já fui convidado"), " · ",
      h("a", { href: "#", onclick: (e) => { e.preventDefault(); sb.auth.signOut(); } }, "Sair")))));
}

// Empresas que o usuário pode abrir. O dono geral da plataforma abre todas.
export async function carregarVinculos() {
  estado.admin = (await sb.rpc("sou_admin_plataforma")).data === true;
  const meus = await q(sb.from("membros").select("imobiliaria_id, papel, time_id, nome, imobiliarias(nome)").eq("user_id", estado.usuario.id).eq("ativo", true));
  if (!estado.admin) return (estado.vinculos = meus);
  const todas = await q(sb.from("imobiliarias").select("id, nome").order("nome"));
  estado.vinculos = todas.map((i) => meus.find((m) => m.imobiliaria_id === i.id) ?? { imobiliaria_id: i.id, papel: "dono", time_id: null, nome: null, imobiliarias: { nome: i.nome } });
  return estado.vinculos;
}

export async function abrirEmpresa(id, rota = "painel") {
  estado.empresaId = id;
  localStorage.setItem("vle:empresa", id);
  estado.filtroTime = "";
  await carregarEmpresa();
  if (location.hash === `#/${rota}`) casca(); else location.hash = `#/${rota}`;
}

export async function carregarEmpresa() {
  const id = estado.empresaId;
  const [empresa, equipe, times, etapas, whats] = await Promise.all([
    q(sb.from("imobiliarias").select("id, nome, minutos_primeiro_contato").eq("id", id).single()),
    q(sb.from("membros").select("*").eq("imobiliaria_id", id).order("nome")),
    q(sb.from("times").select("id, nome, ativo, created_at").eq("imobiliaria_id", id).order("nome")),
    q(sb.from("etapas_funil").select("*").eq("imobiliaria_id", id).order("ordem")),
    sb.rpc("whatsapp_integrado", { p_imobiliaria_id: id }),
  ]);
  Object.assign(estado, { empresa, equipe, times, etapas, whatsapp: whats.data === true });
  estado.eu = equipe.find((m) => m.user_id === estado.usuario.id) ?? estado.vinculos.find((v) => v.imobiliaria_id === id);
  if (estado.admin) estado.eu = { ...(estado.eu ?? {}), papel: "dono", time_id: null, nome: estado.eu?.nome ?? "Dono geral" };
  if (!souGeral()) estado.filtroTime = "";
}

// ---------------- casca ----------------
let telaAtual = null;
function casca() {
  const menu = h("nav", { class: "menu" });
  const topo = h("header", { class: "topo" });
  const conteudo = h("main", { class: "conteudo" });
  app.replaceChildren(h("div", { class: "casca" }, menu, h("div", { class: "principal" }, topo, conteudo)));

  const rota = (location.hash.replace(/^#\/?/, "").split("/")[0]) || "painel";
  const atual = ROTAS.find((r) => r.id === rota && (!r.so || r.so())) ?? ROTAS[0];

  menu.append(
    h("div", { class: "marca" }, h("div", { class: "logo" }, "VLE"), h("strong", {}, PRODUTO)),
    ...ROTAS.filter((r) => !r.so || r.so()).map((r) => h("a", { href: `#/${r.id}`, class: r === atual ? "ativo" : "", onclick: () => menu.classList.remove("aberto") }, r.nome)),
    h("div", { class: "rodape" },
      h("div", {}, estado.eu?.nome ?? estado.usuario.email),
      h("div", { class: "suave" }, papelTexto()),
      h("button", { onclick: () => sb.auth.signOut() }, "Sair")));

  const seletorEmpresa = estado.vinculos.length > 1
    ? h("select", { onchange: async (e) => { estado.empresaId = e.target.value; localStorage.setItem("vle:empresa", e.target.value); estado.filtroTime = ""; await carregarEmpresa(); casca(); } },
      opcoes(estado.vinculos.map((v) => [v.imobiliaria_id, v.imobiliarias?.nome ?? "Empresa"]), estado.empresaId))
    : h("strong", {}, estado.empresa.nome);

  const seletorTime = souGeral() && estado.times.length
    ? h("select", { title: "Filtrar por time", onchange: (e) => { estado.filtroTime = e.target.value; casca(); } },
      opcoes([["sem", "Sem time"], ...estado.times.map((t) => [t.id, t.nome])], estado.filtroTime, "Todos os times"))
    : estado.eu?.time_id ? h("span", { class: "etiqueta time" }, "Time: " + (estado.times.find((t) => t.id === estado.eu.time_id)?.nome ?? "")) : null;

  topo.append(h("button", { class: "btn botao-menu", onclick: () => menu.classList.toggle("aberto") }, "☰"), seletorEmpresa, seletorTime);

  if (telaAtual?.sair) telaAtual.sair();
  telaAtual = null;
  Promise.resolve(atual.tela(conteudo)).then((t) => { telaAtual = t ?? null; }).catch((e) => {
    conteudo.replaceChildren(h("div", { class: "cartao erro-txt" }, e.message));
  });
}

function papelTexto() {
  const e = estado.eu;
  if (!e) return "";
  if (souAdmin()) return "Dono geral · todas as empresas";
  if (e.papel === "dono") return "Dono · vê tudo";
  if (e.papel === "gerente" && !e.time_id) return "Gerente geral · vê tudo";
  const t = estado.times.find((x) => x.id === e.time_id)?.nome;
  return (e.papel === "gerente" ? "Gerente" : "Corretor") + (t ? ` · ${t}` : "");
}

// ---------------- início ----------------
let iniciando = false;
async function iniciar() {
  if (iniciando) return;
  iniciando = true;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return telaLogin();
    estado.usuario = session.user;
    await sb.rpc("aceitar_convites", { p_nome: session.user.user_metadata?.nome ?? null });
    await carregarVinculos();
    if (!estado.vinculos.length && !estado.admin) return telaSemAcesso();
    const salvo = localStorage.getItem("vle:empresa");
    estado.empresaId = estado.vinculos.some((v) => v.imobiliaria_id === salvo) ? salvo : estado.vinculos[0].imobiliaria_id;
    await carregarEmpresa();
    casca();
  } catch (e) {
    app.replaceChildren(h("div", { class: "tela-login" }, h("div", { class: "caixa-login" }, h("p", { class: "erro-txt" }, e.message),
      h("button", { class: "btn", onclick: () => location.reload() }, "Tentar de novo"), " ",
      h("button", { class: "btn", onclick: () => sb.auth.signOut() }, "Sair"))));
  } finally {
    iniciando = false;
  }
}

sb.auth.onAuthStateChange((evento) => {
  if (evento === "PASSWORD_RECOVERY") return telaNovaSenha();
  if (evento === "SIGNED_IN" && !estado.usuario) iniciar();
  if (evento === "SIGNED_OUT") { estado.usuario = null; telaLogin(); }
});
window.addEventListener("hashchange", () => { if (estado.empresa) casca(); });
export const recarregar = () => casca();
iniciar();
