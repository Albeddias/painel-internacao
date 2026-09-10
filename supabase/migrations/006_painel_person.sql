-- Múltiplas internações por pessoa (spec 2026-09-08-reinternacao-design.md).
-- person_id agrupa as internações da mesma pessoa (uuid opaco; NUNCA derivado do nome).
-- Registros antigos ficam com person_id nulo = pessoa com internação única. Sem backfill.
-- discharge_date: data da alta (antes só existia no aparelho, como dischargedAt).

alter table public.painel_patients
  add column person_id uuid,
  add column discharge_date date;

create index painel_patients_person_id_idx on public.painel_patients (person_id);
