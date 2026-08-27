-- Tipo do registro em painel_devices:
--   'device'       = dispositivo invasivo (conta dias de uso, alerta se prolongado)
--   'procedimento' = cirurgia/procedimento (conta pós-operatório "PO D<n>", nunca alerta)
alter table public.painel_devices add column if not exists kind text not null default 'device';
