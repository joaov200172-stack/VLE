// Base compartilhada: cliente do Supabase, estado da sessão, permissões e utilitários de tela
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_CHAVE } from "./config.js";

export const sb = createClient(SUPABASE_URL, SUPABASE_CHAVE, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const estado = {
  usuario: null,
  admin: false,
  vinculos: [], // membros do usuário em cada empresa (com o nome da empresa)
  empresaId: null,
  eu: null, // meu registro em membros na empresa atual
  empresa: null,
  equipe: [],
  times: [],
  etapas: [],
  whatsapp: false,
  filtroTime: "", // "" = todos, "sem" = sem time, ou id do time
};

// ---------- permissões ----------
export const souAdmin = () => estado.admin === true; // dono geral da plataforma: vê todas as empresas
export const souDono = () => estado.eu?.papel === "dono";
export const souGeral = () => souDono() || (estado.eu?.papel === "gerente" && !estado.eu?.time_id);
export const souGerenteTime = () => estado.eu?.papel === "gerente" && !!estado.eu?.time_id;
export const gerencio = () => souGeral() || souGerenteTime();

// ---------- consultas ----------
export async function q(promessa) {
  const { data, error } = await promessa;
  if (error) throw new Error(traduzirErro(error.message));
  return data;
}

export function traduzirErro(msg = "") {
  if (/row-level security|permission denied/i.test(msg)) return "Você não tem permissão para fazer isso.";
  if (/duplicate key/i.test(msg)) return "Já existe um registro igual.";
  if (/Invalid login credentials/i.test(msg)) return "E-mail ou senha incorretos.";
  if (/Email not confirmed/i.test(msg)) return "Confirme o seu e-mail pelo link que enviamos antes de entrar.";
  if (/User already registered/i.test(msg)) return "Este e-mail já tem conta. Use \"Entrar\".";
  if (/Password should be/i.test(msg)) return "A senha precisa ter pelo menos 6 caracteres.";
  if (/violates foreign key/i.test(msg)) return "Este item está em uso e não pode ser removido.";
  return msg;
}

// Aplica o filtro de time escolhido no topo (só para quem vê todos os times)
export function comFiltroTime(consulta, coluna = "time_id") {
  if (!souGeral() || !estado.filtroTime) return consulta;
  return estado.filtroTime === "sem" ? consulta.is(coluna, null) : consulta.eq(coluna, estado.filtroTime);
}

export async function chamarFuncao(nome, corpo) {
  const { data, error } = await sb.functions.invoke(nome, { body: corpo });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.erro ?? msg; } catch { /* sem corpo */ }
    throw new Error(msg);
  }
  if (data?.erro) throw new Error(data.erro);
  return data;
}

// ---------- DOM ----------
export function h(tag, attrs = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const f of filhos.flat(Infinity)) {
    if (f === null || f === undefined || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return el;
}

export function campo(rotulo, entrada, ajuda) {
  return h("div", { class: "campo" }, h("label", {}, rotulo), entrada, ajuda ? h("span", { class: "suave pequeno" }, ajuda) : null);
}

export function opcoes(lista, valorAtual, vazio) {
  const out = [];
  if (vazio !== undefined) out.push(h("option", { value: "" }, vazio));
  for (const o of lista) {
    const [v, t] = Array.isArray(o) ? o : [o.id ?? o.user_id, o.nome];
    out.push(h("option", { value: v, selected: String(v) === String(valorAtual ?? "") }, t));
  }
  return out;
}

export function toast(msg, erro = false) {
  const raiz = document.getElementById("toast-raiz");
  const t = h("div", { class: "toast" + (erro ? " erro" : "") }, msg);
  raiz.replaceChildren(t);
  setTimeout(() => t.remove(), erro ? 6000 : 3000);
}

export function falha(e) {
  console.error(e);
  toast(e?.message ?? String(e), true);
}

// Janela central; devolve a função que fecha
export function janela(titulo, conteudo, { largura } = {}) {
  const raiz = document.getElementById("modal-raiz");
  const fechar = () => fundo.remove();
  const caixa = h("div", { class: "janela", style: largura ? { width: `min(${largura}px, 100%)` } : null },
    h("div", { class: "linha" }, h("h2", { style: { margin: 0 } }, titulo), h("button", { class: "fechar", onclick: fechar, "aria-label": "Fechar" }, "×")),
    h("div", { style: { marginTop: "14px" } }, conteudo));
  const fundo = h("div", { class: "fundo-modal centro", onclick: (e) => { if (e.target === fundo) fechar(); } }, caixa);
  raiz.append(fundo);
  return fechar;
}

export function confirmar(texto) {
  return window.confirm(texto);
}

// ---------- formatos ----------
const fmtDataHora = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtDia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
export const dataHora = (d) => (d ? fmtDataHora.format(new Date(d)) : "");
export const dia = (d) => (d ? fmtDia.format(new Date(d)) : "");
export const moeda = (v) => (v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }));
export function telefone(t) {
  const d = String(t ?? "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t ?? "";
}
export function haQuanto(d) {
  if (!d) return "";
  const min = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const hrs = Math.round(min / 60);
  if (hrs < 48) return `${hrs} h`;
  return `${Math.round(hrs / 24)} dias`;
}
// valor de <input type="datetime-local"> no fuso do navegador
export function paraInputData(d) {
  const x = d ? new Date(d) : new Date();
  const off = x.getTimezoneOffset();
  return new Date(x.getTime() - off * 60000).toISOString().slice(0, 16);
}

export const nomeMembro = (id) => estado.equipe.find((m) => m.user_id === id)?.nome ?? "";
export const nomeTime = (id) => estado.times.find((t) => t.id === id)?.nome ?? "";
export const etapa = (id) => estado.etapas.find((e) => e.id === id);
export const PAPEIS = { dono: "Dono", gerente: "Gerente", corretor: "Corretor" };

export function urlCaptura(token) {
  return `${SUPABASE_URL}/functions/v1/captura-lead?token=${token}`;
}
export { SUPABASE_URL };
