// Cobrança automática das empresas do CRM pelo Asaas (Pix, boleto e cartão, mensal)
//
// Webhook do Asaas: POST .../functions/v1/asaas  (cabeçalho asaas-access-token)
// Pelo app (só o dono geral, JWT): POST { acao, ... }
//   conectar                      valida a chave e cadastra o webhook no Asaas
//   assinar {imobiliaria_id, nome, cpf_cnpj, email, telefone, valor, dia, forma, descricao}
//   alterar {imobiliaria_id, valor, forma}
//   cancelar {imobiliaria_id}
//   sincronizar {imobiliaria_id}
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const URL_FUNCAO = `${Deno.env.get("SUPABASE_URL")}/functions/v1/asaas`;
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const EVENTOS = [
  "PAYMENT_CREATED", "PAYMENT_UPDATED", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_OVERDUE",
  "PAYMENT_DELETED", "PAYMENT_RESTORED", "PAYMENT_REFUNDED", "PAYMENT_RECEIVED_IN_CASH_UNDONE",
  "PAYMENT_CHARGEBACK_REQUESTED", "PAYMENT_AWAITING_RISK_ANALYSIS", "PAYMENT_APPROVED_BY_RISK_ANALYSIS",
];
const PAGO = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"];

type Params = { api_key: string | null; webhook_token: string | null; ambiente: "producao" | "sandbox" };
async function params(): Promise<Params> {
  const { data, error } = await admin.rpc("asaas_parametros");
  if (error) throw new Error(error.message);
  return data as Params;
}

