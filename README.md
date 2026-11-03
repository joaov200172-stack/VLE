# VLE CRM

CRM da VLE para agências e incorporadoras. A empresa mãe cadastra **times**; cada time vê só os próprios leads, e o dono e os gerentes sem time (gerentes gerais) veem tudo.

## Como funciona

- **Front-end:** HTML, CSS e JavaScript puro (módulos ES), sem build. Publicado pelo GitHub Pages a cada push na `main` (`.github/workflows/pages.yml`).
- **Back-end:** Supabase (projeto `dmmifwbgncfmwyaizitg`, São Paulo). Banco Postgres com RLS, Auth, Realtime e Edge Functions (captura de leads, WhatsApp, formulários da Meta).
- A chave em `config.js` é a chave **pública** do Supabase; a segurança fica nas regras (RLS) do banco.

## Arquivos

| Arquivo | O que tem |
|---|---|
| `index.html`, `styles.css` | Página e visual |
| `config.js` | Nome do produto e conexão com o Supabase |
| `lib.js` | Cliente do Supabase, estado, permissões e utilitários de tela |
| `app.js` | Login, criação da empresa, menu e rotas |
| `telas.js` | Painel, funil (kanban), leads, conversas, tarefas e relatórios |
| `lead.js` | Ficha do lead: dados, conversa no WhatsApp, histórico, tarefas e visitas |
| `equipe.js` | Times, pessoas, convites e link de captura por time |
| `ajustes.js` | Empresa, etapas do funil, mensagens prontas, WhatsApp, formulários da Meta e robô |
| `supabase/migrations` | SQL das mudanças no banco |

## Leads automáticos dos anúncios

- **Formulários da Meta (Facebook e Instagram):** em Configurações → Formulários da Meta o dono conecta uma ou várias páginas. Todo formulário de todo anúncio dessas páginas vira lead na hora (webhook `leadgen` na função `meta-leads`) e, a cada 15 minutos, o CRM confere na Meta se faltou algum (`pg_cron` → `meta-leads` com `acao: sincronizar`).
- **WhatsApp:** cada número novo que escreve vira lead (função `whatsapp-meta` para o WhatsApp oficial em coexistência, ou `whatsapp-receber` para a Z-API). Quem veio de anúncio Clique para WhatsApp fica com origem `meta ads` e os dados do anúncio.
- **Distribuição:** cada página, cada formulário e o número do WhatsApp podem mandar os leads para um time; sem time, entram no rodízio da empresa toda.

## Papéis

- **Dono:** vê e configura tudo.
- **Gerente sem time (gerente geral):** vê tudo, gerencia times e pessoas.
- **Gerente de time:** vê e distribui só os leads do time.
- **Corretor:** vê os leads atribuídos a ele.

## Rodar localmente

Qualquer servidor estático serve, por exemplo `python3 -m http.server 8080` na pasta e abrir `http://localhost:8080`.
