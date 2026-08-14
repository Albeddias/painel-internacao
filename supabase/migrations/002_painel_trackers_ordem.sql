-- Ordem manual dos controles (drag-and-drop no app).
-- "ordem" é a posição do item na lista unificada de trackers do paciente
-- (antibióticos + culturas + dispositivos intercalados livremente).
alter table public.painel_antibiotics add column if not exists ordem int not null default 0;
alter table public.painel_cultures    add column if not exists ordem int not null default 0;
alter table public.painel_devices     add column if not exists ordem int not null default 0;
