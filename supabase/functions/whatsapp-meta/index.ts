// WhatsApp oficial da Meta (Cloud API) direto no CRM, com coexistência (app WhatsApp Business + CRM no mesmo número)
//
// Webhook da Meta (objeto "whatsapp_business_account", campos "messages" e "smb_message_echoes"):
//   GET  .../functions/v1/whatsapp-meta?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
//   POST .../functions/v1/whatsapp-meta  (cabeçalho X-Hub-Signature-256)
// Pelo app (dono logado ou dono geral da plataforma, JWT): POST { acao, imobiliaria_id, ... }
//   config | conectar {code, waba_id, phone_number_id} | conectar_manual {phone_number_id, token} | testar | desconectar
// Cada número novo que escreve vira lead (origem "whatsapp", ou "meta ads" quando veio de anúncio Clique para WhatsApp)
// e entra no rodízio do time escolhido em Configurações → WhatsApp (ou da empresa toda).
import { createClient } from "npm:@supabase/supabase-js@2";
import { assinaturaValida, ErroMeta, eventos, graph, VERSAO } from "./logica.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const URL_FUNCAO = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-meta`;
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

type Params = { verify_token?: string; app_id?: string; app_secret?: string; config_whatsapp?: string };
let parametros: Params | null = null;
async function params(): Promise<Params> {
  if (!parametros?.app_id || !parametros?.config_whatsapp) {
    const { data } = await admin.rpc("meta_parametros");
    parametros = (data ?? {}) as Params;
    const env = Deno.env.get("META_APP_SECRET");
    if (env) parametros.app_secret = env;
  }
  return parametros;
}
const tokenDoApp = (p: Params) => `${p.app_id}|${p.app_secret}`;

type Integ = { imobiliaria_id: string; webhook_token: string; instancia_id: string; token: string; waba_id: string | null };
async function integracaoPorNumero(pid: string): Promise<Integ | null> {
  const { data } = await admin.from("integracoes_whatsapp").select("imobiliaria_id, webhook_token, instancia_id, token, waba_id")
    .eq("provedor", "meta").eq("instancia_id", pid).eq("ativo", true).maybeSingle();
  return data as Integ | null;
}

// Assina o app no objeto do WhatsApp apontando para esta função
async function assinarApp(p: Params) {
  const base = { object: "whatsapp_business_account", callback_url: URL_FUNCAO, verify_token: p.verify_token!, include_values: "true" };
  try {
    await graph(fetch, "POST", `${p.app_id}/subscriptions`, null, { ...base, fields: "messages,smb_message_echoes", access_token: tokenDoApp(p) });
  } catch {
    // contas que ainda não podem receber os ecos do app (coexistência) assinam só as mensagens
    await graph(fetch, "POST", `${p.app_id}/subscriptions`, null, { ...base, fields: "messages", access_token: tokenDoApp(p) });
  }
}

