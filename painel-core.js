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
      beds: [], lastReset: todayStr, lastSyncAt: null,
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
      problems: b.problems || (b.diagnoses || []).map(function (d, i) {
        return { id: uuid(), descricao: d, status: 'ativo', plano: '', ordem: i };
      }),
      notes: b.notes || '',
      condutas: (b.condutas || []).map(function (c) {
        return { id: c.id || uuid(), text: c.text || '', done: !!c.done };
      }),
      trackers: b.trackers || [],
      exams: b.exams || [],
      rawTexts: b.rawTexts || [],
      generatedDocs: b.generatedDocs || [],
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
    s.generalTasks = s.generalTasks || [];
    s.generalExams = s.generalExams || [];
    s.pinnedExams = s.pinnedExams || def.pinnedExams;
    return s;
  }

  return {
    uuid: uuid,
    initialsFromName: initialsFromName,
    fillPatientName: fillPatientName,
    defaultState: defaultState,
    migrateBed: migrateBed,
    migrateState: migrateState,
  };
});
