-- Templates de documentos para a IA (tabela painel_doc_templates).
-- Padrões funcionais — devem ser refinados com os modelos reais do usuário via:
--   update painel_doc_templates set template = ... where nome = '...';
-- Regra: a IA SEMPRE usa [NOME] no lugar do nome do paciente (o app preenche localmente).

insert into painel_doc_templates (nome, descricao, template) values
('sumario_alta', 'Sumário de alta hospitalar — texto para colar no prontuário', $tpl$
INSTRUÇÕES PARA A IA: Preencha com os dados do paciente (tabelas painel_patients, painel_problems, painel_antibiotics, painel_cultures, painel_devices, painel_exams, painel_condutas, painel_notes, painel_raw_texts). Use [NOME] no lugar do nome do paciente — NUNCA escreva nome real. Liste cada problema com a evolução e o que foi feito. Datas em DD/MM/AAAA. Linguagem técnica, objetiva, em português.

SUMÁRIO DE ALTA HOSPITALAR

Paciente: [NOME]
Idade: {idade} anos
Data de internação: {data_admissao}
Data de alta: {data_alta}

ANTECEDENTES PESSOAIS:
{hpp}

HISTÓRIA DA INTERNAÇÃO:
{anamnese_inicial_resumida}

DIAGNÓSTICOS E EVOLUÇÃO:
{para cada problema: - DESCRIÇÃO (status): evolução e tratamento realizado, incluindo antibióticos com datas e duração}

EXAMES RELEVANTES:
{exames laboratoriais e de imagem mais relevantes, com datas}

CONDIÇÕES DE ALTA:
{estado clínico na alta}

PLANO PÓS-ALTA:
{orientações, medicações de uso contínuo, retornos e encaminhamentos}
$tpl$),

('receituario', 'Receituário de alta — gerado a partir do texto cru da prescrição', $tpl$
INSTRUÇÕES PARA A IA: Gere a partir do painel_raw_text mais recente do tipo "prescricao" do paciente. Inclua APENAS medicações de uso domiciliar (exclua medicações EV hospitalares, dieta e cuidados de enfermagem). Use [NOME] no lugar do nome. Formato: um item por medicação, numerado, com nome, concentração, posologia e duração quando aplicável.

RECEITUÁRIO

Paciente: [NOME]

Uso oral/domiciliar:
{1. MEDICAÇÃO concentração — posologia — duração}

Orientações:
{orientações relevantes de uso}

Data: {data_de_hoje}
$tpl$),

('laudo', 'Laudo/relatório médico genérico', $tpl$
INSTRUÇÕES PARA A IA: Relatório médico para fins administrativos ou de encaminhamento. Use [NOME] no lugar do nome. Baseie-se nos problemas, evolução e exames do paciente. Pergunte ao usuário a finalidade do laudo se não estiver clara.

RELATÓRIO MÉDICO

Declaro, para os devidos fins, que o paciente [NOME], {idade} anos, esteve internado nesta instituição no período de {data_admissao} a {data_alta_ou_atual}, sob meus cuidados, em razão de:

{diagnósticos principais com CID-10 quando aplicável}

{resumo objetivo da evolução e do estado atual}

{finalidade/observações}

Data: {data_de_hoje}
$tpl$)
on conflict (nome) do update set descricao = excluded.descricao, template = excluded.template;
