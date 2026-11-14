-- Ordem das condutas na lista do paciente.
-- O pull do app lê cada tabela em ordem de chave primária (uuid aleatório); sem esta
-- coluna, as condutas chegavam embaralhadas em todo aparelho que recebia o paciente.
-- NULA de propósito (sem default): linha antiga, ou criada sem informar a ordem, vai
-- para o FIM da lista no app — com "default 0" ela pularia para o topo. O app regrava
-- a posição (0, 1, 2...) de todas as condutas do paciente a cada sincronização.
-- Idempotente e não destrutivo.
alter table public.painel_condutas add column if not exists ordem int;
