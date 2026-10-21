// Formulários instantâneos da Meta (Facebook e Instagram) direto no CRM
//
// Webhook da Meta (objeto "page", campo "leadgen"):
//   GET  .../functions/v1/meta-leads?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
//   POST .../functions/v1/meta-leads  (cabeçalho X-Hub-Signature-256, assinado com o segredo do app)
// Pelo app (dono logado ou dono geral da plataforma, JWT): POST { acao, imobiliaria_id, ... }
//   config | paginas {user_token} | conectar {user_token, page_id} | desconectar {page_id}
//   importar {page_id, dias} | testar {page_id}
import { createClient } from "npm:@supabase/supabase-js@2";
import { assinaturaValida, Db, ErroMeta, graph, importarRecentes, Integracao, processarWebhook, VERSAO } from "./logica.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const URL_FUNCAO = `${Deno.env.get("SUPABASE_URL")}/functions/v1/meta-leads`;
const SEGREDO_ENV = Deno.env.get("META_APP_SECRET") ?? "";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

let parametros: { verify_token?: string; app_id?: string; app_secret?: string; config_id?: string } | null = null;
async function params() {
  if (!parametros?.app_id) {
    const { data } = await admin.rpc("meta_parametros");
    parametros = (data ?? {}) as typeof parametros;
    if (SEGREDO_ENV) parametros!.app_secret = SEGREDO_ENV;
  }
  return parametros!;
}

const db: Db = {
  async integracaoPorPagina(pageId) {
    const { data } = await admin.from("integracoes_meta").select("id, imobiliaria_id, page_id, page_token, ativo, formularios").eq("page_id", pageId).maybeSingle();
    return data as Integracao | null;
  },
  async tokenCaptura(imobId) {
    const { data } = await admin.from("imobiliarias").select("token_captura").eq("id", imobId).single();
    return data!.token_captura;
  },
  async capturar(p) {
    const { data, error } = await admin.rpc("capturar_lead", p);
    if (error) throw new Error(error.message.includes("dados_insuficientes") ? "Lead sem nome, telefone e e-mail" : error.message);
    return data;
  },
  async registrar(id, patch) {
    const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.erro !== undefined) upd.ultimo_erro = patch.erro;
    if (patch.formularios) upd.formularios = patch.formularios;
    if (patch.novo) {
      const { data } = await admin.from("integracoes_meta").select("leads_recebidos").eq("id", id).single();
      upd.leads_recebidos = (data?.leads_recebidos ?? 0) + 1;
      upd.ultimo_lead_em = new Date().toISOString();
    }
    await admin.from("integracoes_meta").update(upd).eq("id", id);
  },
};

// Token de usuário (curto, do botão do Facebook ou do Explorador da Graph API) → token longo → páginas com token
async function paginasDoUsuario(userToken: string) {
  const p = await params();
  if (!p.app_id || !p.app_secret) throw new Error("O app da Meta ainda não foi configurado na plataforma.");
  const troca = await graph(fetch, "GET", "oauth/access_token", {
    grant_type: "fb_exchange_token", client_id: p.app_id, client_secret: p.app_secret!, fb_exchange_token: userToken,
  });
  const longo = troca.access_token as string;
  const paginas: { id: string; name: string; access_token: string; tasks?: string[] }[] = [];
  let r = await graph(fetch, "GET", "me/accounts", { fields: "id,name,access_token,tasks", limit: "100", access_token: longo });
  for (let i = 0; i < 5; i++) {
    paginas.push(...(r.data ?? []));
    if (!r.paging?.next) break;
    r = await (await fetch(r.paging.next)).json();
  }
  return paginas;
}

