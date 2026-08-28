-- Preferências globais do app sincronizadas entre aparelhos (uma linha por chave).
-- Hoje só 'lab_ranges' (faixas de referência dos labs); novas chaves entram sem migration.
-- Como nas demais tabelas, __OWNER_EMAIL__ é trocado pelo e-mail real ao aplicar.

create table public.painel_prefs (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.painel_prefs for each row execute procedure extensions.moddatetime(updated_at);

alter table public.painel_prefs enable row level security;
create policy "painel owner only" on public.painel_prefs for all to authenticated using ((auth.jwt()->>'email') = '__OWNER_EMAIL__') with check ((auth.jwt()->>'email') = '__OWNER_EMAIL__');
