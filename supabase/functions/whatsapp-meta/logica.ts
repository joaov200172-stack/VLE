// WhatsApp oficial da Meta (Cloud API): leitura do webhook e envio (sem dependência do Deno, para testar no Node)

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

export function traduzirErro(codigo?: number | null, msg = "", detalhe = ""): string {
  switch (codigo) {
    case 131047: return "Passaram mais de 24 h desde a última mensagem do cliente: a Meta só deixa enviar modelo aprovado. Responda pelo celular ou espere o cliente escrever.";
    case 131026: return "Este número não recebe mensagens pelo WhatsApp (sem WhatsApp ou bloqueou a empresa).";
    case 131051: return "Tipo de mensagem não suportado.";
    case 131056: return "Muitas mensagens para o mesmo número em pouco tempo; tente de novo em instantes.";
    case 130429: case 80007: case 4: return "Limite de envio da Meta atingido; tente de novo em alguns minutos.";
    case 190: return "O acesso ao WhatsApp da Meta expirou. Conecte o número de novo em Configurações → WhatsApp.";
    case 100: return "Meta: " + (detalhe || msg);
    case 10: case 200: return "Falta permissão no WhatsApp da Meta. " + msg;
  }
  return "Meta: " + (detalhe || msg || "erro desconhecido");
}

export async function graph(fetcher: Fetcher, metodo: string, caminho: string, token: string | null, params: Record<string, string> = {}, corpo?: unknown) {
  const url = new URL(`https://graph.facebook.com/${VERSAO}/${caminho.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (corpo !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetcher(url.toString(), { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const t = await r.text();
  let j: any = null;
  try { j = JSON.parse(t); } catch { /* sem JSON */ }
  if (!r.ok || j?.error) {
    const e = j?.error ?? {};
    throw new ErroMeta(r.status, e.code ?? null, traduzirErro(e.code, e.message ?? t.slice(0, 200), e.error_data?.details));
  }
  return j;
}

// Assinatura do webhook (X-Hub-Signature-256)
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

// wa_id brasileiro às vezes vem sem o 9 do celular (55 + DDD + 8 dígitos): devolve com o 9
export function telefoneWa(waId: string): string {
  const d = String(waId ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("55") && /[6-9]/.test(d[4])) return d.slice(0, 4) + "9" + d.slice(4);
  return d;
}

export function textoDaMensagem(m: any): string {
  switch (m?.type) {
    case "text": return String(m.text?.body ?? "");
    case "image": return `[Foto]${m.image?.caption ? " " + m.image.caption : ""}`;
    case "video": return `[Vídeo]${m.video?.caption ? " " + m.video.caption : ""}`;
    case "audio": return m.audio?.voice ? "[Áudio]" : "[Áudio]";
    case "document": return `[Documento] ${m.document?.filename ?? ""}${m.document?.caption ? " " + m.document.caption : ""}`.trim();
    case "sticker": return "[Figurinha]";
    case "location": return `[Localização] ${[m.location?.name, m.location?.address].filter(Boolean).join(" - ")} https://maps.google.com/?q=${m.location?.latitude},${m.location?.longitude}`.trim();
    case "contacts": return `[Contato] ${(m.contacts ?? []).map((c: any) => [c.name?.formatted_name, ...(c.phones ?? []).map((p: any) => p.phone)].filter(Boolean).join(" ")).join("; ")}`;
    case "button": return String(m.button?.text ?? "");
    case "interactive": return String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? m.interactive?.nfm_reply?.body ?? "");
    case "reaction": return "";
    case "order": return "[Pedido]";
    case "unsupported": return "[Mensagem não suportada]";
  }
  return "";
}

export function anuncioDaMensagem(m: any) {
  const r = m?.referral;
  if (!r) return null;
  if (r.source_type && r.source_type !== "ad" && !r.ctwa_clid) return null;
  return { id: r.source_id ? String(r.source_id) : null, titulo: r.headline ?? null, texto: r.body ?? null, url: r.source_url ?? null, ctwa_clid: r.ctwa_clid ?? null };
}

export type Evento =
  | { tipo: "recebida"; phone_number_id: string; telefone: string; nome: string | null; texto: string; message_id: string; anuncio: ReturnType<typeof anuncioDaMensagem> }
  | { tipo: "enviada_celular"; phone_number_id: string; telefone: string; texto: string; message_id: string }
  | { tipo: "status"; phone_number_id: string; message_id: string; status: string; erro: string | null };

// Corpo do webhook → eventos na ordem em que chegaram
export function eventos(corpo: any): Evento[] {
  if (corpo?.object !== "whatsapp_business_account" || !Array.isArray(corpo?.entry)) return [];
  const out: Evento[] = [];
  for (const e of corpo.entry) {
    for (const c of e?.changes ?? []) {
      const v = c?.value ?? {};
      const pid = String(v.metadata?.phone_number_id ?? "");
      if (!pid) continue;
      if (c.field === "messages") {
        const nomes = new Map<string, string>();
        for (const ct of v.contacts ?? []) if (ct?.wa_id) nomes.set(String(ct.wa_id), ct.profile?.name ?? null);
        for (const m of v.messages ?? []) {
          const texto = textoDaMensagem(m);
          if (!texto || !m.from) continue;
          out.push({ tipo: "recebida", phone_number_id: pid, telefone: telefoneWa(m.from), nome: nomes.get(String(m.from)) ?? null, texto, message_id: String(m.id), anuncio: anuncioDaMensagem(m) });
        }
        for (const s of v.statuses ?? []) {
          const er = (s.errors ?? [])[0];
          out.push({ tipo: "status", phone_number_id: pid, message_id: String(s.id), status: String(s.status), erro: er ? traduzirErro(er.code, er.title ?? er.message, er.error_data?.details) : null });
        }
      } else if (c.field === "smb_message_echoes") {
        for (const m of v.message_echoes ?? []) {
          const texto = textoDaMensagem(m);
          if (!texto || !m.to) continue;
          out.push({ tipo: "enviada_celular", phone_number_id: pid, telefone: telefoneWa(m.to), texto, message_id: String(m.id) });
        }
      }
    }
  }
  return out;
}

// Envio de texto pela Cloud API; devolve o id da mensagem (wamid)
export async function enviarTexto(fetcher: Fetcher, phoneNumberId: string, token: string, para: string, texto: string): Promise<string | null> {
  const r = await graph(fetcher, "POST", `${phoneNumberId}/messages`, token, {}, {
    messaging_product: "whatsapp", recipient_type: "individual", to: String(para).replace(/\D/g, ""),
    type: "text", text: { preview_url: true, body: texto.slice(0, 4096) },
  });
  return r?.messages?.[0]?.id ?? null;
}
