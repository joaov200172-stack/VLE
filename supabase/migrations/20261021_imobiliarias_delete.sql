-- O dono pode excluir a empresa (todas as tabelas filhas têm on delete cascade)
create policy imobiliarias_delete on public.imobiliarias for delete to authenticated
using (id in (select private.imobiliarias_que_sou_dono()));
grant delete on public.imobiliarias to authenticated;
