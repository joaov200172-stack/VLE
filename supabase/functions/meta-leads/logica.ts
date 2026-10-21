// Regras da ligação com os formulários instantâneos da Meta (sem dependência do Deno, para testar no Node)

export const VERSAO = "v25.0";
export type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
  Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export class ErroMeta extends Error {
  status: number;
  codigo: number | null;
  constructor(status: number, codigo: number | null, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

// Chamada à Graph API com mensagem de erro em português
export async function graph(fetcher: Fetcher, metodo: string, caminho: string, params: Record<string, string> = {}) {
  const url = new URL(`https://graph.facebook.com/${VERSAO}/${caminho.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetcher(url.toString(), { method: metodo });
  const t = await r.text();
  let j: any = null;
  try { j = JSON.parse(t); } catch { /* resposta sem JSON */ }
  if (!r.ok || j?.error) {
    const e = j?.error ?? {};
    throw new ErroMeta(r.status, e.code ?? null, traduzir(e.code, e.error_subcode, e.message ?? t.slice(0, 200)));
  }
  return j;
}

function traduzir(codigo?: number, sub?: number, msg = ""): string {
  if (codigo === 190) return "Acesso à Meta expirou ou foi removido. Conecte a página de novo.";
  if (codigo === 200 || codigo === 10) return "Falta permissão na Meta (leads_retrieval / acesso a leads da página). " + msg;
  if (codigo === 100 && sub === 33) return "Página ou lead não encontrado, ou sem acesso. " + msg;
  if (codigo === 4 || codigo === 17 || codigo === 32 || codigo === 613) return "Limite de chamadas da Meta atingido; tente de novo em alguns minutos.";
  return "Meta: " + msg;
}

// ---------------------------------------------------------------------
// Assinatura do webhook (X-Hub-Signature-256 = sha256=HMAC(app_secret, corpo))
// ---------------------------------------------------------------------
export async function assinaturaValida(corpo: string, cabecalho: string | null, segredo: string): Promise<boolean> {
  if (!cabecalho || !segredo || !cabecalho.startsWith("sha256=")) return false;
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpo)));
  const esperado = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const recebido = cabecalho.slice(7).toLowerCase();
  if (recebido.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  return dif === 0;
}

// Eventos "leadgen" do corpo do webhook
export function eventosLeadgen(corpo: any): { page_id: string; leadgen_id: string; form_id?: string; ad_id?: string }[] {
  if (corpo?.object !== "page" || !Array.isArray(corpo?.entry)) return [];
  const out: { page_id: string; leadgen_id: string; form_id?: string; ad_id?: string }[] = [];
  for (const e of corpo.entry) {
    for (const c of e?.changes ?? []) {
      const v = c?.value ?? {};
      if (c?.field === "leadgen" && v.leadgen_id) {
        out.push({ page_id: String(v.page_id ?? e.id), leadgen_id: String(v.leadgen_id), form_id: v.form_id ? String(v.form_id) : undefined, ad_id: v.ad_id ? String(v.ad_id) : undefined });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Lead da Meta → parâmetros de public.capturar_lead
// ---------------------------------------------------------------------
const CAMPOS_PADRAO: Record<string, string> = {
  city: "Cidade", state: "Estado", zip_code: "CEP", post_code: "CEP", street_address: "Endereço", country: "País",
  job_title: "Cargo", company_name: "Empresa", date_of_birth: "Nascimento", gender: "Gênero", marital_status: "Estado civil",
  relationship_status: "Estado civil", work_email: "E-mail do trabalho", work_phone_number: "Telefone do trabalho",
};
const rotulo = (k: string) => CAMPOS_PADRAO[k] ?? (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, " ").replace(/\s+/g, " ").trim();

export function telefoneBr(t: string | null): string | null {
  const d = String(t ?? "").replace(/\D/g, "");
  if (!d) return null;
  return (d.length === 12 || d.length === 13) && d.startsWith("55") ? d.slice(2) : d;
}

export type LeadMeta = {
  id: string; created_time?: string; field_data?: { name: string; values?: unknown[] }[];
  ad_id?: string; ad_name?: string; adset_name?: string; campaign_name?: string; form_id?: string;
  is_organic?: boolean; platform?: string;
};

export function paraCaptura(lead: LeadMeta, formNome: string | null, token: string) {
  const campos = new Map<string, string>();
  for (const f of lead.field_data ?? []) {
    const v = (f.values ?? []).filter((x) => x !== null && x !== "").map(String).join(", ").trim();
    if (f.name && v) campos.set(f.name.toLowerCase(), v.slice(0, 1000));
  }
  const tira = (...ks: string[]) => { for (const k of ks) { const v = campos.get(k); if (v) { ks.forEach((x) => campos.delete(x)); return v; } } return null; };
  let nome = tira("full_name", "nome_completo", "nome", "name");
  const primeiro = tira("first_name"), ultimo = tira("last_name");
  if (!nome && (primeiro || ultimo)) nome = [primeiro, ultimo].filter(Boolean).join(" ");
  const telefone = telefoneBr(tira("phone_number", "telefone", "whatsapp_number", "whatsapp", "celular", "phone"));
  const email = tira("email", "e-mail");
  const codigo = tira("codigo_imovel", "codigo", "imovel");
  const plataforma = { ig: "Instagram", fb: "Facebook", an: "Audience Network", ms: "Messenger" }[String(lead.platform ?? "").toLowerCase()] ?? null;
  const linhas = [...campos.entries()].map(([k, v]) => `${rotulo(k)}: ${v}`);
  if (plataforma) linhas.push(`Plataforma: ${plataforma}${lead.is_organic ? " (orgânico)" : ""}`);
  return {
    p_token: token,
    p_nome: nome,
    p_telefone: telefone,
    p_email: email,
    p_mensagem: linhas.length ? linhas.join("\n") : null,
    p_origem: "meta ads",
    p_codigo_imovel: codigo,
    p_anuncio: { id: lead.ad_id ?? null, titulo: lead.ad_name ?? null, campanha: lead.campaign_name ?? null, formulario: formNome ?? null },
    p_ref_externa: "meta:" + lead.id,
  };
}

export const CAMPOS_LEAD = "id,created_time,field_data,ad_id,ad_name,adset_name,campaign_name,form_id,is_organic,platform";

// ---------------------------------------------------------------------
// Processa um lead: busca na Meta, descobre o formulário e grava no CRM
// ---------------------------------------------------------------------
export type Integracao = { id: string; imobiliaria_id: string; page_id: string; page_token: string; ativo: boolean; formularios: Record<string, string> };
export type Db = {
  integracaoPorPagina(pageId: string): Promise<Integracao | null>;
  tokenCaptura(imobId: string): Promise<string>;
  capturar(params: ReturnType<typeof paraCaptura>): Promise<{ lead_id?: string; duplicado?: boolean; ignorado?: string }>;
  registrar(integracaoId: string, patch: { erro?: string | null; novo?: boolean; formularios?: Record<string, string> }): Promise<void>;
};

export async function nomeFormulario(fetcher: Fetcher, integ: Integracao, formId?: string | null): Promise<{ nome: string | null; cache?: Record<string, string> }> {
  if (!formId) return { nome: null };
  if (integ.formularios?.[formId]) return { nome: integ.formularios[formId] };
  try {
    const f = await graph(fetcher, "GET", formId, { fields: "name", access_token: integ.page_token });
    const cache = { ...(integ.formularios ?? {}), [formId]: String(f.name ?? formId) };
    integ.formularios = cache;
    return { nome: cache[formId], cache };
  } catch {
    return { nome: null };
  }
}

export async function processarLead(db: Db, fetcher: Fetcher, integ: Integracao, lead: LeadMeta) {
  const token = await db.tokenCaptura(integ.imobiliaria_id);
  const f = await nomeFormulario(fetcher, integ, lead.form_id);
  const r = await db.capturar(paraCaptura(lead, f.nome, token));
  const novo = !r.ignorado && !r.duplicado;
  await db.registrar(integ.id, { erro: null, novo: !r.ignorado, formularios: f.cache });
  return { ...r, novo };
}

export async function processarWebhook(db: Db, fetcher: Fetcher, corpo: any) {
  const res = { eventos: 0, gravados: 0, ignorados: 0, erros: [] as string[] };
  for (const ev of eventosLeadgen(corpo)) {
    res.eventos++;
    const integ = await db.integracaoPorPagina(ev.page_id);
    if (!integ || !integ.ativo) { res.ignorados++; continue; }
    try {
      const lead = await graph(fetcher, "GET", ev.leadgen_id, { fields: CAMPOS_LEAD, access_token: integ.page_token }) as LeadMeta;
      if (!lead.form_id && ev.form_id) lead.form_id = ev.form_id;
      if (!lead.ad_id && ev.ad_id) lead.ad_id = ev.ad_id;
      const r = await processarLead(db, fetcher, integ, lead);
      if (r.ignorado) res.ignorados++; else res.gravados++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.erros.push(msg);
      await db.registrar(integ.id, { erro: msg });
    }
  }
  return res;
}

// Busca os leads dos últimos N dias de todos os formulários da página (recupera o que não chegou pelo webhook)
export async function importarRecentes(db: Db, fetcher: Fetcher, integ: Integracao, dias: number) {
  const desde = Math.floor(Date.now() / 1000) - Math.max(1, Math.min(dias, 90)) * 86400;
  const res = { formularios: 0, encontrados: 0, novos: 0, ja_existiam: 0 };
  let url: string | null = null;
  const forms: { id: string; name: string }[] = [];
  let pagina = await graph(fetcher, "GET", `${integ.page_id}/leadgen_forms`, { fields: "id,name,status", limit: "100", access_token: integ.page_token });
  for (let i = 0; i < 5; i++) {
    forms.push(...(pagina.data ?? []));
    url = pagina.paging?.next ?? null;
    if (!url) break;
    const r = await fetcher(url, { method: "GET" }); pagina = JSON.parse(await r.text());
  }
  const cache = { ...(integ.formularios ?? {}) };
  for (const f of forms) cache[f.id] = f.name;
  integ.formularios = cache;
  for (const f of forms) {
    res.formularios++;
    const filtro = JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: desde }]);
    let p = await graph(fetcher, "GET", `${f.id}/leads`, { fields: CAMPOS_LEAD, filtering: filtro, limit: "100", access_token: integ.page_token });
    for (let i = 0; i < 20; i++) {
      for (const lead of (p.data ?? []) as LeadMeta[]) {
        res.encontrados++;
        if (!lead.form_id) lead.form_id = f.id;
        const r = await processarLead(db, fetcher, integ, lead);
        if (r.ignorado) res.ja_existiam++; else res.novos++;
      }
      const prox = p.paging?.next;
      if (!prox) break;
      const r = await fetcher(prox, { method: "GET" }); p = JSON.parse(await r.text());
    }
  }
  await db.registrar(integ.id, { erro: null, formularios: cache });
  return res;
}
