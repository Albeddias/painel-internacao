-- Guardar só na nuvem: paciente sai do aparelho e fica apenas no banco.
-- O app nunca cria leito para status 'nuvem'; restaurar = voltar a 'arquivado'.
-- NOTA: Se o nome da constraint diferir do esperado (painel_patients_status_check),
-- descobrir com: select conname from pg_constraint where conrelid = 'public.painel_patients'::regclass and contype = 'c';
-- e ajustar o nome no drop constraint abaixo antes de aplicar.

alter table public.painel_patients
  drop constraint if exists painel_patients_status_check;
alter table public.painel_patients
  add constraint painel_patients_status_check
  check (status in ('internado','alta','arquivado','nuvem'));