async function asaas(p: Params, metodo: string, caminho: string, corpo?: unknown) {
  if (!p.api_key) throw new Error("O Asaas ainda não foi conectado. Cole a chave da API em Todas as empresas.");
  const base = p.ambiente === "sandbox" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3";
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { "access_token": p.api_key, "Content-Type": "application/json", "User-Agent": "CRM-VLE" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const t = await r.text();
  let j: any = null;
  try { j = JSON.parse(t); } catch { /* sem json */ }
  if (!r.ok) {
    if (r.status === 401) throw new Error("Chave do Asaas inválida ou de outro ambiente (produção x sandbox).");
    const msg = j?.errors?.map((e: { description: string }) => e.description).join(" ") || t.slice(0, 200);
    throw new Error("Asaas: " + msg);
  }
  return j;
}

const hoje = () => new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function proximaData(dia: number) {
  const h = hoje();
  const d = new Date(h.getFullYear(), h.getMonth(), dia);
  if (d <= h) d.setMonth(d.getMonth() + 1);
  return iso(d);
}

// grava a cobrança e recalcula a situação da empresa
async function gravarCobranca(pg: any, imobId: string) {
  const removida = pg.deleted === true;
  await admin.from("cobrancas").upsert({
    id: pg.id, imobiliaria_id: imobId, asaas_assinatura: pg.subscription ?? null, valor: pg.value, vencimento: pg.dueDate,
    status: removida ? "DELETED" : pg.status, forma: pg.billingType, link: pg.invoiceUrl ?? null,
    pago_em: pg.clientPaymentDate || pg.paymentDate || pg.confirmedDate || null, updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
}

async function recalcular(imobId: string) {
  const { data: ass } = await admin.from("assinaturas").select("status").eq("imobiliaria_id", imobId).maybeSingle();
  if (!ass) return;
  const { data: cs } = await admin.from("cobrancas").select("status, vencimento, pago_em").eq("imobiliaria_id", imobId).neq("status", "DELETED").order("vencimento", { ascending: false });
  const lista = cs ?? [];
  const pagas = lista.filter((c) => PAGO.includes(c.status ?? ""));
  const abertas = lista.filter((c) => ["PENDING", "OVERDUE", "AWAITING_RISK_ANALYSIS"].includes(c.status ?? "")).sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
  const upd: Record<string, unknown> = {
    proximo_vencimento: abertas[0]?.vencimento ?? null,
    ultimo_pagamento_em: pagas.map((c) => c.pago_em).filter(Boolean).sort().pop() ?? null,
    updated_at: new Date().toISOString(),
  };
  if (ass.status !== "cancelada") {
    upd.status = lista.some((c) => c.status === "OVERDUE") ? "atrasada" : pagas.length ? "em_dia" : "aguardando";
  }
  await admin.from("assinaturas").update(upd).eq("imobiliaria_id", imobId);
}

async function sincronizar(p: Params, imobId: string) {
  const { data: ass } = await admin.from("assinaturas").select("asaas_assinatura").eq("imobiliaria_id", imobId).maybeSingle();
  if (!ass?.asaas_assinatura) throw new Error("Esta empresa não tem cobrança no Asaas.");
  const r = await asaas(p, "GET", `/payments?subscription=${ass.asaas_assinatura}&limit=100`);
  for (const pg of r.data ?? []) await gravarCobranca(pg, imobId);
  await recalcular(imobId);
  return (r.data ?? []).length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405);

  // ---- webhook do Asaas ----
  const tokenWebhook = req.headers.get("asaas-access-token");
  if (tokenWebhook !== null) {
    const p = await params();
    if (!p.webhook_token || tokenWebhook !== p.webhook_token) return json({ erro: "token inválido" }, 401);
    const ev = await req.json().catch(() => null);
    const pg = ev?.payment;
    if (!pg?.id) return json({ ok: true, ignorado: "sem cobrança" });
    let imobId: string | null = null;
    if (pg.subscription) {
      const { data } = await admin.from("assinaturas").select("imobiliaria_id").eq("asaas_assinatura", pg.subscription).maybeSingle();
      imobId = data?.imobiliaria_id ?? null;
    }
    if (!imobId && pg.externalReference) {
      const { data } = await admin.from("assinaturas").select("imobiliaria_id").eq("imobiliaria_id", pg.externalReference).maybeSingle();
      imobId = data?.imobiliaria_id ?? null;
    }
    if (!imobId) return json({ ok: true, ignorado: "cobrança fora do CRM" });
    if (ev.event === "PAYMENT_DELETED") pg.deleted = true;
    await gravarCobranca(pg, imobId);
    await recalcular(imobId);
    return json({ ok: true });
  }

  // ---- pelo app: só o dono geral da plataforma ----
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ erro: "não autenticado" }, 401);
  const { data: u, error: eu } = await admin.auth.getUser(jwt);
  if (eu || !u?.user) return json({ erro: "sessão inválida" }, 401);
  const { data: ehAdmin } = await admin.rpc("eh_admin_plataforma", { p_user: u.user.id });
  if (ehAdmin !== true) return json({ erro: "apenas o dono geral cuida da cobrança" }, 403);

  const corpo = await req.json().catch(() => ({}));
  const imobId = String(corpo.imobiliaria_id ?? "");
  try {
    const p = await params();
    switch (corpo.acao) {
      case "conectar": {
        const conta = await asaas(p, "GET", "/myAccount");
        const lista = await asaas(p, "GET", "/webhooks?limit=100");
        const existente = (lista.data ?? []).find((w: { url: string }) => w.url === URL_FUNCAO);
        const dados = {
          name: "CRM VLE", url: URL_FUNCAO, email: u.user.email, enabled: true, interrupted: false,
          apiVersion: 3, authToken: p.webhook_token, sendType: "SEQUENTIALLY", events: EVENTOS,
        };
        const wh = existente ? await asaas(p, "PUT", `/webhooks/${existente.id}`, dados) : await asaas(p, "POST", "/webhooks", dados);
        await admin.rpc("asaas_registrar_webhook", { p_webhook_id: wh.id, p_conta: conta.name ?? conta.email ?? null });
        return json({ ok: true, conta: conta.name ?? conta.email ?? null });
      }

      case "assinar": {
        const { data: emp } = await admin.from("imobiliarias").select("id, nome").eq("id", imobId).maybeSingle();
        if (!emp) return json({ erro: "Empresa não encontrada" }, 404);
        const { data: atual } = await admin.from("assinaturas").select("asaas_assinatura, status, asaas_cliente").eq("imobiliaria_id", imobId).maybeSingle();
        if (atual?.asaas_assinatura && atual.status !== "cancelada") return json({ erro: "Esta empresa já tem cobrança ativa." }, 409);
        const valor = Number(corpo.valor), dia = Number(corpo.dia);
        const doc = String(corpo.cpf_cnpj ?? "").replace(/\D/g, "");
        if (!(valor > 0)) return json({ erro: "Informe o valor da mensalidade" }, 400);
        if (!(dia >= 1 && dia <= 28)) return json({ erro: "Dia de vencimento entre 1 e 28" }, 400);
        if (doc.length !== 11 && doc.length !== 14) return json({ erro: "CPF ou CNPJ inválido" }, 400);
        const forma = ["PIX", "BOLETO", "CREDIT_CARD"].includes(corpo.forma) ? corpo.forma : "UNDEFINED";
        const nome = String(corpo.nome || emp.nome).trim();
        const email = String(corpo.email ?? "").trim() || undefined;
        const fone = String(corpo.telefone ?? "").replace(/\D/g, "") || undefined;
        const descricao = String(corpo.descricao || `Mensalidade CRM e marketing - ${emp.nome}`).slice(0, 500);

        const cliente = atual?.asaas_cliente
          ? await asaas(p, "PUT", `/customers/${atual.asaas_cliente}`, { name: nome, cpfCnpj: doc, email, mobilePhone: fone })
          : await asaas(p, "POST", "/customers", { name: nome, cpfCnpj: doc, email, mobilePhone: fone, externalReference: imobId, notificationDisabled: false });
        const sub = await asaas(p, "POST", "/subscriptions", {
          customer: cliente.id, billingType: forma, value: valor, nextDueDate: proximaData(dia), cycle: "MONTHLY",
          description: descricao, externalReference: imobId,
        });
        const { error } = await admin.from("assinaturas").upsert({
          imobiliaria_id: imobId, asaas_cliente: cliente.id, asaas_assinatura: sub.id, nome_cobranca: nome, cpf_cnpj: doc,
          email: email ?? null, telefone: fone ?? null, valor, dia_vencimento: dia, forma, descricao, status: "aguardando",
          proximo_vencimento: sub.nextDueDate, updated_at: new Date().toISOString(),
        }, { onConflict: "imobiliaria_id" });
        if (error) throw new Error(error.message);
        await sincronizar(p, imobId).catch(() => 0);
        return json({ ok: true });
      }

      case "alterar": {
        const { data: ass } = await admin.from("assinaturas").select("asaas_assinatura").eq("imobiliaria_id", imobId).maybeSingle();
        if (!ass?.asaas_assinatura) return json({ erro: "Sem cobrança ativa" }, 404);
        const valor = Number(corpo.valor);
        if (!(valor > 0)) return json({ erro: "Informe o valor" }, 400);
        const forma = ["PIX", "BOLETO", "CREDIT_CARD", "UNDEFINED"].includes(corpo.forma) ? corpo.forma : "UNDEFINED";
        await asaas(p, "PUT", `/subscriptions/${ass.asaas_assinatura}`, { value: valor, billingType: forma, updatePendingPayments: true });
        await admin.from("assinaturas").update({ valor, forma, updated_at: new Date().toISOString() }).eq("imobiliaria_id", imobId);
        await sincronizar(p, imobId).catch(() => 0);
        return json({ ok: true });
      }

      case "cancelar": {
        const { data: ass } = await admin.from("assinaturas").select("asaas_assinatura").eq("imobiliaria_id", imobId).maybeSingle();
        if (!ass?.asaas_assinatura) return json({ erro: "Sem cobrança ativa" }, 404);
        await asaas(p, "DELETE", `/subscriptions/${ass.asaas_assinatura}`);
        await admin.from("assinaturas").update({ status: "cancelada", updated_at: new Date().toISOString() }).eq("imobiliaria_id", imobId);
        return json({ ok: true });
      }

      case "sincronizar":
        return json({ ok: true, cobrancas: await sincronizar(p, imobId) });
    }
    return json({ erro: "ação inválida" }, 400);
  } catch (e) {
    return json({ erro: e instanceof Error ? e.message : String(e) }, 400);
  }
});