async function finalizarConexao(imobId: string, token: string, wabaId: string, pid: string, coexistencia: boolean) {
  const p = await params();
  const num = await graph(fetch, "GET", pid, token, { fields: "display_phone_number,verified_name" });
  await assinarApp(p);
  await graph(fetch, "POST", `${wabaId}/subscribed_apps`, token, {});
  if (coexistencia) {
    await graph(fetch, "POST", `${pid}/smb_app_data`, token, {}, { messaging_product: "whatsapp", sync_type: "smb_app_state_sync" }).catch(() => null);
  }
  const { data: outro } = await admin.from("integracoes_whatsapp").select("imobiliaria_id").eq("provedor", "meta").eq("instancia_id", pid).neq("imobiliaria_id", imobId).maybeSingle();
  if (outro) throw new Error("Este número já está ligado a outra empresa");
  const reg = {
    imobiliaria_id: imobId, provedor: "meta", instancia_id: pid, token, client_token: null, waba_id: wabaId,
    numero: num.display_phone_number ?? null, nome_verificado: num.verified_name ?? null, coexistencia, ativo: true,
    ultimo_erro: null, updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("integracoes_whatsapp").upsert(reg, { onConflict: "imobiliaria_id" });
  if (error) throw new Error(error.message);
  return { numero: reg.numero, nome: reg.nome_verificado };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const p = await params();
    if (url.searchParams.get("hub.mode") === "subscribe" && p.verify_token && url.searchParams.get("hub.verify_token") === p.verify_token) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405);

  // ---- eventos da Meta ----
  const assinatura = req.headers.get("x-hub-signature-256");
  if (assinatura) {
    const bruto = await req.text();
    if (!(await assinaturaValida(bruto, assinatura, (await params()).app_secret ?? ""))) return json({ erro: "assinatura inválida" }, 401);
    let corpo: unknown = {};
    try { corpo = JSON.parse(bruto); } catch { return json({ erro: "json inválido" }, 400); }
    const cache = new Map<string, Integ | null>();
    const res = { recebidas: 0, celular: 0, status: 0, ignorados: 0, erros: [] as string[] };
    for (const ev of eventos(corpo)) {
      if (!cache.has(ev.phone_number_id)) cache.set(ev.phone_number_id, await integracaoPorNumero(ev.phone_number_id));
      const integ = cache.get(ev.phone_number_id);
      if (!integ) { res.ignorados++; continue; }
      try {
        if (ev.tipo === "status") {
          if (ev.erro) {
            await admin.from("mensagens_whatsapp").update({ status: "erro", erro: ev.erro })
              .eq("imobiliaria_id", integ.imobiliaria_id).eq("ref_externa", ev.message_id);
          }
          res.status++;
          continue;
        }
        const { error } = await admin.rpc("receber_whatsapp", {
          p_token: integ.webhook_token, p_telefone: ev.telefone, p_nome: ev.tipo === "recebida" ? ev.nome : null, p_texto: ev.texto,
          p_de_mim: ev.tipo === "enviada_celular", p_message_id: ev.message_id, p_anuncio: ev.tipo === "recebida" ? ev.anuncio : null,
        });
        if (error) throw new Error(error.message);
        if (ev.tipo === "recebida") res.recebidas++; else res.celular++;
        await admin.from("integracoes_whatsapp").update({ ultima_mensagem_em: new Date().toISOString(), ultimo_erro: null }).eq("imobiliaria_id", integ.imobiliaria_id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        res.erros.push(msg);
        await admin.from("integracoes_whatsapp").update({ ultimo_erro: msg }).eq("imobiliaria_id", integ.imobiliaria_id);
      }
    }
    if (res.erros.length) console.error("whatsapp-meta", res.erros);
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
    const { data: empresa } = await admin.from("imobiliarias").select("id").eq("id", imobId).maybeSingle();
    if (ehAdmin !== true || !empresa) return json({ erro: "apenas o dono conecta o WhatsApp" }, 403);
  }

  try {
    const p = await params();
    if (!p.app_id || !p.app_secret) throw new Error("O app da Meta ainda não foi configurado na plataforma.");
    switch (corpo.acao) {
      case "config":
        return json({ app_id: p.app_id, config_whatsapp: p.config_whatsapp ?? null, versao: VERSAO });

      case "conectar": {
        // Cadastro incorporado (coexistência): troca o código por um token de negócio
        const troca = await graph(fetch, "GET", "oauth/access_token", null, { client_id: p.app_id, client_secret: p.app_secret, code: String(corpo.code ?? "") });
        const r = await finalizarConexao(imobId, troca.access_token, String(corpo.waba_id ?? ""), String(corpo.phone_number_id ?? ""), corpo.coexistencia !== false);
        return json({ ok: true, ...r });
      }

      case "conectar_manual": {
        // Número de teste da Meta ou token de usuário do sistema: descobre a conta (WABA) pelo próprio token
        const token = String(corpo.token ?? "").trim(), pid = String(corpo.phone_number_id ?? "").replace(/\D/g, "");
        if (!token || !pid) return json({ erro: "Informe o ID do número e o token" }, 400);
        let wabaId = String(corpo.waba_id ?? "").replace(/\D/g, "");
        if (!wabaId) {
          const dbg = await graph(fetch, "GET", "debug_token", null, { input_token: token, access_token: tokenDoApp(p) });
          const escopo = (dbg.data?.granular_scopes ?? []).find((s: { scope: string }) => s.scope === "whatsapp_business_management");
          wabaId = escopo?.target_ids?.[0] ?? "";
        }
        if (!wabaId) return json({ erro: "Não achei a conta do WhatsApp (WABA) neste token. Informe o ID da conta do WhatsApp." }, 400);
        const r = await finalizarConexao(imobId, token, wabaId, pid, false);
        return json({ ok: true, ...r });
      }

      case "testar": {
        const { data: w } = await admin.from("integracoes_whatsapp").select("instancia_id, token, waba_id").eq("imobiliaria_id", imobId).eq("provedor", "meta").maybeSingle();
        if (!w) return json({ erro: "WhatsApp oficial não conectado" }, 404);
        const num = await graph(fetch, "GET", w.instancia_id, w.token, { fields: "display_phone_number,verified_name,quality_rating,status,platform_type" });
        const apps = w.waba_id ? await graph(fetch, "GET", `${w.waba_id}/subscribed_apps`, w.token) : { data: [] };
        const nosso = (apps.data ?? []).some((a: any) => (a.whatsapp_business_api_data?.id ?? a.id) === p.app_id);
        await admin.from("integracoes_whatsapp").update({ ultimo_erro: null, numero: num.display_phone_number, nome_verificado: num.verified_name }).eq("imobiliaria_id", imobId);
        return json({ ok: true, numero: num.display_phone_number, nome: num.verified_name, qualidade: num.quality_rating ?? null, status: num.status ?? null, recebendo: nosso });
      }

      case "desconectar": {
        const { data: w } = await admin.from("integracoes_whatsapp").select("token, waba_id").eq("imobiliaria_id", imobId).eq("provedor", "meta").maybeSingle();
        if (!w) return json({ erro: "WhatsApp oficial não conectado" }, 404);
        if (w.waba_id) await graph(fetch, "DELETE", `${w.waba_id}/subscribed_apps`, w.token).catch(() => null);
        await admin.from("integracoes_whatsapp").delete().eq("imobiliaria_id", imobId).eq("provedor", "meta");
        return json({ ok: true });
      }
    }
    return json({ erro: "ação inválida" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ erro: msg }, e instanceof ErroMeta ? 502 : 400);
  }
});
