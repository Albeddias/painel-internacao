/* PainelCore — lógica pura do Caderno de Visitas.
 * UMD: script clássico no navegador (window.PainelCore), CommonJS no Node (testes). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.PainelCore = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function uuid() {
    if (typeof globalThis.crypto === 'object' && globalThis.crypto.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
    // fallback para ambientes sem crypto.randomUUID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // a palavra isolada "e" é mais provavelmente uma inicial abreviada do que conectivo
  const IGNORED_WORDS = new Set(['de', 'da', 'do', 'das', 'dos']);

  function initialsFromName(name) {
    const words = String(name || '').trim().split(/\s+/)
      .filter(Boolean)
      .filter(function (w) { return !IGNORED_WORDS.has(w.toLowerCase()); });
    if (words.length === 0) return '';
    return words.map(function (w) { return w[0].toUpperCase(); }).join('.') + '.';
  }

  function fillPatientName(text, fullName) {
    const name = String(fullName || '').trim();
    if (!name) return text;
    if (text == null) return text; // preserva null/undefined (ex.: conteudo ainda não gerado)
    return String(text).split('[NOME]').join(name);
  }

  const GLOBAL_NOTES_TEMPLATE = "S: (Subjetivo)\n\nO: (Objetivo)\n- SSVV:\n- Exame:\n- Labs:\n- Imagem:\n\nA: (Avaliação)\n\nP: (Plano)\n";

  function defaultState(todayStr) {
    return {
      beds: [], lastReset: todayStr, lastSyncAt: null, deletedPatientIds: [], syncedPatientIds: [],
      commonCondutas: ['Manter ATB', 'Solicitar Labs (Rotina)', 'Aguardar resultado de cultura', 'Monitorar SSVV', 'Dieta livre'],
      commonExtDocs: [],
      notesTemplate: GLOBAL_NOTES_TEMPLATE,
      generalTasks: [],
      generalExams: [],
      pinnedExams: ['Hb', 'Ht', 'Leucócitos', 'Plaquetas', 'Cr', 'Ur', 'Na', 'K', 'PCR', 'Glicemia']
    };
  }

  function migrateBed(b) {
    b = b || {};
    const hasPatient = !!(b.patientName && String(b.patientName).trim());
    return {
      patientId: b.patientId || (hasPatient ? uuid() : null),
      bedNumber: b.bedNumber || '', patientName: b.patientName || '',
      age: b.age === 0 ? 0 : (b.age || ''), admitDate: b.admitDate || '',
      hpp: b.hpp || '', anamneseInicial: b.anamneseInicial || '',
      problems: (b.problems && b.problems.length > 0)
        ? b.problems
        : (b.diagnoses || []).map(function (d, i) {
            return { id: uuid(), descricao: d, status: 'ativo', plano: '', ordem: i };
          }),
      notes: b.notes || '',
      condutas: (b.condutas || []).map(function (c) {
        if (!c || typeof c !== 'object') return null;
        return { id: c.id || uuid(), text: c.text || '', done: !!c.done };
      }).filter(Boolean),
      trackers: (b.trackers || []).filter(Boolean).slice(),
      exams: (b.exams || []).filter(Boolean).slice(),
      rawTexts: (b.rawTexts || []).filter(Boolean).slice(),
      generatedDocs: (b.generatedDocs || []).filter(Boolean).slice(),
      externalDoctor: b.externalDoctor || { active: false, name: '' },
      checks: b.checks || { ev: false, p: false, ex: false, tev: false },
      isVisited: !!b.isVisited, reminderDate: b.reminderDate || '',
      dischargeForecast: b.dischargeForecast || '',
      isArchived: !!b.isArchived,
      archiveReason: b.archiveReason || (b.isArchived ? 'arquivado' : null),
      dischargedAt: b.dischargedAt || '',
      isProblemsMinimized: b.isProblemsMinimized !== undefined ? b.isProblemsMinimized : (b.isDxMinimized !== undefined ? b.isDxMinimized : false),
      isAnamneseMinimized: b.isAnamneseMinimized !== undefined ? b.isAnamneseMinimized : true,
      isTrackerMinimized: b.isTrackerMinimized !== undefined ? b.isTrackerMinimized : true,
      isExamsMinimized: b.isExamsMinimized !== undefined ? b.isExamsMinimized : true,
      isNotesMinimized: b.isNotesMinimized !== undefined ? b.isNotesMinimized : true,
      isCondutaMinimized: b.isCondutaMinimized !== undefined ? b.isCondutaMinimized : true,
      isRawTextsMinimized: b.isRawTextsMinimized !== undefined ? b.isRawTextsMinimized : true,
      isDocsMinimized: b.isDocsMinimized !== undefined ? b.isDocsMinimized : true,
    };
  }

  function migrateState(parsed, todayStr) {
    const def = defaultState(todayStr);
    const s = Object.assign({}, def, parsed || {});
    s.beds = (s.beds || []).map(migrateBed);
    s.lastSyncAt = s.lastSyncAt || null;
    s.deletedPatientIds = s.deletedPatientIds || [];
    s.syncedPatientIds = s.syncedPatientIds || [];
    s.generalTasks = s.generalTasks || [];
    s.generalExams = s.generalExams || [];
    s.pinnedExams = s.pinnedExams || def.pinnedExams;
    return s;
  }

  // Registra um "tombstone": paciente deletado localmente que o próximo push deve
  // apagar do banco (e que o pull não deve ressuscitar enquanto a deleção estiver pendente).
  function markPatientDeleted(state, patientId) {
    if (!patientId) return state;
    state.deletedPatientIds = state.deletedPatientIds || [];
    if (state.deletedPatientIds.indexOf(patientId) === -1) {
      state.deletedPatientIds.push(patientId);
    }
    return state;
  }

  function buildPushPayload(state) {
    const out = { patients: [], problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [], deletePatientIds: (state.deletedPatientIds || []).slice() };
    (state.beds || []).forEach(function (b) {
      if (!b.patientId) return;
      const pid = b.patientId;
      out.patients.push({
        id: pid,
        bed_number: b.bedNumber || '',
        initials: initialsFromName(b.patientName),
        age: (b.age === '' || b.age == null) ? null : Number(b.age),
        admit_date: b.admitDate || null,
        hpp: b.hpp || '',
        anamnese_inicial: b.anamneseInicial || '',
        discharge_forecast: b.dischargeForecast || null,
        status: b.isArchived ? (b.archiveReason === 'alta' ? 'alta' : 'arquivado') : 'internado',
      });
      (b.problems || []).forEach(function (p, i) {
        out.problems.push({ id: p.id, patient_id: pid, descricao: p.descricao || '', status: p.status || 'ativo', plano: p.plano || '', ordem: i });
      });
      (b.trackers || []).forEach(function (t) {
        if (t.type === 'atb') {
          out.antibiotics.push({ id: t.id, patient_id: pid, nome: t.name || '', start_date: t.startDate || null, duration_days: t.duration || null, end_date: t.endDate || null, indicacao: t.indicacao || '' });
        } else if (t.type === 'culture') {
          out.cultures.push({ id: t.id, patient_id: pid, tipo: t.name || '', collection_date: t.collectionDate || null, resultado: t.result || '' });
        } else {
          out.devices.push({ id: t.id, patient_id: pid, nome: t.name || '', install_date: t.installDate || null, removal_date: t.removalDate || null });
        }
      });
      (b.exams || []).forEach(function (e) {
        if (e.type === 'lab') {
          (e.results || []).forEach(function (r) {
            out.exams.push({ id: uuid(), patient_id: pid, tipo: 'lab', nome: r.name || '', data: e.date || null, resultado: String(r.value == null ? '' : r.value) });
          });
        } else {
          out.exams.push({ id: e.id || uuid(), patient_id: pid, tipo: 'imagem', nome: e.name || '', data: e.date || null, resultado: e.summary || '' });
        }
      });
      (b.condutas || []).forEach(function (c) {
        out.condutas.push({ id: c.id || uuid(), patient_id: pid, texto: c.text || '', done: !!c.done, data: null });
      });
      out.notes.push({ patient_id: pid, texto: b.notes || '' });
      (b.rawTexts || []).forEach(function (r) {
        out.raw_texts.push({ id: r.id || uuid(), patient_id: pid, tipo: r.tipo || 'evolucao', data: r.data || null, texto: r.texto || '' });
      });
    });
    return out;
  }

  function applyPull(state, pulled) {
    function byPatient(rows) {
      const m = {};
      (rows || []).forEach(function (r) { (m[r.patient_id] = m[r.patient_id] || []).push(r); });
      return m;
    }
    const problems = byPatient(pulled.problems), atbs = byPatient(pulled.antibiotics),
      cultures = byPatient(pulled.cultures), devices = byPatient(pulled.devices),
      exams = byPatient(pulled.exams), condutas = byPatient(pulled.condutas),
      notes = byPatient(pulled.notes), rawTexts = byPatient(pulled.raw_texts),
      docs = byPatient(pulled.generated_docs);

    const deletedPending = {};
    (state.deletedPatientIds || []).forEach(function (id) { deletedPending[id] = true; });

    // Conjunto de pacientes presentes neste pull (verdade atual do banco, com escopo RLS do dono).
    const pulledIds = {};
    (pulled.patients || []).forEach(function (p) { pulledIds[p.id] = true; });

    // Remove leitos que JÁ foram sincronizados antes mas sumiram do banco (deletados em outro
    // aparelho). Leitos nunca sincronizados (criados offline, ainda não enviados) são preservados.
    const previouslySynced = {};
    (state.syncedPatientIds || []).forEach(function (id) { previouslySynced[id] = true; });
    state.beds = (state.beds || []).filter(function (b) {
      if (!b.patientId) return true;                 // leito vazio: mantém
      if (!previouslySynced[b.patientId]) return true; // novo local: mantém
      if (deletedPending[b.patientId]) return true;  // deleção local pendente: o push é quem resolve
      return !!pulledIds[b.patientId];               // sincronizado: só mantém se ainda existe no banco
    });

    (pulled.patients || []).forEach(function (p) {
      // não ressuscita paciente deletado localmente cujo tombstone ainda não foi sincronizado
      if (deletedPending[p.id]) return;
      let bed = (state.beds || []).find(function (b) { return b.patientId === p.id; });
      if (!bed) {
        // paciente criado direto no banco (raro): cria leito com iniciais como nome provisório
        bed = migrateBed({ patientName: p.initials || '?', bedNumber: p.bed_number || '' });
        bed.patientId = p.id;
        state.beds.push(bed);
      }
      bed.bedNumber = p.bed_number || bed.bedNumber;
      bed.age = p.age == null ? '' : p.age;
      bed.admitDate = p.admit_date || '';
      bed.hpp = p.hpp || '';
      bed.anamneseInicial = p.anamnese_inicial || '';
      bed.dischargeForecast = p.discharge_forecast || '';
      bed.isArchived = p.status !== 'internado';
      bed.archiveReason = p.status === 'internado' ? null : p.status;

      bed.problems = (problems[p.id] || []).slice()
        .sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); })
        .map(function (r) { return { id: r.id, descricao: r.descricao || '', status: r.status || 'ativo', plano: r.plano || '', ordem: r.ordem || 0 }; });

      bed.trackers = []
        .concat((atbs[p.id] || []).map(function (r) {
          return { id: r.id, type: 'atb', name: r.nome || '', startDate: r.start_date || '', duration: r.duration_days || null, endDate: r.end_date || '', indicacao: r.indicacao || '' };
        }))
        .concat((cultures[p.id] || []).map(function (r) {
          return { id: r.id, type: 'culture', name: r.tipo || '', collectionDate: r.collection_date || '', result: r.resultado || '' };
        }))
        .concat((devices[p.id] || []).map(function (r) {
          return { id: r.id, type: 'device', name: r.nome || '', installDate: r.install_date || '', removalDate: r.removal_date || '' };
        }));

      const labRows = (exams[p.id] || []).filter(function (r) { return r.tipo === 'lab'; });
      const labByDate = {};
      labRows.forEach(function (r) {
        const d = r.data || '';
        (labByDate[d] = labByDate[d] || []).push({ name: r.nome, value: r.resultado });
      });
      bed.exams = Object.keys(labByDate).sort().map(function (date) {
        return { id: uuid(), type: 'lab', date: date, results: labByDate[date] };
      }).concat((exams[p.id] || []).filter(function (r) { return r.tipo === 'imagem'; }).map(function (r) {
        return { id: r.id, type: 'image', date: r.data || '', name: r.nome || '', summary: r.resultado || '' };
      }));

      bed.condutas = (condutas[p.id] || []).map(function (r) { return { id: r.id, text: r.texto || '', done: !!r.done }; });
      bed.notes = (notes[p.id] && notes[p.id][0] && notes[p.id][0].texto) || '';
      bed.rawTexts = (rawTexts[p.id] || []).map(function (r) { return { id: r.id, tipo: r.tipo, data: r.data || '', texto: r.texto || '' }; });
      bed.generatedDocs = (docs[p.id] || []).slice()
        .sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); })
        .map(function (r) { return { id: r.id, tipo: r.tipo, conteudo: r.conteudo, createdAt: r.created_at }; });
    });

    // Verdade do banco após este pull: usado no próximo pull para detectar deleções remotas.
    state.syncedPatientIds = Object.keys(pulledIds);
    return state;
  }

  return {
    uuid: uuid,
    initialsFromName: initialsFromName,
    fillPatientName: fillPatientName,
    defaultState: defaultState,
    migrateBed: migrateBed,
    migrateState: migrateState,
    buildPushPayload: buildPushPayload,
    applyPull: applyPull,
    markPatientDeleted: markPatientDeleted,
  };
});
