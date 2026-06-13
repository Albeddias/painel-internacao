-- Schema do Caderno de Visitas (Painel de Internação)
-- Aplicado em 2026-06-12 no projeto Supabase "Gestão Médica" (kuhymtikommkoupynhkj).
-- Tabelas com prefixo painel_ (convivem com o app Gestão Médica neste projeto).
-- Privacidade: painel_patients.initials guarda APENAS iniciais; o nome completo nunca chega aqui.
-- RLS: acesso restrito EXCLUSIVAMENTE ao usuário dono (projeto compartilhado com outros usuários).
-- O e-mail do dono é substituído por __OWNER_EMAIL__ neste arquivo versionado; as policies
-- aplicadas no banco usam o e-mail real. Ao re-aplicar, troque __OWNER_EMAIL__ pelo e-mail desejado.

create extension if not exists moddatetime schema extensions;

create table public.painel_patients (
  id uuid primary key,
  bed_number text not null default '',
  initials text not null default '',
  age int,
  admit_date date,
  hpp text not null default '',
  anamnese_inicial text not null default '',
  discharge_forecast date,
  status text not null default 'internado' check (status in ('internado','alta','arquivado')),
  updated_at timestamptz not null default now()
);

create table public.painel_problems (
  id uuid primary key,
  patient_id uuid not null references public.painel_patients(id) on delete cascade,
  descricao text not null,
  status text not null default 'ativo' check (status in ('ativo','resolvido','cronico')),
  plano text not null default '',
  ordem int not null default 0,
  updated_at timestamptz not null default now()
);

create table public.painel_antibiotics (
  id uuid primary key,
  patient_id uuid not null references public.painel_patients(id) on delete cascade,
  nome text not null,
  start_date date,
  duration_days int,
  end_date date,
  indicacao text not null default '',
  updated_at timestamptz not null default now()
);

create table public.painel_cultures (
  id uuid primary key,
  patient_id uuid not null references public.painel_patients(id) on delete cascade,
  tipo text not null,
  collection_date date,
  resultado text not null default '',
  updated_at timestamptz not null default now()
);

create table public.painel_devices (
  id uuid primary key,
  patient_id uuid not null references public.painel_patients(id) on delete cascade,
  nome text not null,
  install_date date,
  removal_date date,
  updated_at timestamptz not null default now()
);

create table public.painel_exams (
  id uuid primary key,
  patient_id uuid not null references public.painel_patients(id) on delete cascade,
  tipo text not null check (tipo in ('lab','imagem')),
  nome text not null,
  data date,
  resultado text not null default '',
  updated_at timestamptz not null default now()
);

create table public.painel_condutas (
  id uuid primary key,
  patient_id uuid not null references public.painel_patients(id) on delete cascade,
  texto text not null default '',
  done boolean not null default false,
  data date,
  updated_at timestamptz not null default now()
);

create table public.painel_notes (
  patient_id uuid primary key references public.painel_patients(id) on delete cascade,
  texto text not null default '',
  updated_at timestamptz not null default now()
);

create table public.painel_raw_texts (
  id uuid primary key,
  patient_id uuid not null references public.painel_patients(id) on delete cascade,
  tipo text not null check (tipo in ('evolucao','prescricao','admissao')),
  data date,
  texto text not null,
  updated_at timestamptz not null default now()
);

create table public.painel_doc_templates (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  descricao text not null default '',
  template text not null,
  updated_at timestamptz not null default now()
);

create table public.painel_generated_docs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.painel_patients(id) on delete cascade,
  tipo text not null,
  conteudo text not null,
  created_at timestamptz not null default now()
);

-- updated_at automático
create trigger set_updated_at before update on public.painel_patients for each row execute procedure extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.painel_problems for each row execute procedure extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.painel_antibiotics for each row execute procedure extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.painel_cultures for each row execute procedure extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.painel_devices for each row execute procedure extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.painel_exams for each row execute procedure extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.painel_condutas for each row execute procedure extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.painel_notes for each row execute procedure extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.painel_raw_texts for each row execute procedure extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.painel_doc_templates for each row execute procedure extensions.moddatetime(updated_at);

-- RLS: somente o dono (__OWNER_EMAIL__)
alter table public.painel_patients enable row level security;
alter table public.painel_problems enable row level security;
alter table public.painel_antibiotics enable row level security;
alter table public.painel_cultures enable row level security;
alter table public.painel_devices enable row level security;
alter table public.painel_exams enable row level security;
alter table public.painel_condutas enable row level security;
alter table public.painel_notes enable row level security;
alter table public.painel_raw_texts enable row level security;
alter table public.painel_doc_templates enable row level security;
alter table public.painel_generated_docs enable row level security;

create policy "painel owner only" on public.painel_patients for all to authenticated using ((auth.jwt()->>'email') = '__OWNER_EMAIL__') with check ((auth.jwt()->>'email') = '__OWNER_EMAIL__');
create policy "painel owner only" on public.painel_problems for all to authenticated using ((auth.jwt()->>'email') = '__OWNER_EMAIL__') with check ((auth.jwt()->>'email') = '__OWNER_EMAIL__');
create policy "painel owner only" on public.painel_antibiotics for all to authenticated using ((auth.jwt()->>'email') = '__OWNER_EMAIL__') with check ((auth.jwt()->>'email') = '__OWNER_EMAIL__');
create policy "painel owner only" on public.painel_cultures for all to authenticated using ((auth.jwt()->>'email') = '__OWNER_EMAIL__') with check ((auth.jwt()->>'email') = '__OWNER_EMAIL__');
create policy "painel owner only" on public.painel_devices for all to authenticated using ((auth.jwt()->>'email') = '__OWNER_EMAIL__') with check ((auth.jwt()->>'email') = '__OWNER_EMAIL__');
create policy "painel owner only" on public.painel_exams for all to authenticated using ((auth.jwt()->>'email') = '__OWNER_EMAIL__') with check ((auth.jwt()->>'email') = '__OWNER_EMAIL__');
create policy "painel owner only" on public.painel_condutas for all to authenticated using ((auth.jwt()->>'email') = '__OWNER_EMAIL__') with check ((auth.jwt()->>'email') = '__OWNER_EMAIL__');
create policy "painel owner only" on public.painel_notes for all to authenticated using ((auth.jwt()->>'email') = '__OWNER_EMAIL__') with check ((auth.jwt()->>'email') = '__OWNER_EMAIL__');
create policy "painel owner only" on public.painel_raw_texts for all to authenticated using ((auth.jwt()->>'email') = '__OWNER_EMAIL__') with check ((auth.jwt()->>'email') = '__OWNER_EMAIL__');
create policy "painel owner only" on public.painel_doc_templates for all to authenticated using ((auth.jwt()->>'email') = '__OWNER_EMAIL__') with check ((auth.jwt()->>'email') = '__OWNER_EMAIL__');
create policy "painel owner only" on public.painel_generated_docs for all to authenticated using ((auth.jwt()->>'email') = '__OWNER_EMAIL__') with check ((auth.jwt()->>'email') = '__OWNER_EMAIL__');
