/* Estado fictício do Caderno de Visitas, usado nas capturas de tela e nos testes.
 * Script clássico: module.exports no Node, self.estadoFicticio no navegador.
 * Todas as datas saem de hojeISO ('AAAA-MM-DD'). A ORDEM DOS LEITOS É FIXA: os planos
 * das fases citam os índices (paciente:0 etc.). Nomes sempre "Paciente Exemplo ...". */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.estadoFicticio = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MODELO_NOTAS = "S: (Subjetivo)\n\nO: (Objetivo)\n- SSVV:\n- Exame:\n- Labs:\n- Imagem:\n\nA: (Avaliação)\n\nP: (Plano)\n";

  function estadoFicticio(hojeISO) {
    let seq = 0;
    const id = function () { seq++; return '00000000-0000-4000-8000-' + String(seq).padStart(12, '0'); };

    const p = String(hojeISO).split('-').map(Number);
    const dia = function (n) {
      const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
      return d.toISOString().slice(0, 10);
    };

    const checks = function (ev, pr, ex, tev) { return { ev: !!ev, p: !!pr, ex: !!ex, tev: !!tev }; };
    const problema = function (descricao, status, plano, ordem) {
      return { id: id(), descricao: descricao, status: status, plano: plano, ordem: ordem };
    };
    const coleta = function (date, pares) {
      return { id: id(), type: 'lab', date: date, results: pares.map(function (x) { return { name: x[0], value: x[1] }; }) };
    };
    const evolucao = function (data, atual) {
      return {
        id: id(), data: data,
        problemas: '1. Pneumonia comunitária grave\n2. Lesão renal aguda sobre DRC G3b\n3. HAS / DM2',
        historia_internacao: '[NOME], 78 anos, admitido(a) por febre, tosse produtiva e dispneia há 3 dias.',
        evolucao_atual: atual,
        exames_lab: 'Hb 10,1 | Cr 2,4 | K 5,8',
        culturas: 'Hemocultura ' + data.slice(8, 10) + '/' + data.slice(5, 7) + ': aguardando',
        exames_imagem: 'RX de tórax: consolidação em base direita.',
        atualizacao_problemas: 'LRA em melhora lenta.',
        metas: 'Euvolemia; K < 5,0.',
        acoes: 'Ajustar ATB pela função renal; repetir eletrólitos amanhã.',
      };
    };

    const leito0 = {
      patientId: id(), personId: 'pessoa-1',
      bedNumber: '1012-A', patientName: 'Paciente Exemplo Um', initialsPlaceholder: '',
      age: 78, admitDate: dia(-9),
      hpp: 'HAS, DM2, DRC G3b',
      anamneseInicial: 'Febre e tosse produtiva há 3 dias, com dispneia progressiva.\nNega dor torácica.\nChegou ao PS saturando 88% em ar ambiente.',
      alergias: 'Dipirona (edema de glote)',
      medicacoesPrevias: 'Losartana 50 mg 12/12h\nMetformina 850 mg 2x/dia\nAAS 100 mg 1x/dia',
      problems: [
        problema('Pneumonia comunitária grave com insuficiência respiratória hipoxêmica', 'ativo', 'Pip-tazo D8; desmame de O2', 0),
        problema('Lesão renal aguda sobre DRC', 'ativo', 'Hidratação; evitar nefrotóxicos', 1),
        problema('Diabetes mellitus tipo 2', 'cronico', 'Insulina basal + correção', 2),
      ],
      notes: MODELO_NOTAS + '\nFamília orientada sobre o quadro.\nAguardando vaga de fisioterapia.',
      condutas: [
        { id: id(), text: 'Solicitar Labs (Rotina)', done: true },
        { id: id(), text: 'Ajustar dose do ATB pela função renal', done: false },
        { id: id(), text: 'Repetir potássio às 18h', done: false },
      ],
      trackers: [
        { id: id(), type: 'atb', name: 'Piperacilina-tazobactam', startDate: dia(-7), duration: 7, endDate: '', indicacao: 'Pneumonia' },
        { id: id(), type: 'culture', name: 'Hemocultura', collectionDate: dia(-3), result: 'Aguardando' },
        { id: id(), type: 'device', kind: 'device', name: 'CVC Subclávia D', installDate: dia(-8), removalDate: '' },
        { id: id(), type: 'atb', name: 'Ceftriaxona', startDate: dia(-9), duration: 7, endDate: dia(-7), indicacao: 'Pneumonia' },
        { id: id(), type: 'device', kind: 'device', name: 'Sonda vesical de demora', installDate: dia(-9), removalDate: dia(-4) },
        { id: id(), type: 'device', kind: 'procedimento', name: 'Toracocentese diagnóstica', installDate: dia(-6), removalDate: '' },
      ],
      exams: [
        coleta(dia(-5), [['Hb', '9,1'], ['Cr', '2,9'], ['K', '5,9'], ['Leucócitos', '18.400'], ['PCR', '210']]),
        coleta(dia(-1), [['Hb', '9,5'], ['Cr', '2,6'], ['K', '6,1'], ['Leucócitos', '14.200'], ['PCR', '150']]),
        coleta(hojeISO, [
          ['Hb', '10,1'], ['Ht', '31'], ['Leucócitos', '11.800'], ['Plaquetas', '210.000'], ['Cr', '2,4'],
          ['Ur', '88'], ['Na', '137'], ['K', '5,8'], ['PCR', '96'], ['Glicemia', '182'],
          ['Mg', '1,9'], ['Ca', '8,6'], ['P', '4,1'], ['TGO', '32'], ['TGP', '28'],
          ['Bilirrubina total', '0,8'], ['Albumina', '2,9'], ['Lactato', '1,4'], ['pH', '7,36'], ['INR', '1,2'],
        ]),
        { id: id(), type: 'image', date: dia(-8), name: 'RX de tórax', summary: 'Consolidação em base direita, sem derrame.' },
      ],
      rawTexts: [
        { id: id(), tipo: 'admissao', data: dia(-9), texto: '[NOME], 78 anos. QP: febre e tosse. HDA: há 3 dias...' },
        { id: id(), tipo: 'evolucao', data: dia(-1), texto: 'Evolução: afebril há 24h, em O2 2 L/min.' },
      ],
      generatedDocs: [
        {
          id: id(), tipo: 'sumario_alta', createdAt: dia(-1) + 'T18:00:00.000Z',
          conteudo: '=== IDENTIFICAÇÃO ===\n[NOME], 78 anos, leito 1012-A.\n\n' +
            '=== DIAGNÓSTICOS ===\n1. Pneumonia comunitária grave\n2. Lesão renal aguda sobre DRC\n\n' +
            '=== EVOLUÇÃO ===\nBoa resposta ao antibiótico, desmame de O2 em curso.\n\n' +
            '=== PARA CONFERIR (NÃO COLAR NO PRONTUÁRIO) ===\nConferir dose de pip-tazo na alta.',
        },
      ],
      evolucoes: [
        evolucao(dia(-1), '[NOME] em O2 2 L/min, afebril há 24h, diurese preservada.'),
        evolucao(hojeISO, '[NOME] em ar ambiente, sem queixas, aceitando dieta.'),
      ],
      externalDoctor: { active: false, name: '' },
      checks: checks(true, false, false, false),
      quedaOrientada: false,
      isVisited: true, reminderDate: hojeISO,
      dischargeForecast: dia(-1),
      isArchived: false, archiveReason: null, dischargedAt: '',
    };

    const simples = function (extra) {
      return Object.assign({
        patientId: id(), personId: null, initialsPlaceholder: '',
        age: 60, admitDate: dia(-4), hpp: '', anamneseInicial: '', alergias: '', medicacoesPrevias: '',
        problems: [], notes: '', condutas: [], trackers: [], exams: [], rawTexts: [], generatedDocs: [], evolucoes: [],
        externalDoctor: { active: false, name: '' }, checks: checks(), quedaOrientada: false,
        isVisited: false, reminderDate: '', dischargeForecast: '',
        isArchived: false, archiveReason: null, dischargedAt: '',
      }, extra);
    };

    const beds = [
      leito0,
      simples({
        bedNumber: '1013-B', patientName: 'Paciente Exemplo Dois', age: 64,
        problems: [problema('Celulite de membro inferior esquerdo', 'ativo', 'Cefazolina D3', 0)],
        isVisited: true, checks: checks(true, true, true, true), quedaOrientada: true, dischargeForecast: dia(5),
      }),
      simples({
        bedNumber: '1014-B', patientName: 'Paciente Exemplo Três', age: 51,
        externalDoctor: { active: true, name: 'Dra. Exemplo Externa' },
      }),
      simples({
        bedNumber: 'UTI-12-B', patientName: 'Paciente Exemplo Quatro de Nome Bastante Comprido da Silva',
        age: 45, admitDate: dia(-2),
      }),
      simples({ patientId: null, bedNumber: '1021', patientName: '', age: '', admitDate: '' }),
      simples({ bedNumber: '1030-C', patientName: 'Paciente Exemplo Cinco', age: 70, dischargeForecast: hojeISO }),
      simples({
        bedNumber: '1031-A', patientName: 'PES', initialsPlaceholder: 'PES', age: 83,
        evolucoes: [evolucao(hojeISO, '[NOME] sonolento(a), porém despertável.')],
      }),
      simples({
        personId: 'pessoa-1', bedNumber: '1012-A', patientName: 'Paciente Exemplo Um', age: 78,
        admitDate: dia(-40), dischargedAt: dia(-30), isArchived: true, archiveReason: 'alta',
        problems: [problema('Infecção do trato urinário', 'ativo', 'Ciprofloxacino 7 dias', 0)],
        exams: [
          coleta(dia(-35), [['Hb', '11,2'], ['Cr', '1,6'], ['K', '4,4']]),
          coleta(dia(-32), [['Hb', '11,5'], ['Cr', '1,4'], ['K', '4,2']]),
        ],
      }),
      simples({
        bedNumber: '1040', patientName: 'Paciente Exemplo Seis', age: 58,
        admitDate: dia(-20), isArchived: true, archiveReason: 'arquivado',
      }),
    ];

    const cloudArchived = {};
    cloudArchived[id()] = { nome: 'Paciente Exemplo Sete', iniciais: 'PES', leito: '1050', personId: null };

    const sync = new Date(p[0], p[1] - 1, p[2], 9, 22, 0);
    const modif = new Date(sync.getTime() - 60000);

    return {
      beds: beds,
      lastReset: hojeISO,
      lastSyncAt: sync.toISOString(),
      lastModifiedAt: modif.toISOString(),
      deletedPatientIds: [], syncedPatientIds: [], syncBase: {},
      cloudArchived: cloudArchived,
      commonCondutas: ['Manter ATB', 'Solicitar Labs (Rotina)', 'Aguardar resultado de cultura', 'Monitorar SSVV', 'Dieta livre'],
      commonExtDocs: ['Dra. Exemplo Externa'],
      notesTemplate: MODELO_NOTAS,
      generalTasks: [
        { id: id(), text: 'Ligar para a família do 1012-A', done: false },
        { id: id(), text: 'Pedir parecer da nefrologia', done: false },
        { id: id(), text: 'Conferir prescrições da manhã', done: true },
      ],
      generalExams: [],
      pinnedExams: ['Hb', 'Ht', 'Leucócitos', 'Plaquetas', 'Cr', 'Ur', 'Na', 'K', 'PCR', 'Glicemia'],
    };
  }

  return estadoFicticio;
});
