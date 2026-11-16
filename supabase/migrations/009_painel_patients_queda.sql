-- Check "Queda" (termo de ciência do risco de queda, aplicado uma vez por internação).
-- Vivia só no aparelho onde foi marcado; com esta coluna passa a sincronizar entre aparelhos
-- (três-vias por campo, como os demais campos do paciente).
-- "default false": paciente já existente, ou criado sem informar, nasce com o termo pendente.
-- Aparelho ainda na versão anterior do app não envia a coluna, e o upsert dele não a altera.
-- Idempotente e não destrutivo.
alter table public.painel_patients add column if not exists queda_orientada boolean not null default false;
