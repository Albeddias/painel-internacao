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
    return words.map(function (w) { return w[0].toUpperCase(); }).join('');
  }

  // ---- Sync com mescla: hashing e serialização de linhas -----------------

  // Hash curto e determinístico (djb2-xor). Não-criptográfico: serve só para
  // detectar "mudou desde a última foto sincronizada".
  // 32 bits: risco de colisão de conteúdo é desprezível para uso pessoal e aceito.
  function hash8(s) {
    s = String(s == null ? '' : s);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return ('0000000' + h.toString(16)).slice(-8);
  }

  const SEP = '\u0001';
  // Junta campos normalizando null/undefined para '' — local e banco hasheiam igual.
  function j() {
    return Array.prototype.slice.call(arguments)
      .map(function (x) { return String(x == null ? '' : x); }).join(SEP);
  }

  // Linhas do leito no formato do banco (sem patient_id), com hash de conteúdo e
  // posição original (ord). A identidade dos labs é a própria chave de conteúdo
  // data|nome|valor: editar um valor = deletar a linha antiga + criar uma nova.
  function localRowSets(bed) {
    const out = { problems: [], antibiotics: [], cultures: [], devices: [], condutas: [], raw_texts: [], examsImage: [], examsLab: [] };
    (bed.problems || []).forEach(function (p, i) {
      const row = { id: p.id, descricao: p.descricao || '', status: p.status || 'ativo', plano: p.plano || '' };
      out.problems.push({ key: row.id, hash: hash8(j(row.descricao, row.status, row.plano)), ord: i, row: row });
    });
    (bed.trackers || []).forEach(function (t, i) {
      if (t.type === 'atb') {
        const row = { id: t.id, nome: t.name || '', start_date: t.startDate || null, duration_days: t.duration || null, end_date: t.endDate || null, indicacao: t.indicacao || '' };
        out.antibiotics.push({ key: row.id, hash: hash8(j(row.nome, row.start_date, row.duration_days, row.end_date, row.indicacao)), ord: i, row: row });
      } else if (t.type === 'culture') {
        const row = { id: t.id, tipo: t.name || '', collection_date: t.collectionDate || null, resultado: t.result || '' };
        out.cultures.push({ key: row.id, hash: hash8(j(row.tipo, row.collection_date, row.resultado)), ord: i, row: row });
      } else {
        const row = { id: t.id, nome: t.name || '', install_date: t.installDate || null, removal_date: t.removalDate || null };
        out.devices.push({ key: row.id, hash: hash8(j(row.nome, row.install_date, row.removal_date)), ord: i, row: row });
      }
    });
    (bed.exams || []).forEach(function (e, i) {
      if (e.type === 'lab') {
        (e.results || []).forEach(function (r) {
          const row = { tipo: 'lab', nome: r.name || '', data: e.date || null, resultado: String(r.value == null ? '' : r.value) };
          out.examsLab.push({ key: j(row.data, row.nome, row.resultado), hash: '', ord: i, row: row });
        });
      } else {
        const row = { id: e.id, tipo: 'imagem', nome: e.name || '', data: e.date || null, resultado: e.summary || '' };
        out.examsImage.push({ key: row.id, hash: hash8(j(row.nome, row.data, row.resultado)), ord: i, row: row });
      }
    });
    (bed.condutas || []).forEach(function (c, i) {
      const row = { id: c.id, texto: c.text || '', done: !!c.done, data: null };
      out.condutas.push({ key: row.id, hash: hash8(j(row.texto, row.done)), ord: i, row: row });
    });
    (bed.rawTexts || []).forEach(function (r, i) {
      const row = { id: r.id, tipo: r.tipo || 'evolucao', data: r.data || null, texto: r.texto || '' };
      out.raw_texts.push({ key: row.id, hash: hash8(j(row.tipo, row.data, row.texto)), ord: i, row: row });
    });
    return out;
  }

  // Mesmos conjuntos, a partir das linhas baixadas do banco de UM paciente.
  // rows = { problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], raw_texts: [] }
  function pulledRowSets(rows) {
    const out = { problems: [], antibiotics: [], cultures: [], devices: [], condutas: [], raw_texts: [], examsImage: [], examsLab: [] };
    (rows.problems || []).forEach(function (r) {
      out.problems.push({ key: r.id, hash: hash8(j(r.descricao, r.status, r.plano)), ord: r.ordem, row: r });
    });
    (rows.antibiotics || []).forEach(function (r) {
      out.antibiotics.push({ key: r.id, hash: hash8(j(r.nome, r.start_date, r.duration_days, r.end_date, r.indicacao)), ord: r.ordem, row: r });
    });
    (rows.cultures || []).forEach(function (r) {
      out.cultures.push({ key: r.id, hash: hash8(j(r.tipo, r.collection_date, r.resultado)), ord: r.ordem, row: r });
    });
    (rows.devices || []).forEach(function (r) {
      out.devices.push({ key: r.id, hash: hash8(j(r.nome, r.install_date, r.removal_date)), ord: r.ordem, row: r });
    });
    (rows.exams || []).forEach(function (r, i) {
      if (r.tipo === 'lab') out.examsLab.push({ key: j(r.data, r.nome, r.resultado), hash: '', ord: i, row: r });
      else out.examsImage.push({ key: r.id, hash: hash8(j(r.nome, r.data, r.resultado)), ord: i, row: r });
    });
    (rows.condutas || []).forEach(function (r, i) {
      out.condutas.push({ key: r.id, hash: hash8(j(r.texto, r.done)), ord: i, row: r });
    });
    (rows.raw_texts || []).forEach(function (r, i) {
      out.raw_texts.push({ key: r.id, hash: hash8(j(r.tipo, r.data, r.texto)), ord: i, row: r });
    });
    return out;
  }

  // Hash dos campos "corridos" do paciente, na mesma normalização do push —
  // assim o hash local bate com o que uma versão intocada teria após o pull.
  function localScalarsHash(bed) {
    const status = bed.isArchived ? (bed.archiveReason === 'alta' ? 'alta' : 'arquivado') : 'internado';
    const age = (bed.age === '' || bed.age == null) ? '' : String(Number(bed.age));
    return hash8(j(bed.bedNumber, age, bed.admitDate, bed.hpp, bed.anamneseInicial, bed.dischargeForecast, status, bed.notes));
  }

  const ROW_TABLES = ['problems', 'antibiotics', 'cultures', 'devices', 'condutas', 'raw_texts', 'examsImage', 'examsLab'];

  // A "foto" da última sincronização: chaves + hashes de tudo que foi gravado.
  function buildSyncBase(state) {
    const base = {};
    (state.beds || []).forEach(function (bed) {
      if (!bed.patientId) return;
      const sets = localRowSets(bed);
      const rows = {};
      ROW_TABLES.forEach(function (t) {
        rows[t] = {};
        sets[t].forEach(function (e) { rows[t][e.key] = e.hash; });
      });
      base[bed.patientId] = { rows: rows, scalars: localScalarsHash(bed) };
    });
    return base;
  }

  // Mescla uma tabela de UM paciente. local/remote: [{key, hash, ord, row}];
  // base: {key: hash} da última foto, ou null (sem foto → união, nada deleta).
  // Regras: linha só de um lado e fora da foto = criada → fica; na foto e
  // intocada = deletada no outro lado → some; editada (hash ≠ foto) vence
  // deleção. Linha nos dois lados: local intocado → banco vence; senão local.
  function mergeRowSets(local, remote, base, keepOrd) {
    function inBase(key) { return !!base && Object.prototype.hasOwnProperty.call(base, key); }
    function untouched(entry) { return inBase(entry.key) && entry.hash === base[entry.key]; }
    const remoteByKey = {};
    remote.forEach(function (r) { remoteByKey[r.key] = r; });
    const localKeys = {};
    local.forEach(function (l) { localKeys[l.key] = true; });

    const result = [];
    local.forEach(function (l) {
      const r = remoteByKey[l.key];
      if (r) result.push(untouched(l) ? r : l);
      else if (!untouched(l)) result.push(l);
    });
    remote.forEach(function (r) {
      if (localKeys[r.key] || untouched(r)) return;
      const pos = (r.ord == null) ? result.length : Math.min(r.ord, result.length);
      result.splice(pos, 0, r);
    });
    // keepOrd: preserva o ord original do vencedor (ordem unificada dos trackers,
    // que atravessa três tabelas); sem keepOrd: renumera pela posição final.
    return result.map(function (e, i) {
      return Object.assign({}, e.row, { ordem: keepOrd ? (e.ord == null ? i : e.ord) : i });
    });
  }

  // Mescla three-way do estado inteiro com o que veio do banco.
  // Muta e retorna state, pronto para buildPushPayload. Ver spec 2026-08-25.
  function mergeStates(state, pulled) {
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

    state.syncBase = state.syncBase || {};
    state.cloudArchived = state.cloudArchived || {};

    const deletedPending = {};
    (state.deletedPatientIds || []).forEach(function (id) { deletedPending[id] = true; });
    const pulledIds = {};
    (pulled.patients || []).forEach(function (p) { pulledIds[p.id] = true; });

    // Pull vazio é anômalo (sessão errada, RLS): nunca interpretar como "banco esvaziado".
    const emptyPull = (pulled.patients || []).length === 0;

    // Deleção remota de paciente: mesma regra do applyPull.
    const previouslySynced = {};
    (state.syncedPatientIds || []).forEach(function (id) { previouslySynced[id] = true; });
    if (!emptyPull) {
      state.beds = (state.beds || []).filter(function (b) {
        if (!b.patientId) return true;
        if (!previouslySynced[b.patientId]) return true;
        if (deletedPending[b.patientId]) return true;
        return !!pulledIds[b.patientId];
      });
    }

    (pulled.patients || []).forEach(function (p) {
      if (deletedPending[p.id]) return;
      let bed = (state.beds || []).find(function (b) { return b.patientId === p.id; });

      // Paciente guardado só na nuvem: nunca vira leito; se este aparelho ainda
      // tinha o leito, move-o para o registro local preservando o nome completo.
      if (p.status === 'nuvem') {
        if (bed) {
          state.cloudArchived[p.id] = { nome: bed.patientName || '', iniciais: p.initials || '', leito: p.bed_number || bed.bedNumber || '' };
          state.beds = state.beds.filter(function (b) { return b.patientId !== p.id; });
        } else if (!state.cloudArchived[p.id]) {
          state.cloudArchived[p.id] = { nome: '', iniciais: p.initials || '', leito: p.bed_number || '' };
        }
        return;
      }

      const remoteRows = {
        problems: problems[p.id] || [], antibiotics: atbs[p.id] || [], cultures: cultures[p.id] || [],
        devices: devices[p.id] || [], exams: exams[p.id] || [], condutas: condutas[p.id] || [],
        raw_texts: rawTexts[p.id] || [], generated_docs: docs[p.id] || [],
      };
      const remoteNote = (notes[p.id] && notes[p.id][0] && notes[p.id][0].texto) || '';

      if (!bed) {
        // Novo aqui (criado no banco, ou restaurado da nuvem): adoção integral.
        const reg = state.cloudArchived[p.id];
        bed = migrateBed({ patientName: (reg && reg.nome) || p.initials || '?', bedNumber: p.bed_number || '' });
        bed.patientId = p.id;
        state.beds.push(bed);
        delete state.cloudArchived[p.id];
        applyPatientScalars(bed, p, remoteNote);
        applyRowsToBed(bed, remoteRows);
        return;
      }

      const base = state.syncBase[p.id] || null;
      const local = localRowSets(bed);
      const remote = pulledRowSets(remoteRows);
      function baseRows(t) { return base ? (base.rows[t] || {}) : null; }

      // Scalars antes das linhas: usa o leito ainda intocado para o hash local.
      if (base && base.scalars === localScalarsHash(bed)) {
        applyPatientScalars(bed, p, remoteNote);
      }

      applyRowsToBed(bed, {
        problems: mergeRowSets(local.problems, remote.problems, baseRows('problems')),
        antibiotics: mergeRowSets(local.antibiotics, remote.antibiotics, baseRows('antibiotics'), true),
        cultures: mergeRowSets(local.cultures, remote.cultures, baseRows('cultures'), true),
        devices: mergeRowSets(local.devices, remote.devices, baseRows('devices'), true),
        condutas: mergeRowSets(local.condutas, remote.condutas, baseRows('condutas')),
        raw_texts: mergeRowSets(local.raw_texts, remote.raw_texts, baseRows('raw_texts')),
        exams: mergeRowSets(local.examsLab, remote.examsLab, baseRows('examsLab'))
          .concat(mergeRowSets(local.examsImage, remote.examsImage, baseRows('examsImage'))),
        generated_docs: remoteRows.generated_docs,
      });
    });

    // Poda só com pull não-vazio: um pull vazio anômalo não pode apagar os nomes,
    // que não existem em nenhum outro lugar.
    if (!emptyPull) {
      Object.keys(state.cloudArchived).forEach(function (id) {
        if (!pulledIds[id]) delete state.cloudArchived[id];
      });
    }

    if (!emptyPull) state.syncedPatientIds = Object.keys(pulledIds);
    return state;
  }

  function fillPatientName(text, fullName) {
    const name = String(fullName || '').trim();
    if (!name) return text;
    if (text == null) return text; // preserva null/undefined (ex.: conteudo ainda não gerado)
    return String(text).split('[NOME]').join(name);
  }

  function normalizeForSearch(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // Filtra sugestões (ex.: condutas comuns) por substring, ignorando caixa e acentos.
  function filterSuggestions(list, query) {
    const items = (list || []).slice();
    const q = normalizeForSearch(query).trim();
    if (!q) return items;
    return items.filter(function (s) { return normalizeForSearch(s).indexOf(q) !== -1; });
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
      trackers: (b.trackers || []).filter(Boolean).map(function (t) { return Object.assign({}, t, { id: t.id || uuid() }); }),
      exams: (b.exams || []).filter(Boolean).map(function (e) { return Object.assign({}, e, { id: e.id || uuid() }); }),
      rawTexts: (b.rawTexts || []).filter(Boolean).map(function (r) { return Object.assign({}, r, { id: r.id || uuid() }); }),
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
    s.syncBase = s.syncBase || {};
    s.cloudArchived = s.cloudArchived || {};
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

  // Zera os dados sincronizáveis (leitos + bookkeeping de sync) para permitir um pull "limpo"
  // a partir da verdade do servidor. Preserva preferências locais que NÃO vêm do banco
  // (notesTemplate, pinnedExams, commonCondutas, commonExtDocs, generalTasks, generalExams).
  // Uso: chamar ANTES de um applyPull, e só depois que o download do servidor já foi obtido com
  // sucesso — assim dados desatualizados/orfãos somem sem risco de ficar com o app vazio offline.
  function resetLocalSync(state) {
    const s = state || {};
    s.beds = [];
    s.deletedPatientIds = [];
    s.syncedPatientIds = [];
    s.lastSyncAt = null;
    s.syncBase = {};   // cloudArchived é preservado: guarda nomes que só existem no aparelho
    return s;
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
      (b.trackers || []).forEach(function (t, i) {
        // "ordem" é a posição do item na lista unificada de trackers (reordenável por arrasto)
        if (t.type === 'atb') {
          out.antibiotics.push({ id: t.id, patient_id: pid, nome: t.name || '', start_date: t.startDate || null, duration_days: t.duration || null, end_date: t.endDate || null, indicacao: t.indicacao || '', ordem: i });
        } else if (t.type === 'culture') {
          out.cultures.push({ id: t.id, patient_id: pid, tipo: t.name || '', collection_date: t.collectionDate || null, resultado: t.result || '', ordem: i });
        } else {
          out.devices.push({ id: t.id, patient_id: pid, nome: t.name || '', install_date: t.installDate || null, removal_date: t.removalDate || null, ordem: i });
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

  function applyPatientScalars(bed, p, notesTexto) {
    bed.bedNumber = p.bed_number || bed.bedNumber;
    bed.age = p.age == null ? '' : p.age;
    bed.admitDate = p.admit_date || '';
    bed.hpp = p.hpp || '';
    bed.anamneseInicial = p.anamnese_inicial || '';
    bed.dischargeForecast = p.discharge_forecast || '';
    bed.isArchived = p.status !== 'internado';
    bed.archiveReason = p.status === 'internado' ? null : p.status;
    bed.notes = notesTexto || '';
  }

  function applyRowsToBed(bed, rows) {
    bed.problems = (rows.problems || []).slice()
      .sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); })
      .map(function (r) { return { id: r.id, descricao: r.descricao || '', status: r.status || 'ativo', plano: r.plano || '', ordem: r.ordem || 0 }; });

    var mergedTrackers = []
      .concat((rows.antibiotics || []).map(function (r) {
        return { ord: r.ordem, t: { id: r.id, type: 'atb', name: r.nome || '', startDate: r.start_date || '', duration: r.duration_days || null, endDate: r.end_date || '', indicacao: r.indicacao || '' } };
      }))
      .concat((rows.cultures || []).map(function (r) {
        return { ord: r.ordem, t: { id: r.id, type: 'culture', name: r.tipo || '', collectionDate: r.collection_date || '', result: r.resultado || '' } };
      }))
      .concat((rows.devices || []).map(function (r) {
        return { ord: r.ordem, t: { id: r.id, type: 'device', name: r.nome || '', installDate: r.install_date || '', removalDate: r.removal_date || '' } };
      }));
    mergedTrackers.forEach(function (m, i) { if (m.ord == null) m.ord = 1000000 + i; });
    mergedTrackers.sort(function (a, b) { return a.ord - b.ord; });
    bed.trackers = mergedTrackers.map(function (m) { return m.t; });

    const labRows = (rows.exams || []).filter(function (r) { return r.tipo === 'lab'; });
    const labByDate = {};
    labRows.forEach(function (r) {
      const d = r.data || '';
      (labByDate[d] = labByDate[d] || []).push({ name: r.nome, value: r.resultado });
    });
    bed.exams = Object.keys(labByDate).sort().map(function (date) {
      return { id: uuid(), type: 'lab', date: date, results: labByDate[date] };
    }).concat((rows.exams || []).filter(function (r) { return r.tipo === 'imagem'; }).map(function (r) {
      return { id: r.id, type: 'image', date: r.data || '', name: r.nome || '', summary: r.resultado || '' };
    }));

    bed.condutas = (rows.condutas || []).map(function (r) { return { id: r.id, text: r.texto || '', done: !!r.done }; });
    bed.rawTexts = (rows.raw_texts || []).map(function (r) { return { id: r.id, tipo: r.tipo, data: r.data || '', texto: r.texto || '' }; });
    bed.generatedDocs = (rows.generated_docs || []).slice()
      .sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); })
      .map(function (r) { return { id: r.id, tipo: r.tipo, conteudo: r.conteudo, createdAt: r.created_at }; });
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
      applyPatientScalars(bed, p, (notes[p.id] && notes[p.id][0] && notes[p.id][0].texto) || '');
      applyRowsToBed(bed, {
        problems: problems[p.id] || [], antibiotics: atbs[p.id] || [], cultures: cultures[p.id] || [],
        devices: devices[p.id] || [], exams: exams[p.id] || [], condutas: condutas[p.id] || [],
        raw_texts: rawTexts[p.id] || [], generated_docs: docs[p.id] || [],
      });
    });

    // Verdade do banco após este pull: usado no próximo pull para detectar deleções remotas.
    state.syncedPatientIds = Object.keys(pulledIds);
    return state;
  }

  return {
    uuid: uuid,
    initialsFromName: initialsFromName,
    fillPatientName: fillPatientName,
    filterSuggestions: filterSuggestions,
    defaultState: defaultState,
    migrateBed: migrateBed,
    migrateState: migrateState,
    buildPushPayload: buildPushPayload,
    applyPull: applyPull,
    markPatientDeleted: markPatientDeleted,
    resetLocalSync: resetLocalSync,
    hash8: hash8,
    buildSyncBase: buildSyncBase,
    mergeRowSets: mergeRowSets,
    mergeStates: mergeStates,
  };
});