// Inscreve o app no objeto "page" (campo leadgen) apontando para esta função — feito uma vez, sem painel
async function garantirAssinaturaDoApp() {
  const p = await params();
  await graph(fetch, "POST", `${p.app_id}/subscriptions`, {
    object: "page", callback_url: URL_FUNCAO, fields: "leadgen", verify_token: p.verify_token!, include_values: "true",
    access_token: `${p.app_id}|${p.app_secret}`,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);

  // ---- verificação do webhook ----
  if (req.method === "GET") {
    const p = await params();
    if (url.searchParams.get("hub.mode") === "subscribe" && p.verify_token && url.searchParams.get("hub.verify_token") === p.verify_token) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405);

  // ---- evento da Meta ----
  const assinatura = req.headers.get("x-hub-signature-256");
  if (assinatura) {
    const bruto = await req.text();
    if (!(await assinaturaValida(bruto, assinatura, (await params()).app_secret ?? ""))) return json({ erro: "assinatura inválida" }, 401);
    let corpo: unknown = {};
    try { corpo = JSON.parse(bruto); } catch { return json({ erro: "json inválido" }, 400); }
    const res = await processarWebhook(db, fetch, corpo);
    if (res.erros.length) console.error("meta-leads", res.erros);
    return json({ ok: true, ...res });
  }

  // ---- pelo app: só o dono da empresa ou o dono geral da plataforma ----
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ erro: "não autenticado" }, 401);
  const { data: u, error: eu } = await admin.auth.getUser(jwt);
  if (eu || !u?.user) return json({ erro: "sessão inválida" }, 401);
  const corpo = await req.json().catch(() => ({}));
  const imobId = String(corpo.imobiliaria_id ?? "");
  const { data: m } = await admin.from("membros").select("papel").eq("imobiliaria_id", imobId).eq("user_id", u.user.id).eq("ativo", true).maybeSingle();
  if (m?.papel !== "dono") {
    const { data: ehAdmin } = await admin.rpc("eh_admin_plataforma", { p_user: u.user.id });
    if (ehAdmin !== true) return json({ erro: "apenas o dono conecta a Meta" }, 403);
  }

  try {
    const p = await params();
    switch (corpo.acao) {
      case "config":
        return json({ app_id: p.app_id ?? null, config_id: p.config_id ?? null, pronto: !!(p.app_id && p.app_secret), versao: VERSAO });

      case "paginas": {
        const paginas = await paginasDoUsuario(String(corpo.user_token ?? ""));
        const { data: ligadas } = await admin.from("integracoes_meta").select("page_id, imobiliaria_id").in("page_id", paginas.map((x) => x.id));
        return json({
          paginas: paginas.map((x) => {
            const l = (ligadas ?? []).find((y) => y.page_id === x.id);
            return { id: x.id, nome: x.name, leads: !x.tasks || x.tasks.includes("ADVERTISE") || x.tasks.includes("MANAGE"), ligada: l ? (l.imobiliaria_id === imobId ? "aqui" : "outra") : null };
          }),
        });
      }

      case "conectar": {
        const pageId = String(corpo.page_id ?? "");
        const pagina = (await paginasDoUsuario(String(corpo.user_token ?? ""))).find((x) => x.id === pageId);
        if (!pagina) return json({ erro: "Página não encontrada nesta conta do Facebook" }, 404);
        const { data: existente } = await admin.from("integracoes_meta").select("imobiliaria_id").eq("page_id", pageId).maybeSingle();
        if (existente && existente.imobiliaria_id !== imobId) return json({ erro: "Esta página já está ligada a outra imobiliária" }, 409);
        await garantirAssinaturaDoApp();
        await graph(fetch, "POST", `${pageId}/subscribed_apps`, { subscribed_fields: "leadgen", access_token: pagina.access_token });
        const reg = { imobiliaria_id: imobId, page_id: pageId, page_nome: pagina.name, page_token: pagina.access_token, conectado_por: u.user.id, ativo: true, ultimo_erro: null, updated_at: new Date().toISOString() };
        const { error } = await admin.from("integracoes_meta").upsert(reg, { onConflict: "page_id" });
        if (error) throw new Error(error.message);
        return json({ ok: true, pagina: pagina.name });
      }

      case "desconectar": {
        const { data: integ } = await admin.from("integracoes_meta").select("id, page_id, page_token").eq("imobiliaria_id", imobId).eq("page_id", String(corpo.page_id)).maybeSingle();
        if (!integ) return json({ erro: "Página não conectada" }, 404);
        await graph(fetch, "DELETE", `${integ.page_id}/subscribed_apps`, { access_token: integ.page_token }).catch(() => null);
        await admin.from("integracoes_meta").delete().eq("id", integ.id);
        return json({ ok: true });
      }

      case "importar":
      case "testar": {
        const { data: integ } = await admin.from("integracoes_meta").select("id, imobiliaria_id, page_id, page_token, ativo, formularios").eq("imobiliaria_id", imobId).eq("page_id", String(corpo.page_id)).maybeSingle();
        if (!integ) return json({ erro: "Página não conectada" }, 404);
        if (corpo.acao === "testar") {
          const pag = await graph(fetch, "GET", integ.page_id, { fields: "name", access_token: integ.page_token });
          const apps = await graph(fetch, "GET", `${integ.page_id}/subscribed_apps`, { access_token: integ.page_token });
          const nosso = (apps.data ?? []).find((a: { id: string }) => a.id === p.app_id);
          const forms = await graph(fetch, "GET", `${integ.page_id}/leadgen_forms`, { fields: "id,name,status", limit: "100", access_token: integ.page_token });
          await db.registrar(integ.id, { erro: null });
          return json({ ok: true, pagina: pag.name, recebendo: !!nosso && (nosso.subscribed_fields ?? []).includes("leadgen"), formularios: (forms.data ?? []).length });
        }
        const res = await importarRecentes(db, fetch, integ as Integracao, Number(corpo.dias) || 7);
        return json({ ok: true, ...res });
      }
    }
    return json({ erro: "ação inválida" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (["importar", "testar"].includes(corpo.acao) && corpo.page_id) {
      await admin.from("integracoes_meta").update({ ultimo_erro: msg }).eq("imobiliaria_id", imobId).eq("page_id", String(corpo.page_id));
    }
    return json({ erro: msg }, e instanceof ErroMeta ? 502 : 400);
  }
});
