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

  // ---- Iniciais no lugar do nome ---------------------------------------------
  // O nome completo só existe no aparelho onde foi digitado. Os outros recebem o paciente
  // com as iniciais do banco ("AB") em patientName — e NÃO sabem o nome: devolvem ao banco
  // as mesmas iniciais. Recalcular a partir de "AB" dava "A", e o aparelho seguinte recebia
  // o paciente com uma letra só.
  // bed.initialsPlaceholder:
  //   'AB'       iniciais recebidas do banco; valem enquanto patientName === 'AB'
  //              (digitar um nome por cima desfaz sozinho)
  //   ''         nome digitado neste aparelho
  //   undefined  leito gravado por versão anterior: decidido uma vez, na próxima mescla
  function isNamePlaceholder(bed) {
    return !!bed && !!bed.initialsPlaceholder && bed.patientName === bed.initialsPlaceholder;
  }
  // Nome de verdade ('' se o aparelho só tem as iniciais).
  function knownPatientName(bed) {
    return isNamePlaceholder(bed) ? '' : String((bed && bed.patientName) || '');
  }
  // Iniciais que vão ao banco.
  function bedInitials(bed) {
    return isNamePlaceholder(bed) ? bed.initialsPlaceholder : initialsFromName(bed && bed.patientName);
  }
  // O formato que initialsFromName gera: uma palavra só, curta, toda em maiúsculas.
  function looksLikeInitials(s) {
    return /^[A-ZÀ-ÖØ-Þ]{1,5}$/.test(s);
  }
  // Acerta a marca de um leito com as iniciais que vieram do banco.
  function syncNamePlaceholder(bed, remoteInitials) {
    const remote = String(remoteInitials || '').trim();
    if (bed.initialsPlaceholder === undefined) {
      // Leito antigo: é "iniciais no lugar do nome" se parece iniciais e bate com o banco
      // por prefixo ("AB" x "A": o banco encolheu, ou este aparelho recebeu já encolhido).
      // Fica a versão mais longa — é a que ainda não foi cortada.
      const local = String(bed.patientName || '').trim();
      const related = !!remote && !!local && (remote.indexOf(local) === 0 || local.indexOf(remote) === 0);
      if (looksLikeInitials(local) && related) {
        const best = remote.length > local.length ? remote : local;
        bed.patientName = best;
        bed.initialsPlaceholder = best;
      } else {
        bed.initialsPlaceholder = '';
      }
      return;
    }
    // Aparelho sem o nome acompanha o banco (quem tem o nome corrigiu as iniciais).
    if (remote && isNamePlaceholder(bed) && remote !== bed.initialsPlaceholder) {
      bed.patientName = remote;
      bed.initialsPlaceholder = remote;
    }
  }

  // ---- HPP: lista de comorbidades sobre um campo de texto ----------------
  // O banco guarda hpp como texto ("HAS, DM2"); a UI mostra como lista.
  // Vírgula dentro de parênteses não separa ("DM2 (NPH, metformina)").
  function parseHpp(text) {
    const s = String(text == null ? '' : text);
    const items = [];
    let buf = '', depth = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '(') depth++;
      else if (c === ')' && depth > 0) depth--;
      if ((c === ',' || c === ';' || c === '\n') && depth === 0) {
        items.push(buf); buf = '';
      } else {
        buf += c;
      }
    }
    items.push(buf);
    return items.map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function joinHpp(items) {
    return (items || [])
      .map(function (x) { return String(x == null ? '' : x).trim(); })
      .filter(Boolean).join(', ');
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

  // Hash de dispositivo: o kind só entra quando é 'procedimento', para que linhas
  // antigas (sem kind / kind 'device') mantenham o hash de antes da coluna existir.
  function deviceHash(nome, installDate, removalDate, kind) {
    const base = j(nome, installDate, removalDate);
    return hash8(kind === 'procedimento' ? base + SEP + 'procedimento' : base);
  }

  // ---- Evolução Tasy (painel_evolucoes): uma linha por paciente por dia --------
  // Os nove campos, na ordem do Tasy. O leito guarda as linhas com os nomes das
  // colunas do banco: { id, data, problemas, historia_internacao, ... }.
  const EVOLUCAO_FIELDS = ['problemas', 'historia_internacao', 'evolucao_atual', 'exames_lab', 'culturas',
    'exames_imagem', 'atualizacao_problemas', 'metas', 'acoes'];
  // Cumulativos: seguem de um dia para o outro. Os demais são diários (nascem vazios).
  const EVOLUCAO_CUMULATIVE = ['problemas', 'historia_internacao', 'exames_lab', 'culturas', 'exames_imagem'];

  function evolucaoRow(r) {
    const row = { id: r.id, data: r.data || null };
    EVOLUCAO_FIELDS.forEach(function (f) { row[f] = r[f] || ''; });
    return row;
  }
  function evolucaoHash(r) {
    return hash8(j.apply(null, EVOLUCAO_FIELDS.map(function (f) { return r[f]; })));
  }

  // Campos de texto do paciente com três-vias POR CAMPO (hash próprio na foto,
  // fora do hash geral dos scalars): assim as fotos tiradas antes de as colunas
  // existirem continuam válidas e o vazio de um aparelho recém-atualizado nunca
  // apaga o que a IA já gravou no banco.
  const PATIENT_TEXT_FIELDS = [
    { local: 'alergias', col: 'alergias' },
    { local: 'medicacoesPrevias', col: 'medicacoes_previas' },
  ];

  // Linhas do leito no formato do banco (sem patient_id), com hash de conteúdo e
  // posição original (ord). A identidade dos labs é a própria chave de conteúdo
  // data|nome|valor: editar um valor = deletar a linha antiga + criar uma nova.
  // A identidade de uma evolução é a DATA (o banco tem UNIQUE (patient_id, data)):
  // o mesmo dia criado no aparelho e no banco é a mesma linha, nunca duas.
  function localRowSets(bed) {
    const out = { problems: [], antibiotics: [], cultures: [], devices: [], condutas: [], raw_texts: [], examsImage: [], examsLab: [], evolucoes: [] };
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
        const row = { id: t.id, nome: t.name || '', install_date: t.installDate || null, removal_date: t.removalDate || null, kind: t.kind === 'procedimento' ? 'procedimento' : 'device' };
        out.devices.push({ key: row.id, hash: deviceHash(row.nome, row.install_date, row.removal_date, row.kind), ord: i, row: row });
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
    (bed.evolucoes || []).forEach(function (e, i) {
      const row = evolucaoRow(e);
      out.evolucoes.push({ key: String(row.data), hash: evolucaoHash(row), ord: i, row: row });
    });
    return out;
  }

  // Mesmos conjuntos, a partir das linhas baixadas do banco de UM paciente.
  // rows = { problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], raw_texts: [], evolucoes: [] }
  function pulledRowSets(rows) {
    const out = { problems: [], antibiotics: [], cultures: [], devices: [], condutas: [], raw_texts: [], examsImage: [], examsLab: [], evolucoes: [] };
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
      out.devices.push({ key: r.id, hash: deviceHash(r.nome, r.install_date, r.removal_date, r.kind), ord: r.ordem, row: r });
    });
    (rows.exams || []).forEach(function (r, i) {
      if (r.tipo === 'lab') out.examsLab.push({ key: j(r.data, r.nome, r.resultado), hash: '', ord: i, row: r });
      else out.examsImage.push({ key: r.id, hash: hash8(j(r.nome, r.data, r.resultado)), ord: i, row: r });
    });
    // ord = coluna "ordem" (o pull chega em ordem de chave primária, não de lista);
    // sem ordem (linha antiga, ou criada sem a coluna) → a mescla põe no fim.
    (rows.condutas || []).forEach(function (r) {
      out.condutas.push({ key: r.id, hash: hash8(j(r.texto, r.done)), ord: r.ordem, row: r });
    });
    (rows.raw_texts || []).forEach(function (r, i) {
      out.raw_texts.push({ key: r.id, hash: hash8(j(r.tipo, r.data, r.texto)), ord: i, row: r });
    });
    (rows.evolucoes || []).forEach(function (r, i) {
      out.evolucoes.push({ key: String(r.data), hash: evolucaoHash(r), ord: i, row: r });
    });
    return out;
  }

  function localStatus(bed) {
    return bed.isArchived ? (bed.archiveReason === 'alta' ? 'alta' : 'arquivado') : 'internado';
  }
  function localAge(bed) {
    return (bed.age === '' || bed.age == null) ? '' : String(Number(bed.age));
  }

  // Hash ÚNICO dos campos "corridos" do paciente, na mesma normalização do push. Era a
  // base do tudo-ou-nada antigo; continua na foto só para as fotos tiradas antes dos
  // hashes por campo (ver PATIENT_SCALAR_FIELDS) seguirem legíveis. Não mude a fórmula.
  function localScalarsHash(bed) {
    return hash8(j(bed.bedNumber, localAge(bed), bed.admitDate, bed.hpp, bed.anamneseInicial, bed.dischargeForecast,
      localStatus(bed), bed.notes, bed.personId, bed.dischargedAt));
  }

  // Campos corridos do paciente, com três-vias POR CAMPO: cada um tem o seu hash na foto
  // (syncBase[id].fields[col]). Antes o hash era um só — bastava o aparelho editar um
  // campo (uma anotação) para o push regravar todos e apagar o que a IA tinha escrito
  // nos outros (anamnese, HPP...).
  //   get(bed)             valor local normalizado (o que entra no hash)
  //   set(bed, p, notas)   adota o valor do banco
  //   emptyAdopts          sem hash do campo na foto, o vazio local adota o banco
  //   notInLegacyHash      campo que o hash único antigo não cobre: sem hash do campo na
  //                        foto, SÓ o vazio local adota o banco (paciente "intocado" não vale)
  // status e data da alta andam juntos (um só hash): nunca ficam meio de cada lado.
  // "notes" vem de painel_notes, não de painel_patients.
  const PATIENT_SCALAR_FIELDS = [
    { col: 'bed_number', get: function (b) { return b.bedNumber; },
      set: function (b, p) { b.bedNumber = p.bed_number || b.bedNumber; } },
    { col: 'age', get: localAge,
      set: function (b, p) { b.age = p.age == null ? '' : p.age; } },
    { col: 'admit_date', get: function (b) { return b.admitDate; },
      set: function (b, p) { b.admitDate = p.admit_date || ''; } },
    { col: 'hpp', emptyAdopts: true, get: function (b) { return b.hpp; },
      set: function (b, p) { b.hpp = p.hpp || ''; } },
    { col: 'anamnese_inicial', emptyAdopts: true, get: function (b) { return b.anamneseInicial; },
      set: function (b, p) { b.anamneseInicial = p.anamnese_inicial || ''; } },
    { col: 'discharge_forecast', get: function (b) { return b.dischargeForecast; },
      set: function (b, p) { b.dischargeForecast = p.discharge_forecast || ''; } },
    { col: 'status', get: function (b) { return j(localStatus(b), b.dischargedAt); },
      set: function (b, p) {
        b.isArchived = p.status !== 'internado';
        b.archiveReason = p.status === 'internado' ? null : p.status;
        b.dischargedAt = p.discharge_date || '';
      } },
    { col: 'notes', get: function (b) { return b.notes; },
      set: function (b, p, notesTexto) { b.notes = notesTexto || ''; } },
    { col: 'person_id', get: function (b) { return b.personId; },
      set: function (b, p) { b.personId = p.person_id || null; } },
    // Check de Queda (termo de ciência). Entrou depois do hash único: uma foto sem o hash
    // deste campo não diz nada sobre ele, então só o "pendente" local adota o banco — o
    // check marcado no aparelho nunca é desfeito na primeira sincronização.
    // Banco sem a coluna (valor ausente): mantém o local.
    { col: 'queda_orientada', notInLegacyHash: true, get: function (b) { return b.quedaOrientada ? '1' : ''; },
      set: function (b, p) { if (p.queda_orientada != null) b.quedaOrientada = !!p.queda_orientada; } },
  ];
  function scalarValue(f, bed) {
    const v = f.get(bed);
    return String(v == null ? '' : v);
  }

  const ROW_TABLES = ['problems', 'antibiotics', 'cultures', 'devices', 'condutas', 'raw_texts', 'examsImage', 'examsLab', 'evolucoes'];

  // A "foto" da última sincronização: chaves + hashes de tudo que foi gravado.
  // A chave reservada '#prefs' (nunca colide com uuid de paciente) fotografa as
  // preferências globais sincronizadas (painel_prefs).
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
      const fields = {};
      PATIENT_TEXT_FIELDS.forEach(function (f) { fields[f.col] = hash8(bed[f.local]); });
      PATIENT_SCALAR_FIELDS.forEach(function (f) { fields[f.col] = hash8(scalarValue(f, bed)); });
      base[bed.patientId] = { rows: rows, scalars: localScalarsHash(bed), fields: fields };
    });
    base['#prefs'] = { lab_ranges: hash8(state.labRangesText == null ? '' : state.labRangesText) };
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

  // Toda linha filha precisa de id ANTES da mescla/foto/push: sem id, a chave da
  // linha vira "undefined" na foto, o push sorteia um uuid que não volta ao
  // aparelho e a próxima sincronização vê duas linhas distintas (duplicata).
  function ensureRowIds(state) {
    (state.beds || []).forEach(function (bed) {
      ['problems', 'condutas', 'trackers', 'exams', 'rawTexts', 'evolucoes'].forEach(function (k) {
        (bed[k] || []).forEach(function (r) { if (r && !r.id) r.id = uuid(); });
      });
    });
  }

  // Garante patientId em todo leito com paciente. O leito nasce vazio (sem id) e o nome
  // é digitado depois; migrateBed só dá o id na carga do app. Sem isto, um paciente
  // criado e sincronizado na mesma sessão ficava fora do push (que pula leito sem id)
  // sem erro algum, até o app ser recarregado. Leito sem nome continua sem id.
  function ensurePatientIds(state) {
    (state.beds || []).forEach(function (bed) {
      if (bed && !bed.patientId && String(bed.patientName || '').trim()) bed.patientId = uuid();
    });
  }

  // Paciente guardado só na nuvem (status 'nuvem'): nunca é leito. Se este aparelho ainda
  // tinha o leito, ele sai e o nome completo vai para o registro local; se o registro já
  // existe, o nome guardado nele é preservado (só existe aqui).
  function keepInCloudRegistry(state, p, bed) {
    if (bed) {
      syncNamePlaceholder(bed, p.initials);
      state.cloudArchived[p.id] = { nome: knownPatientName(bed), iniciais: p.initials || '', leito: p.bed_number || bed.bedNumber || '', personId: p.person_id || bed.personId || null };
      state.beds = state.beds.filter(function (b) { return b.patientId !== p.id; });
    } else if (!state.cloudArchived[p.id]) {
      state.cloudArchived[p.id] = { nome: '', iniciais: p.initials || '', leito: p.bed_number || '', personId: p.person_id || null };
    } else {
      state.cloudArchived[p.id].personId = p.person_id || state.cloudArchived[p.id].personId || null;
    }
  }

  // Mescla three-way do estado inteiro com o que veio do banco.
  // Muta e retorna state, pronto para buildPushPayload. Ver spec 2026-08-25.
  function mergeStates(state, pulled) {
    ensurePatientIds(state);
    ensureRowIds(state);
    function byPatient(rows) {
      const m = {};
      (rows || []).forEach(function (r) { (m[r.patient_id] = m[r.patient_id] || []).push(r); });
      return m;
    }
    const problems = byPatient(pulled.problems), atbs = byPatient(pulled.antibiotics),
      cultures = byPatient(pulled.cultures), devices = byPatient(pulled.devices),
      exams = byPatient(pulled.exams), condutas = byPatient(pulled.condutas),
      notes = byPatient(pulled.notes), rawTexts = byPatient(pulled.raw_texts),
      docs = byPatient(pulled.generated_docs), evolucoes = byPatient(pulled.evolucoes);

    state.syncBase = state.syncBase || {};
    state.cloudArchived = state.cloudArchived || {};

    // Preferência global (faixas de referência): três-vias como os scalars — local
    // intocado desde a foto adota o banco; editado vence (o push regrava). Sem foto
    // (primeira sync após a atualização), só o padrão de fábrica adota o banco.
    const remotePref = (pulled.prefs || []).find(function (r) { return r.key === 'lab_ranges'; });
    if (remotePref) {
      const localText = state.labRangesText == null ? '' : state.labRangesText;
      const basePrefs = state.syncBase['#prefs'];
      const untouched = basePrefs
        ? hash8(localText) === basePrefs.lab_ranges
        : (state.labRangesText == null || state.labRangesText === DEFAULT_LAB_RANGES_TEXT);
      if (untouched) state.labRangesText = remotePref.value;
    }

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
      if (p.status === 'nuvem') { keepInCloudRegistry(state, p, bed); return; }

      const remoteRows = {
        problems: problems[p.id] || [], antibiotics: atbs[p.id] || [], cultures: cultures[p.id] || [],
        devices: devices[p.id] || [], exams: exams[p.id] || [], condutas: condutas[p.id] || [],
        raw_texts: rawTexts[p.id] || [], generated_docs: docs[p.id] || [],
        evolucoes: evolucoes[p.id] || [],
      };
      const remoteNote = (notes[p.id] && notes[p.id][0] && notes[p.id][0].texto) || '';

      if (!bed) {
        // Novo aqui (criado no banco, ou restaurado da nuvem): adoção integral.
        const reg = state.cloudArchived[p.id];
        // Reinternação feita noutro aparelho: o nome completo só existe localmente —
        // empresta de um leito da mesma pessoa (personId, ou patientId que virou personId).
        // Só de quem TEM o nome: leito da mesma pessoa que só tem iniciais não serve.
        const kin = p.person_id && (state.beds || []).find(function (b) {
          return knownPatientName(b) && (b.personId === p.person_id || b.patientId === p.person_id);
        });
        const known = (reg && reg.nome) || (kin && kin.patientName) || '';
        bed = migrateBed({ patientName: known || p.initials || '?', bedNumber: p.bed_number || '' });
        // Sem nome conhecido, o leito nasce com as iniciais do banco no lugar do nome. Com
        // nome vindo do registro ou de outro leito, confere se não eram iniciais antigas.
        if (known) syncNamePlaceholder(bed, p.initials); else bed.initialsPlaceholder = p.initials || '';
        bed.patientId = p.id;
        state.beds.push(bed);
        delete state.cloudArchived[p.id];
        applyPatientScalars(bed, p, remoteNote);
        applyPatientTextFields(bed, p);
        applyRowsToBed(bed, remoteRows);
        return;
      }

      syncNamePlaceholder(bed, p.initials);

      const base = state.syncBase[p.id] || null;
      const local = localRowSets(bed);
      const remote = pulledRowSets(remoteRows);
      function baseRows(t) { return base ? (base.rows[t] || {}) : null; }

      // Campos corridos, um a um: intocado desde a foto adota o banco; editado no
      // aparelho fica (o push regrava). Foto sem o hash do campo (tirada pela versão
      // anterior do app) ou sem foto: vale o hash único antigo — paciente inteiro
      // intocado adota tudo — e, fora isso, só o vazio local de HPP/anamnese adota o
      // banco (é onde a IA escreve; o vazio não tem o que perder).
      // Decide tudo antes de aplicar: o hash único é calculado com o leito intocado.
      const legacyUntouched = !!base && base.scalars === localScalarsHash(bed);
      PATIENT_SCALAR_FIELDS.filter(function (f) {
        const localVal = scalarValue(f, bed);
        if (base && base.fields && Object.prototype.hasOwnProperty.call(base.fields, f.col)) {
          return hash8(localVal) === base.fields[f.col];
        }
        if (f.notInLegacyHash) return localVal === '';
        return legacyUntouched || (!!f.emptyAdopts && localVal === '');
      }).forEach(function (f) { f.set(bed, p, remoteNote); });

      // person_id só nasce pelo botão Reinternar e nunca é editado à mão: se o banco
      // tem e o aparelho não, adota sempre (senão o push apagaria o vínculo com null).
      if (!bed.personId && p.person_id) bed.personId = p.person_id;

      // alergias / medicações prévias: três-vias por campo. Sem foto do campo (foto
      // anterior às colunas, ou nenhuma), só o vazio local adota o banco.
      PATIENT_TEXT_FIELDS.forEach(function (f) {
        const localVal = bed[f.local] || '';
        const untouched = (base && base.fields)
          ? hash8(localVal) === base.fields[f.col]
          : localVal === '';
        if (untouched) bed[f.local] = p[f.col] || '';
      });

      // Evoluções: mesma regra das outras linhas, com a data como chave. Se o banco
      // já tem a linha do dia, o id dele prevalece (o conteúdo é o do vencedor).
      const mergedEvolucoes = mergeRowSets(local.evolucoes, remote.evolucoes, baseRows('evolucoes'));
      const remoteEvoId = {};
      remote.evolucoes.forEach(function (e) { remoteEvoId[e.key] = e.row.id; });
      mergedEvolucoes.forEach(function (r) { if (remoteEvoId[String(r.data)]) r.id = remoteEvoId[String(r.data)]; });

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
        evolucoes: mergedEvolucoes,
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

  // ---- Datas e contagem de dias (puras: recebem "hoje" como string) ---------

  function parseISODate(s) {
    const d = new Date(String(s || '') + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }

  // Nº do dia corrido ("D1" no próprio dia). null sem data válida; 0 se futura.
  function dayNumber(startDate, todayStr) {
    if (!startDate) return null;
    const start = parseISODate(startDate), today = parseISODate(todayStr);
    if (!start || !today) return null;
    const diff = Math.round((today.getTime() - start.getTime()) / 86400000);
    return diff < 0 ? 0 : diff + 1;
  }

  function formatDateBR(iso) {
    const parts = String(iso || '').split('-');
    return parts.length === 3 ? parts[2] + '/' + parts[1] : '';
  }

  // ---- Regras de tela da lista (revisão de UI, Fase 2) -----------------------

  // Legenda e tom do botão Sincronizar. info = { sujo, ultimoSync: { dia, hora } | null,
  // erro, emCurso }; dia e hora já em horário local. Precedência: em curso, falha, nunca,
  // alterações a enviar, em dia. Fora de hoje/ontem (inclusive relógio atrasado), mostra o dia.
  function estadoDoSync(info, hojeISO) {
    const i = info || {};
    if (i.emCurso) return { tom: 'neutro', legenda: 'sincronizando…' };
    if (i.erro) return { tom: 'perigo', legenda: 'falhou' };
    if (!i.ultimoSync || !i.ultimoSync.dia) return { tom: 'atencao', legenda: 'nunca sincronizado' };
    if (i.sujo) return { tom: 'atencao', legenda: 'alterações a enviar' };
    const n = dayNumber(i.ultimoSync.dia, hojeISO);
    const hora = i.ultimoSync.hora || '';
    if (n === 1) return { tom: 'neutro', legenda: 'hoje ' + hora + ' ✓' };
    if (n === 2) return { tom: 'neutro', legenda: 'ontem ' + hora };
    return { tom: 'neutro', legenda: (formatDateBR(i.ultimoSync.dia) + ' ' + hora).trim() };
  }

  // Contagem do dia, só leitos não arquivados. Ocupado = nome depois de trim(); externo não
  // conta como visitado nem como pendente; aVisitar (o denominador) = ocupados − externos.
  function progressoDoDia(state) {
    const p = { total: 0, ocupados: 0, aVisitar: 0, visitados: 0, pendentes: 0, externos: 0, vazios: 0, tarefasAbertas: 0 };
    ((state && state.beds) || []).forEach(function (b) {
      if (!b || b.isArchived) return;
      p.total++;
      if (!String(b.patientName || '').trim()) { p.vazios++; return; }
      p.ocupados++;
      if (b.externalDoctor && b.externalDoctor.active) p.externos++;
      else if (b.isVisited) p.visitados++;
    });
    p.aVisitar = p.ocupados - p.externos;
    p.pendentes = p.aVisitar - p.visitados;
    p.tarefasAbertas = ((state && state.generalTasks) || []).filter(function (t) { return t && !t.done; }).length;
    return p;
  }

  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }

  // Título e detalhe do cabeçalho da lista. fracao null = sem barra.
  function fraseProgresso(p) {
    const partes = [];
    if (p.externos) partes.push(plural(p.externos, 'externo', 'externos'));
    if (p.vazios) partes.push(plural(p.vazios, 'vazio', 'vazios'));
    const detalhe = partes.join(' · ');
    if (!p.total) return { titulo: 'Nenhum leito', detalhe: detalhe, fracao: null };
    if (!p.aVisitar) return { titulo: 'Nenhum paciente para visitar', detalhe: detalhe, fracao: null };
    const todos = p.visitados >= p.aVisitar;
    return {
      titulo: p.visitados + ' de ' + p.aVisitar + ' visitados' + (todos ? ' ✓' : ''),
      detalhe: detalhe,
      fracao: Math.min(1, p.visitados / p.aVisitar),
    };
  }

  // Selo de alta prevista do cartão: atrasada = perigo, hoje = primária, em 1 ou 2 dias =
  // atenção, depois = neutro. null sem data válida.
  function statusAltaPrevista(dataISO, hojeISO) {
    if (!dataISO || !/^\d{4}-\d{2}-\d{2}$/.test(String(dataISO))) return null;
    const d = parseISODate(dataISO), hoje = parseISODate(hojeISO);
    if (!d || !hoje) return null;
    const diff = Math.round((d.getTime() - hoje.getTime()) / 86400000);
    const dia = formatDateBR(dataISO);
    if (diff < 0) return { status: 'atrasada', rotulo: 'Alta ' + dia + ' ⚠', tom: 'perigo' };
    if (diff === 0) return { status: 'hoje', rotulo: 'Alta hoje', tom: 'primaria' };
    if (diff <= 2) return { status: 'breve', rotulo: 'Alta ' + dia, tom: 'atencao' };
    return { status: 'futura', rotulo: 'Alta ' + dia, tom: 'neutro' };
  }

  // Estado do leito na lista: vazio, depois externo, depois visita + os quatro checks.
  // "Ocultar concluídos" esconde tudo o que não é 'pendente'.
  function estadoDoLeito(bed) {
    const b = bed || {};
    if (!String(b.patientName || '').trim()) return 'vazio';
    if (b.externalDoctor && b.externalDoctor.active) return 'externo';
    const c = b.checks || {};
    const todos = DAILY_CHECKS.every(function (k) { return !!c[k.key]; });
    return b.isVisited && todos ? 'concluido' : 'pendente';
  }

  // Selos de pendência do cartão: sem alta e lembrete (o selo de alta e o sino já dizem isso),
  // por gravidade (estável), no máximo `max`; `resto` vira o "+N".
  function selosDoCartao(itens, max) {
    const elegiveis = porGravidade((itens || []).filter(function (i) { return i.tipo !== 'alta' && i.tipo !== 'lembrete'; }));
    return {
      selos: elegiveis.slice(0, max).map(function (i) { return { curto: i.curto, gravidade: i.gravidade }; }),
      resto: Math.max(0, elegiveis.length - max),
    };
  }

  // Chip de admissão do cartão do paciente (spec 3.1): "Adm 07/11 · D10"; vazio, "Admissão".
  function chipAdmissao(admitDate, hojeISO) {
    if (!admitDate) return 'Admissão';
    const n = dayNumber(admitDate, hojeISO);
    return 'Adm ' + formatDateBR(admitDate) + (n >= 1 ? ' · D' + n : '');
  }

  // Itens do menu ⋯ da tela do paciente (spec 3.1). Arquivado: restaurar, reinternar (só com
  // paciente) e deletar. Ativo sem paciente: só deletar. Ativo com paciente: alta, arquivar, deletar.
  function acoesDoRegistro(bed) {
    const b = bed || {};
    const temNome = !!String(b.patientName || '').trim();
    if (b.isArchived) return temNome ? ['restaurar', 'reinternar', 'deletar'] : ['restaurar', 'deletar'];
    return temNome ? ['alta', 'arquivar', 'deletar'] : ['deletar'];
  }

  function fraseArquivados(pessoas, naNuvem) {
    const partes = [];
    if (pessoas) partes.push(plural(pessoas, 'paciente', 'pacientes'));
    if (naNuvem) partes.push(naNuvem + ' na nuvem');
    return { titulo: 'Arquivados', detalhe: partes.length ? partes.join(' · ') : 'Nenhum paciente arquivado' };
  }

  // ---- Labs: número do resultado e linha da última coleta -------------------

  // Extrai o valor numérico de um resultado ("9,5", "12.300", "120k", "<1,0").
  // Heurística: ponto seguido de exatamente 3 dígitos é milhar brasileiro
  // (12.300 = 12300); sufixo k multiplica por mil. null se não houver número.
  // Exceção: "0.xxx" é sempre decimal (troponina 0.034 não é 34). "7.350" segue como
  // milhar — pH com ponto é ambíguo com leucócitos 7.350; digite pH com vírgula.
  function labNumber(v) {
    const s = String(v == null ? '' : v).replace(/−/g, '-'); // sinal de menos tipográfico
    const mil = s.match(/-?(?!0+\.)\d{1,3}(?:\.\d{3})+(?!\d)/);
    if (mil) return parseFloat(mil[0].replace(/\./g, ''));
    const norm = s.replace(',', '.');
    const m = norm.match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    let n = parseFloat(m[0]);
    if (/^[kK]/.test(norm.slice(norm.indexOf(m[0]) + m[0].length))) n *= 1000;
    return n;
  }

  // Linha compacta da última coleta: "Labs 26/08: Hb 9,5 ▼ | Cr 1,1 | ...".
  // Fixados primeiro (na ordem de pinnedExams); setas comparam com a coleta anterior.
  function buildLabsLine(bed, pinnedExams) {
    const entries = ((bed && bed.exams) || [])
      .filter(function (e) { return e && e.type === 'lab' && e.date; })
      .slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    if (entries.length === 0) return '';
    const last = entries[entries.length - 1];
    const prevByName = {};
    if (entries.length > 1) {
      (entries[entries.length - 2].results || []).forEach(function (r) {
        prevByName[String(r.name).toLowerCase()] = r.value;
      });
    }
    const pinned = (pinnedExams || []).map(function (n) { return String(n).toLowerCase(); });
    const results = (last.results || []).slice().sort(function (a, b) {
      const ia = pinned.indexOf(String(a.name).toLowerCase()), ib = pinned.indexOf(String(b.name).toLowerCase());
      if (ia !== -1 && ib !== -1) return ia - ib;
      return (ia !== -1) ? -1 : (ib !== -1) ? 1 : 0;
    });
    const parts = results.map(function (r) {
      const num = labNumber(r.value), prevNum = labNumber(prevByName[String(r.name).toLowerCase()]);
      const trend = (num !== null && prevNum !== null && num !== prevNum) ? (num > prevNum ? ' ▲' : ' ▼') : '';
      return r.name + ' ' + r.value + trend;
    });
    return 'Labs ' + formatDateBR(last.date) + ': ' + parts.join(' | ');
  }

  // Seta de tendência de cada coleta da tabela de labs: '' | '▲' | '▼'. Entrada em ordem
  // CRONOLÓGICA (a tabela desenha da mais recente para a mais antiga, mas compara sempre
  // com a coleta anterior). Compara com a última coleta que tinha número: um "—" no meio
  // não quebra a comparação.
  function tendenciasLab(nums) {
    let prev = null;
    return (nums || []).map(function (n) {
      let t = '';
      if (n !== null && n !== undefined) {
        if (prev !== null && n !== prev) t = n > prev ? '▲' : '▼';
        prev = n;
      }
      return t;
    });
  }

  // ---- Faixas de referência: destaque de valores alterados no flowsheet ------
  // Preferência local (como pinnedExams): texto "Nome: min-max", uma linha por exame.

  const DEFAULT_LAB_RANGES_TEXT = [
    'Hb: 12-17', 'Ht: 36-50', 'Leucócitos: 4.000-11.000', 'Plaquetas: 150.000-450.000',
    'Cr: 0,6-1,3', 'Ur: 15-45', 'Na: 135-145', 'K: 3,5-5,0', 'PCR: 0-5', 'Glicemia: 70-140',
  ].join('\n');

  function parseLabRanges(text) {
    const out = {};
    String(text == null ? '' : text).split(/\r?\n/).forEach(function (line) {
      const idx = line.indexOf(':');
      if (idx === -1) return;
      const name = line.slice(0, idx).trim();
      // "min-max": cada lado pode ter sinal próprio ("-2-2", "-5--1"); o separador é hífen ou travessão.
      const sides = line.slice(idx + 1).match(/^\s*([-−]?\s*\d[\d.,]*)\s*[-–]\s*([-−]?\s*\d[\d.,]*)/);
      if (!name || !sides) return;
      const min = labNumber(sides[1].replace(/\s+/g, '')), max = labNumber(sides[2].replace(/\s+/g, ''));
      if (min === null || max === null) return;
      out[name.toLowerCase()] = { min: min, max: max };
    });
    return out;
  }

  // 'high' | 'low' | null (normal, sem faixa cadastrada ou resultado não numérico)
  function classifyLab(name, value, ranges) {
    const r = (ranges || {})[String(name == null ? '' : name).toLowerCase()];
    if (!r) return null;
    const n = labNumber(value);
    if (n === null) return null;
    if (n > r.max) return 'high';
    if (n < r.min) return 'low';
    return null;
  }

  // ---- Lançamento de coleta laboratorial ------------------------------------
  // Texto da textarea -> { results: [{name, value}], ignored: [linha crua] }.
  // Aceita "Nome: valor", "Nome = valor" e "Nome valor" (ex.: "Hb 9.5", "BE -2,5").
  // Em "Nome valor", um "19-9" seguido de outro número faz parte do nome ("CA 19-9 35").
  function parseLabText(text) {
    const results = [], ignored = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach(function (line) {
      const raw = line.trim();
      if (!raw) return;
      let name = '', value = '';
      const sep = raw.match(/^([^:=]+?)\s*[:=]\s*(.+)$/);
      if (sep) { name = sep[1].trim(); value = sep[2].trim(); }
      else {
        const VALUE = '[<>]?=?\\s*[-−]?[\\d.,].*';
        const sp = raw.match(new RegExp('^(\\D.*?)\\s+(' + VALUE + ')$'));
        if (sp) {
          name = sp[1].trim(); value = sp[2].trim();
          const inName = value.match(new RegExp('^(\\d+-\\d+)\\s+(' + VALUE + ')$'));
          if (inName) { name += ' ' + inName[1]; value = inName[2].trim(); }
        }
      }
      if (name && value) results.push({ name: name, value: value });
      else ignored.push(raw);
    });
    return { results: results, ignored: ignored };
  }

  // Sobrescreve por nome (case-insensitive) e acrescenta os que não existiam, preservando a ordem.
  function mergeLabResults(into, results) {
    results.forEach(function (r) {
      const hit = into.find(function (x) { return String(x.name).toLowerCase() === String(r.name).toLowerCase(); });
      if (hit) hit.value = r.value; else into.push({ name: r.name, value: r.value });
    });
    return into;
  }

  // Aplica uma coleta em `exams` (mutação in-place). Devolve a coleta afetada, ou null.
  // Sem opts.editDate = ADICIONAR: na mesma data mescla por nome (nunca remove).
  // Com opts.editDate = EDITAR a coleta daquela data: a lista passa a ser exatamente
  // `results` (linha apagada some; lista vazia apaga a coleta). Mudar a data move a
  // coleta; se a nova data já tiver coleta, os resultados são fundidos nela.
  function applyLabEntry(exams, date, results, opts) {
    opts = opts || {};
    results = (results || []).map(function (r) { return { name: r.name, value: r.value }; });
    const isLab = function (e) { return e && e.type === 'lab'; };
    const findByDate = function (d) { return exams.find(function (e) { return isLab(e) && e.date === d; }); };

    if (opts.editDate) {
      const edited = findByDate(opts.editDate);
      if (edited) {
        if (results.length === 0) {
          exams.splice(exams.indexOf(edited), 1);
          return null;
        }
        const target = date === opts.editDate ? null : findByDate(date);
        if (target) {
          exams.splice(exams.indexOf(edited), 1);
          mergeLabResults(target.results, results);
          return target;
        }
        edited.date = date;
        edited.results = results;
        return edited;
      }
    }

    if (results.length === 0) return null;
    const existing = findByDate(date);
    if (existing) {
      mergeLabResults(existing.results, results);
      return existing;
    }
    const entry = { id: uuid(), type: 'lab', date: date, results: results };
    exams.push(entry);
    return entry;
  }

  // ---- Exames fixados (sempre sem diferenciar maiúsculas de minúsculas) -------
  // A tabela mostra a primeira grafia vista ("HB"); o fixado pode estar como "Hb".
  function lcName(s) { return String(s == null ? '' : s).toLowerCase(); }

  // Posição de `name` em `pinned`; -1 se não estiver fixado.
  function pinnedExamIndex(pinned, name) {
    const n = lcName(name);
    return (pinned || []).findIndex(function (p) { return lcName(p) === n; });
  }

  // Fixados primeiro (na ordem de `pinned`); os demais em ordem alfabética. Lista nova.
  function sortExamNames(names, pinned) {
    return (names || []).slice().sort(function (a, b) {
      const ia = pinnedExamIndex(pinned, a), ib = pinnedExamIndex(pinned, b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return String(a).localeCompare(String(b));
    });
  }

  // Fixa `name` no topo, ou desafixa se já estava. Lista nova.
  function togglePinnedExam(pinned, name) {
    const out = (pinned || []).slice();
    const idx = pinnedExamIndex(out, name);
    if (idx !== -1) out.splice(idx, 1); else out.unshift(name);
    return out;
  }

  // Move `name` um passo (dir -1 = sobe, +1 = desce) dentro de `pinned`. Se `visible`
  // (nomes das linhas na tela) vier, o passo é relativo ao vizinho fixado VISÍVEL,
  // para que uma seta corresponda a uma linha da tabela. Devolve uma lista nova.
  function movePinnedExam(pinned, name, dir, visible) {
    const out = (pinned || []).slice();
    const lc = lcName;
    const idx = out.findIndex(function (p) { return lc(p) === lc(name); });
    if (idx === -1) return out;
    const vis = visible ? visible.map(lc) : null;
    const shown = out.filter(function (p) { return !vis || vis.indexOf(lc(p)) !== -1; });
    const sIdx = shown.findIndex(function (p) { return lc(p) === lc(name); });
    const neighbor = shown[sIdx + (dir < 0 ? -1 : 1)];
    if (sIdx === -1 || neighbor === undefined) return out;
    const item = out.splice(idx, 1)[0];
    const nIdx = out.indexOf(neighbor);
    out.splice(dir < 0 ? nIdx : nIdx + 1, 0, item);
    return out;
  }

  // ---- Selo do antibiótico na lista de trackers -------------------------------
  // { label, tone }. tone: 'ended' (suspenso, contagem congelada) | 'scheduled' (D1 futuro) |
  // 'due' (último dia ou prazo vencido) | 'long' (sem duração e D8+) | 'normal'.
  // Prazo vencido mostra o dia REAL (D9/7): o ATB segue em uso até alguém dar a data de fim.
  // Limiares de alerta, num lugar só (pendências, selo do ATB, lista de controles).
  const LIMIARES = { culturaDias: 3, dispositivoDias: 7, atbLongoDia: 8 };

  function atbBadge(t, todayStr) {
    const n = dayNumber(t.startDate, todayStr);
    if (t.endDate && t.endDate <= todayStr) {
      const used = dayNumber(t.startDate, t.endDate);
      return { label: used ? 'Suspenso D' + used : 'Suspenso', tone: 'ended' };
    }
    if (n === null) return { label: 'D-', tone: 'normal' };
    if (n === 0) return { label: 'Agendado', tone: 'scheduled' };
    if (t.duration) {
      if (n > t.duration) return { label: 'D' + n + '/' + t.duration + ' (prazo vencido)', tone: 'due' };
      if (n === t.duration) return { label: 'D' + n + '/' + t.duration + ' (último dia)', tone: 'due' };
      return { label: 'D' + n + '/' + t.duration, tone: 'normal' };
    }
    return { label: 'D' + n, tone: n >= LIMIARES.atbLongoDia ? 'long' : 'normal' };
  }

  // Soma n dias a uma data 'AAAA-MM-DD' no calendário local; '' sem data válida.
  function somaDias(iso, n) {
    const d = parseISODate(iso);
    if (!d) return '';
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function tipoControle(t) {
    if (t.type === 'atb') return 'atb';
    if (t.type === 'culture') return 'cultura';
    return t.kind === 'procedimento' ? 'procedimento' : 'dispositivo';
  }
  function culturaPendente(t) {
    const r = String(t.result || '').trim();
    return r === '' || /aguard/i.test(r);
  }

  // Selo de cada controle (spec 3.6), para os quatro tipos. `curto` vai no resumo da seção;
  // `ativo` é falso para ATB suspenso, cultura com resultado e dispositivo removido.
  function seloControle(t, hojeISO) {
    const tipo = tipoControle(t);
    const sel = function (rotulo, tom, ativo, curto) {
      return { tipo: tipo, rotulo: rotulo, curto: curto || rotulo, tom: tom, alerta: tom !== 'neutro', ativo: ativo };
    };
    if (tipo === 'atb') {
      const b = atbBadge(t, hojeISO);
      const rotulo = b.label.replace(/\s*\((.*)\)$/, ' $1');
      const curto = /^(Suspenso|Agendado)/.test(rotulo) ? rotulo : rotulo.split(' ')[0];
      const tom = /prazo vencido/.test(b.label) ? 'perigo' : (b.tone === 'due' || b.tone === 'long') ? 'atencao' : 'neutro';
      return sel(rotulo, tom, b.tone !== 'ended', curto);
    }
    if (tipo === 'cultura') {
      const n = dayNumber(t.collectionDate, hojeISO);
      const pendente = culturaPendente(t);
      const alerta = pendente && n !== null && n >= LIMIARES.culturaDias;
      return sel(n === null ? 'D-' : 'D' + n, alerta ? 'atencao' : 'neutro', pendente);
    }
    if (tipo === 'procedimento') {
      const n = dayNumber(t.installDate, hojeISO);
      return sel(n === null ? 'PO D-' : n === 0 ? 'Agendado' : 'PO D' + n, 'neutro', true);
    }
    if (t.removalDate) {
      const usados = dayNumber(t.installDate, t.removalDate);
      return sel(usados ? 'Removido D' + usados : 'Removido', 'neutro', false);
    }
    const n = dayNumber(t.installDate, hojeISO);
    const alerta = n !== null && n >= LIMIARES.dispositivoDias;
    return sel(n === null ? 'D-' : 'D' + n, alerta ? 'atencao' : 'neutro', true);
  }

  // Fim previsto do ATB: a data de fim digitada, se ainda não passou; senão D1 + duração − 1.
  // '' para ATB já suspenso ou sem duração.
  function fimPrevistoAtb(t, hojeISO) {
    if (t.endDate) return t.endDate > hojeISO ? t.endDate : '';
    if (!t.startDate || !t.duration) return '';
    return somaDias(t.startDate, Number(t.duration) - 1);
  }

  // Texto de uma linha só: quebras (e o espaço em volta delas) viram um espaço.
  function umaLinha(texto) {
    return String(texto == null ? '' : texto).replace(/\s*[\r\n]+\s*/g, ' ').trim();
  }
  function cortar(texto, n) {
    return texto.length > n ? texto.slice(0, n) + '…' : texto;
  }
  function plural2(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }
  function maiorData(lista, campo) {
    return (lista || []).reduce(function (m, x) { const d = (x && x[campo]) || ''; return d > m ? d : m; }, '');
  }

  const GENDOC_LABEL = { sumario_alta: 'Sumário de Alta', receituario: 'Receituário', laudo: 'Laudo' };

  // Resumo de uma linha no título da seção fechada (spec 3.4). opts = { hoje, pinnedExams,
  // notesTemplate, anteriores, diaLocal }. Seção desconhecida ou sem conteúdo: ''.
  function resumoSecao(bed, secao, opts) {
    const b = bed || {};
    const o = opts || {};
    const hoje = o.hoje;
    const br = formatDateBR;
    switch (secao) {
      case 'problemas': {
        const ps = b.problems || [];
        const ativos = ps.filter(function (p) { return p && p.status === 'ativo'; })
          .map(function (p) { return umaLinha(p.descricao); }).filter(Boolean);
        const cronicos = ps.filter(function (p) { return p && p.status === 'cronico'; }).length;
        if (cronicos) ativos.push(plural2(cronicos, 'crônico', 'crônicos'));
        return ativos.join(' · ');
      }
      case 'hpp':
        return parseHpp(b.hpp || '').map(umaLinha).filter(Boolean).join(' · ');
      case 'alergias': {
        const alergia = umaLinha(b.alergias);
        const meds = umaLinha(b.medicacoesPrevias);
        return (alergia || 'Nenhuma alergia registrada') + (meds ? ' · ' + cortar(meds, 40) : '');
      }
      case 'anamnese':
        return cortar(umaLinha(b.anamneseInicial), 60);
      case 'internacoes': {
        const ant = o.anteriores || [];
        if (!ant.length) return '';
        const ultima = maiorData(ant, 'dischargedAt');
        return plural2(ant.length, 'internação', 'internações') + (ultima ? ' · última alta ' + br(ultima) : '');
      }
      case 'controles': {
        const selos = (b.trackers || []).filter(Boolean).map(function (t) { return { t: t, s: seloControle(t, hoje) }; })
          .filter(function (x) { return x.s.ativo; });
        const ordem = selos.filter(function (x) { return x.s.alerta; }).concat(selos.filter(function (x) { return !x.s.alerta; }));
        return ordem.map(function (x) {
          return cortar(umaLinha(x.t.name), 14) + ' ' + x.s.curto + (x.s.alerta ? ' ⚠' : '');
        }).join(' · ');
      }
      case 'exames':
        return buildLabsLine(b, o.pinnedExams || []) || '';
      case 'condutas': {
        const cs = b.condutas || [];
        if (!cs.length) return '';
        const feitas = cs.filter(function (c) { return c && c.done; }).length;
        const prox = cs.find(function (c) { return c && !c.done && umaLinha(c.text); });
        return feitas + '/' + cs.length + ' feitas' + (prox ? ' · próxima: ' + umaLinha(prox.text) : '');
      }
      case 'anotacoes': {
        const modelo = {};
        String(o.notesTemplate || '').split(/\r?\n/).forEach(function (l) { if (l.trim()) modelo[l.trim()] = true; });
        const linha = String(b.notes || '').split(/\r?\n/).map(function (l) { return l.trim(); })
          .find(function (l) { return l && !modelo[l]; });
        return linha || '';
      }
      case 'evolucao': {
        const evs = b.evolucoes || [];
        if (evs.some(function (e) { return e && e.data === hoje; })) return 'Hoje ✓';
        const ultima = maiorData(evs, 'data');
        return ultima ? 'Última: ' + br(ultima) : 'Nenhuma';
      }
      case 'textos': {
        const ts = (b.rawTexts || []).filter(Boolean);
        if (!ts.length) return '';
        const ultimo = maiorData(ts, 'data');
        return plural2(ts.length, 'texto', 'textos') + (ultimo ? ' · último ' + br(ultimo) : '');
      }
      case 'documentos': {
        const docs = (b.generatedDocs || []).filter(Boolean);
        if (!docs.length) return '';
        const recente = docs.reduce(function (m, d) { return String(d.createdAt || '') > String(m.createdAt || '') ? d : m; });
        const diaLocal = o.diaLocal || function (s) { return String(s || '').slice(0, 10); };
        const dia = recente.createdAt ? diaLocal(recente.createdAt) : '';
        return ((GENDOC_LABEL[recente.tipo] || recente.tipo || 'Documento') + (dia ? ' ' + br(dia) : '')).trim();
      }
      default:
        return '';
    }
  }

  // Segunda linha do item de controle (spec 3.6).
  function linhaControle(t, hojeISO) {
    const tipo = tipoControle(t);
    const br = formatDateBR;
    const partes = [];
    if (tipo === 'atb') {
      partes.push('ATB');
      if (t.startDate) partes.push('D1 ' + br(t.startDate));
      const s = seloControle(t, hojeISO);
      const fim = fimPrevistoAtb(t, hojeISO);
      if (!s.ativo) partes.push('fim ' + br(t.endDate));
      else if (fim) partes.push('fim previsto ' + br(fim));
      else if (t.startDate) partes.push(s.alerta ? 'sem prazo, reavaliar' : 'sem prazo');
    } else if (tipo === 'cultura') {
      partes.push('Cultura');
      if (t.collectionDate) partes.push('coleta ' + br(t.collectionDate));
      partes.push(String(t.result || '').trim() || 'Aguardando');
      if (seloControle(t, hojeISO).alerta) partes.push('resultado pendente');
    } else if (tipo === 'procedimento') {
      partes.push('Proc');
      if (t.installDate) partes.push(br(t.installDate));
    } else {
      partes.push('Disp');
      if (t.installDate) partes.push('início ' + br(t.installDate));
      if (t.removalDate) partes.push('removido ' + br(t.removalDate));
      else if (seloControle(t, hojeISO).alerta) partes.push('tempo prolongado');
    }
    return partes.join(' · ');
  }

  // Os quatro checks diários, na ordem da tela. `label` é a sigla inteira (a primeira letra
  // sozinha confundia EV com EX); `nome` vai no aria-label.
  const DAILY_CHECKS = [
    { key: 'ev', label: 'EV', nome: 'Evolução' },
    { key: 'p', label: 'P', nome: 'Prescrição' },
    { key: 'ex', label: 'EX', nome: 'Exames' },
    { key: 'tev', label: 'TEV', nome: 'Profilaxia de TEV' },
  ];

  // Check "Queda" (termo de ciência, uma vez por internação): só em leito ativo, ocupado e
  // acompanhado pelo próprio médico — como os checks de visita, não vale para médico externo.
  function showsQuedaCheck(bed) {
    if (!bed || !bed.patientName || String(bed.patientName).trim() === '') return false;
    if (bed.isArchived) return false;
    return !(bed.externalDoctor && bed.externalDoctor.active);
  }

  // ---- Resumo do dia: texto pronto para colar na evolução --------------------
  // Roda só no aparelho: pode usar o nome completo (nunca vai ao banco).
  function buildDailySummary(bed, opts) {
    opts = opts || {};
    const todayStr = opts.todayStr;
    const lines = [];

    let header = 'Leito ' + (bed.bedNumber || '—') + ' — ' + (bed.patientName || '?');
    if (bed.age !== '' && bed.age != null) header += ', ' + bed.age + 'a';
    const dih = dayNumber(bed.admitDate, todayStr);
    if (dih) header += ', DIH D' + dih;
    lines.push(header);

    const ativos = (bed.problems || []).filter(function (p) { return p && (p.status || 'ativo') === 'ativo'; });
    if (ativos.length) {
      lines.push('Problemas: ' + ativos.map(function (p, i) {
        return (i + 1) + '. ' + p.descricao + (p.plano ? ' — ' + p.plano : '');
      }).join('; '));
    }

    const atbs = [], disps = [], cults = [];
    (bed.trackers || []).forEach(function (t) {
      if (!t) return;
      if (t.type === 'atb') {
        if (t.endDate && todayStr && t.endDate <= todayStr) {
          const used = dayNumber(t.startDate, t.endDate);
          atbs.push(t.name + ' suspenso ' + formatDateBR(t.endDate) + (used ? ' (D' + used + ')' : ''));
        } else {
          const n = dayNumber(t.startDate, todayStr);
          if (n === 0) atbs.push(t.name + ' agendado (D1 ' + formatDateBR(t.startDate) + ')');
          else atbs.push(t.name + ' D' + (n == null ? '-' : n) + (t.duration ? '/' + t.duration : '') + ' (D1 ' + formatDateBR(t.startDate) + ')');
        }
      } else if (t.type === 'culture') {
        cults.push(t.name + ' ' + formatDateBR(t.collectionDate) + ' — ' + (String(t.result || '').trim() || 'aguardando'));
      } else if (t.kind === 'procedimento') {
        const n = dayNumber(t.installDate, todayStr);
        disps.push(t.name + ' — PO D' + (n == null ? '-' : n));
      } else if (!t.removalDate) {
        const n = dayNumber(t.installDate, todayStr);
        disps.push(t.name + ' — D' + (n == null ? '-' : n));
      }
    });
    if (atbs.length) lines.push('ATB: ' + atbs.join('; '));
    if (disps.length) lines.push('Disp: ' + disps.join('; '));
    if (cults.length) lines.push('Culturas: ' + cults.join('; '));

    const labs = buildLabsLine(bed, opts.pinnedExams);
    if (labs) lines.push(labs);
    return lines.join('\n');
  }

  // ---- Pendências do dia: tudo que pede ação, varrendo os leitos ativos -----
  // Retorna [{bedIndex, bedNumber, patientName, tipo, label}] na ordem dos leitos.
  // tipo: 'atb' | 'cultura' | 'dispositivo' | 'alta' | 'lembrete'
  function buildPendencias(state, todayStr) {
    const out = [];
    (state.beds || []).forEach(function (bed, bedIndex) {
      if (bed.isArchived) return;
      if (!bed.patientName || !String(bed.patientName).trim()) return;
      if (bed.externalDoctor && bed.externalDoctor.active) return;

      // gravidade: 'alerta' | 'atencao' | 'info' (spec 2.3); curto: rótulo de selo.
      function add(tipo, label, gravidade, curto) {
        out.push({ bedIndex: bedIndex, bedNumber: bed.bedNumber || '', patientName: bed.patientName || '', tipo: tipo, label: label, gravidade: gravidade, curto: curto });
      }

      (bed.trackers || []).forEach(function (t) {
        if (!t) return;
        if (t.type === 'atb') {
          const ended = t.endDate && t.endDate <= todayStr;
          const n = dayNumber(t.startDate, todayStr);
          if (ended || !t.duration || n === null || n === 0) return;
          const dd = 'D' + n + '/' + t.duration;
          if (n === t.duration) add('atb', 'ATB ' + t.name + ': último dia (' + dd + ')', 'atencao', 'ATB ' + dd);
          else if (n > t.duration) add('atb', 'ATB ' + t.name + ': prazo vencido (' + dd + ')', 'alerta', 'ATB ' + dd);
        } else if (t.type === 'culture') {
          const resultText = String(t.result || '').trim();
          const pending = resultText === '' || /aguard/i.test(resultText);
          const n = dayNumber(t.collectionDate, todayStr);
          if (pending && n !== null && n >= LIMIARES.culturaDias) add('cultura', 'Cultura ' + t.name + ': sem resultado (D' + n + ')', 'atencao', 'Cultura D' + n);
        } else {
          if (t.kind === 'procedimento' || t.removalDate) return;
          const n = dayNumber(t.installDate, todayStr);
          if (n !== null && n >= LIMIARES.dispositivoDias) {
            const palavra = String(t.name || '').trim().split(/\s+/)[0].slice(0, 8) || 'Disp';
            add('dispositivo', t.name + ': D' + n + ', avaliar retirada', 'atencao', palavra + ' D' + n);
          }
        }
      });

      if (bed.dischargeForecast) {
        if (bed.dischargeForecast === todayStr) add('alta', 'Alta prevista hoje', 'info', 'Alta hoje');
        else if (bed.dischargeForecast < todayStr) add('alta', 'Alta prevista atrasada (' + formatDateBR(bed.dischargeForecast) + ')', 'alerta', 'Alta atrasada');
      }
      if (bed.reminderDate && bed.reminderDate <= todayStr) add('lembrete', 'Lembrete para hoje', 'atencao', 'Lembrete');
    });
    return out;
  }

  const ORDEM_GRAVIDADE = { alerta: 0, atencao: 1, info: 2 };
  function porGravidade(itens) {
    // ordenação estável: mesmo peso mantém a ordem de chegada
    return itens.map(function (it, i) { return { it: it, i: i }; }).sort(function (a, b) {
      return (ORDEM_GRAVIDADE[a.it.gravidade] - ORDEM_GRAVIDADE[b.it.gravidade]) || (a.i - b.i);
    }).map(function (x) { return x.it; });
  }

  // Uma entrada por leito: grupos pela gravidade máxima e, no empate, pelo número do leito
  // (minúsculas + localeCompare, como a lista); dentro do grupo, itens por gravidade.
  function agruparPendencias(pend) {
    const byBed = {};
    const grupos = [];
    (pend || []).forEach(function (p) {
      if (!byBed[p.bedIndex]) { byBed[p.bedIndex] = { bedIndex: p.bedIndex, bedNumber: p.bedNumber, gravidadeMax: p.gravidade, itens: [] }; grupos.push(byBed[p.bedIndex]); }
      byBed[p.bedIndex].itens.push(p);
    });
    grupos.forEach(function (g) {
      g.itens = porGravidade(g.itens);
      g.gravidadeMax = g.itens[0].gravidade;
    });
    return grupos.sort(function (a, b) {
      return (ORDEM_GRAVIDADE[a.gravidadeMax] - ORDEM_GRAVIDADE[b.gravidadeMax]) ||
        String(a.bedNumber || 'zzzz').toLowerCase().localeCompare(String(b.bedNumber || 'zzzz').toLowerCase());
    });
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
      pinnedExams: ['Hb', 'Ht', 'Leucócitos', 'Plaquetas', 'Cr', 'Ur', 'Na', 'K', 'PCR', 'Glicemia'],
      labRangesText: DEFAULT_LAB_RANGES_TEXT
    };
  }

  function migrateBed(b) {
    b = b || {};
    const hasPatient = !!(b.patientName && String(b.patientName).trim());
    const out = {
      patientId: b.patientId || (hasPatient ? uuid() : null),
      personId: b.personId || null,
      bedNumber: b.bedNumber || '', patientName: b.patientName || '',
      age: b.age === 0 ? 0 : (b.age || ''), admitDate: b.admitDate || '',
      hpp: b.hpp || '', anamneseInicial: b.anamneseInicial || '',
      alergias: b.alergias || '', medicacoesPrevias: b.medicacoesPrevias || '',
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
      evolucoes: (b.evolucoes || []).filter(Boolean).map(function (e) { return Object.assign({}, e, { id: e.id || uuid() }); }),
      externalDoctor: b.externalDoctor || { active: false, name: '' },
      checks: b.checks || { ev: false, p: false, ex: false, tev: false },
      // Termo de ciência do risco de queda: uma vez por internação. Fica fora de `checks`
      // de propósito — aquele objeto zera todo dia; este vale até a alta. Sincroniza em painel_patients.queda_orientada.
      quedaOrientada: !!b.quedaOrientada,
      isVisited: !!b.isVisited, reminderDate: b.reminderDate || '',
      dischargeForecast: b.dischargeForecast || '',
      isArchived: !!b.isArchived,
      archiveReason: b.archiveReason || (b.isArchived ? 'arquivado' : null),
      dischargedAt: b.dischargedAt || '',
      isHppMinimized: b.isHppMinimized !== undefined ? b.isHppMinimized : false,
      isProblemsMinimized: b.isProblemsMinimized !== undefined ? b.isProblemsMinimized : (b.isDxMinimized !== undefined ? b.isDxMinimized : false),
      isAnamneseMinimized: b.isAnamneseMinimized !== undefined ? b.isAnamneseMinimized : true,
      isAlergiasMinimized: b.isAlergiasMinimized !== undefined ? b.isAlergiasMinimized : true,
      isEvolucaoTasyMinimized: b.isEvolucaoTasyMinimized !== undefined ? b.isEvolucaoTasyMinimized : true,
      isTrackerMinimized: b.isTrackerMinimized !== undefined ? b.isTrackerMinimized : true,
      isExamsMinimized: b.isExamsMinimized !== undefined ? b.isExamsMinimized : true,
      isNotesMinimized: b.isNotesMinimized !== undefined ? b.isNotesMinimized : true,
      isCondutaMinimized: b.isCondutaMinimized !== undefined ? b.isCondutaMinimized : true,
      isRawTextsMinimized: b.isRawTextsMinimized !== undefined ? b.isRawTextsMinimized : true,
      isDocsMinimized: b.isDocsMinimized !== undefined ? b.isDocsMinimized : true,
      isPrevAdmissionsMinimized: b.isPrevAdmissionsMinimized !== undefined ? b.isPrevAdmissionsMinimized : true,
    };
    // Iniciais no lugar do nome (ver isNamePlaceholder). Leito antigo fica SEM a chave de
    // propósito: é o sinal para a próxima mescla decidir, uma vez, se o nome são iniciais.
    if (typeof b.initialsPlaceholder === 'string') out.initialsPlaceholder = b.initialsPlaceholder;
    return out;
  }

  // ---- Reinternação: nova internação da mesma pessoa -------------------------
  // Copia o que é da PESSOA (nome, idade, HPP, alergias, medicações prévias, exames,
  // trackers, problemas crônicos) e zera o que é da INTERNAÇÃO (HDA, condutas, notas,
  // textos, docs, evoluções, checks).
  // Trackers abertos são fechados com a data da alta anterior para não nascerem alertando.
  // Não muta previousBed: devolve o patch a aplicar nele (personId).
  function buildReadmission(previousBed, bedNumber, todayStr) {
    const prev = previousBed || {};
    const personId = prev.personId || prev.patientId || uuid();
    const closeDate = prev.dischargedAt || todayStr;
    const problems = (prev.problems || [])
      .filter(function (p) { return p && p.status === 'cronico'; })
      .map(function (p, i) { return { id: uuid(), descricao: p.descricao || '', status: 'cronico', plano: p.plano || '', ordem: i }; });
    const trackers = (prev.trackers || []).filter(Boolean).map(function (t) {
      const c = Object.assign({}, t, { id: uuid() });
      if (c.type === 'atb') { if (!c.endDate) c.endDate = closeDate; }
      else if (c.type !== 'culture') { if (!c.removalDate) c.removalDate = closeDate; }
      return c;
    });
    const exams = (prev.exams || []).filter(Boolean).map(function (e) {
      const c = JSON.parse(JSON.stringify(e));
      c.id = uuid();
      return c;
    });
    const newBed = migrateBed({
      patientId: uuid(), personId: personId, bedNumber: bedNumber || '',
      patientName: prev.patientName || '', initialsPlaceholder: prev.initialsPlaceholder,
      age: prev.age, hpp: prev.hpp || '',
      alergias: prev.alergias || '', medicacoesPrevias: prev.medicacoesPrevias || '',
      admitDate: todayStr, problems: problems, trackers: trackers, exams: exams,
      isAnamneseMinimized: false,
    });
    return { newBed: newBed, previousPatch: { personId: personId } };
  }

  // "Nova evolução de hoje": se a linha de hoje já existe, devolve-a intacta; senão
  // cria a de hoje copiando os campos cumulativos da linha anterior mais recente e
  // deixando os diários vazios. Muta bed.evolucoes e devolve a linha.
  function newEvolucaoForToday(bed, todayStr) {
    bed.evolucoes = bed.evolucoes || [];
    const existing = bed.evolucoes.find(function (e) { return e.data === todayStr; });
    if (existing) return existing;
    const prev = bed.evolucoes
      .filter(function (e) { return e.data && e.data < todayStr; })
      .sort(function (a, b) { return String(a.data).localeCompare(String(b.data)); })
      .pop();
    const row = { id: uuid(), data: todayStr };
    EVOLUCAO_FIELDS.forEach(function (f) {
      row[f] = (prev && EVOLUCAO_CUMULATIVE.indexOf(f) !== -1) ? (prev[f] || '') : '';
    });
    bed.evolucoes.push(row);
    return row;
  }

  // ---- Documentos em blocos ("=== NOME DO CAMPO ===") ------------------------
  // Devolve [{ title, content, conferir }] ou null se o texto não tem marcadores
  // (documento antigo: exibido inteiro, como sempre). O conteúdo perde só as linhas
  // em branco das bordas; "conferir" marca o bloco "PARA CONFERIR (NÃO COLAR...)".
  function parseDocBlocks(text) {
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    const blocks = [];
    let current = { title: '', lines: [] };
    let found = false;
    lines.forEach(function (line) {
      const m = line.match(/^\s*={3,}\s*(.+?)\s*={3,}\s*$/);
      if (m) {
        found = true;
        blocks.push(current);
        current = { title: m[1], lines: [] };
      } else {
        current.lines.push(line);
      }
    });
    if (!found) return null;
    blocks.push(current);
    return blocks.map(function (b) {
      const ls = b.lines.slice();
      while (ls.length && !ls[0].trim()) ls.shift();
      while (ls.length && !ls[ls.length - 1].trim()) ls.pop();
      return { title: b.title, content: ls.join('\n'), conferir: /^PARA CONFERIR/i.test(b.title) };
    }).filter(function (b) { return b.title || b.content; });
  }

  // ---- Internações da mesma pessoa -------------------------------------------
  // Ordem cronológica: admitDate, depois dischargedAt, depois posição em state.beds.
  function compareAdmissions(a, b) {
    const c1 = String(a.bed.admitDate || '').localeCompare(String(b.bed.admitDate || ''));
    if (c1) return c1;
    const c2 = String(a.bed.dischargedAt || '').localeCompare(String(b.bed.dischargedAt || ''));
    if (c2) return c2;
    return a.index - b.index;
  }

  // Todas as internações (leitos) de uma pessoa, mais recente primeiro.
  function personAdmissions(beds, personId) {
    if (!personId) return [];
    return (beds || []).map(function (bed, index) { return { bed: bed, index: index }; })
      .filter(function (x) { return x.bed && x.bed.personId === personId; })
      .sort(compareAdmissions).reverse();
  }

  function previousAdmissions(beds, bed) {
    return personAdmissions(beds, bed && bed.personId).filter(function (x) { return x.bed !== bed; });
  }

  // Lista Arquivados agrupada: uma entrada por pessoa (a arquivada mais recente),
  // registros sem personId ficam individuais. matches(bed) opcional: mantém o grupo
  // se qualquer internação dele bater (busca por nome/leito antigo).
  function groupArchived(beds, matches) {
    const seen = {};
    const out = [];
    (beds || []).forEach(function (bed, index) {
      if (!bed || !bed.isArchived) return;
      if (!bed.personId) {
        out.push({ latest: bed, latestIndex: index, members: [{ bed: bed, index: index }], count: 1, ordinal: 1 });
        return;
      }
      if (seen[bed.personId]) return;
      seen[bed.personId] = true;
      const all = personAdmissions(beds, bed.personId);
      const members = all.filter(function (x) { return x.bed.isArchived; });
      const latest = members[0];
      const ordinal = all.length - all.indexOf(latest); // posição cronológica (1 = primeira internação)
      out.push({ latest: latest.bed, latestIndex: latest.index, members: members, count: members.length, ordinal: ordinal });
    });
    // Cada grupo aparece onde sua internação arquivada mais recente está em state.beds
    // (convenção da lista: "Dar alta" acrescenta ao final) — não onde a pessoa apareceu
    // pela primeira vez, senão um paciente readmitido e recém-arquivado voltaria para trás.
    out.sort(function (a, b) { return a.latestIndex - b.latestIndex; });
    return matches ? out.filter(function (g) { return g.members.some(function (m) { return matches(m.bed); }); }) : out;
  }

  // Registro "Na nuvem" (state.cloudArchived) agrupado por personId.
  function groupCloudArchived(cloudArchived) {
    const byKey = {};
    const out = [];
    Object.keys(cloudArchived || {}).forEach(function (id) {
      const reg = cloudArchived[id];
      const key = (reg && reg.personId) ? 'person:' + reg.personId : 'id:' + id;
      if (!byKey[key]) { byKey[key] = { ids: [], reg: reg, count: 0 }; out.push(byKey[key]); }
      const g = byKey[key];
      g.ids.push(id);
      g.count++;
      if (!(g.reg && g.reg.nome) && reg && reg.nome) g.reg = reg;
    });
    return out;
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
    s.labRangesText = s.labRangesText || def.labRangesText;
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
    const out = { patients: [], problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [], evolucoes: [], deletePatientIds: (state.deletedPatientIds || []).slice() };
    out.prefs = [{ key: 'lab_ranges', value: state.labRangesText == null ? '' : state.labRangesText }];
    (state.beds || []).forEach(function (b) {
      if (!b.patientId) return;
      const pid = b.patientId;
      out.patients.push({
        id: pid,
        bed_number: b.bedNumber || '',
        initials: bedInitials(b),
        age: (b.age === '' || b.age == null) ? null : Number(b.age),
        admit_date: b.admitDate || null,
        hpp: b.hpp || '',
        anamnese_inicial: b.anamneseInicial || '',
        alergias: b.alergias || '',
        medicacoes_previas: b.medicacoesPrevias || '',
        discharge_forecast: b.dischargeForecast || null,
        status: b.isArchived ? (b.archiveReason === 'alta' ? 'alta' : 'arquivado') : 'internado',
        person_id: b.personId || null,
        discharge_date: b.dischargedAt || null,
        queda_orientada: !!b.quedaOrientada,
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
          out.devices.push({ id: t.id, patient_id: pid, nome: t.name || '', install_date: t.installDate || null, removal_date: t.removalDate || null, kind: t.kind === 'procedimento' ? 'procedimento' : 'device', ordem: i });
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
      (b.condutas || []).forEach(function (c, i) {
        out.condutas.push({ id: c.id || uuid(), patient_id: pid, texto: c.text || '', done: !!c.done, data: null, ordem: i });
      });
      out.notes.push({ patient_id: pid, texto: b.notes || '' });
      (b.rawTexts || []).forEach(function (r) {
        out.raw_texts.push({ id: r.id || uuid(), patient_id: pid, tipo: r.tipo || 'evolucao', data: r.data || null, texto: r.texto || '' });
      });
      // Gravadas por upsert em (patient_id, data) — nunca delete+insert. Linha sem data não vai.
      (b.evolucoes || []).forEach(function (e) {
        if (!e || !e.data) return;
        const row = evolucaoRow(e);
        row.id = row.id || uuid();
        row.patient_id = pid;
        out.evolucoes.push(row);
      });
    });
    return out;
  }

  // Adoção integral dos campos corridos (paciente novo no aparelho / pull limpo).
  function applyPatientScalars(bed, p, notesTexto) {
    PATIENT_SCALAR_FIELDS.forEach(function (f) { f.set(bed, p, notesTexto); });
  }

  // Adoção integral (paciente novo no aparelho / pull limpo). Na mescla de um leito
  // que já existe, quem decide campo a campo é o três-vias em mergeStates.
  function applyPatientTextFields(bed, p) {
    PATIENT_TEXT_FIELDS.forEach(function (f) { bed[f.local] = p[f.col] || ''; });
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
        return { ord: r.ordem, t: { id: r.id, type: 'device', kind: r.kind === 'procedimento' ? 'procedimento' : 'device', name: r.nome || '', installDate: r.install_date || '', removalDate: r.removal_date || '' } };
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

    // Pela coluna "ordem"; sem ordem vai para o fim, na sequência em que chegou.
    bed.condutas = (rows.condutas || [])
      .map(function (r, i) { return { ord: r.ordem == null ? 1000000 + i : r.ordem, r: r }; })
      .sort(function (a, b) { return a.ord - b.ord; })
      .map(function (m) { return { id: m.r.id, text: m.r.texto || '', done: !!m.r.done }; });
    bed.rawTexts = (rows.raw_texts || []).map(function (r) { return { id: r.id, tipo: r.tipo, data: r.data || '', texto: r.texto || '' }; });
    bed.generatedDocs = (rows.generated_docs || []).slice()
      .sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); })
      .map(function (r) { return { id: r.id, tipo: r.tipo, conteudo: r.conteudo, createdAt: r.created_at }; });
    bed.evolucoes = (rows.evolucoes || []).map(evolucaoRow)
      .sort(function (a, b) { return String(a.data || '').localeCompare(String(b.data || '')); });
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
      docs = byPatient(pulled.generated_docs), evolucoes = byPatient(pulled.evolucoes);

    state.cloudArchived = state.cloudArchived || {};

    // Pull limpo: o banco é a verdade também para as preferências globais.
    const pulledPref = (pulled.prefs || []).find(function (r) { return r.key === 'lab_ranges'; });
    if (pulledPref) state.labRangesText = pulledPref.value;

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
      // Guardado na nuvem: não vira leito (a leitura nem traz os filhos dele) e o nome
      // completo que este aparelho guarda no registro fica como está.
      if (p.status === 'nuvem') { keepInCloudRegistry(state, p, bed); return; }
      if (!bed) {
        // paciente criado direto no banco (raro): cria leito com iniciais como nome provisório
        bed = migrateBed({ patientName: p.initials || '?', bedNumber: p.bed_number || '' });
        bed.initialsPlaceholder = p.initials || '';
        bed.patientId = p.id;
        state.beds.push(bed);
      } else {
        syncNamePlaceholder(bed, p.initials);
      }
      applyPatientScalars(bed, p, (notes[p.id] && notes[p.id][0] && notes[p.id][0].texto) || '');
      applyPatientTextFields(bed, p);
      applyRowsToBed(bed, {
        problems: problems[p.id] || [], antibiotics: atbs[p.id] || [], cultures: cultures[p.id] || [],
        devices: devices[p.id] || [], exams: exams[p.id] || [], condutas: condutas[p.id] || [],
        raw_texts: rawTexts[p.id] || [], generated_docs: docs[p.id] || [],
        evolucoes: evolucoes[p.id] || [],
      });
    });

    // Registro da nuvem: sai quem sumiu do banco. Nunca com leitura vazia (anômala) — os
    // nomes guardados ali não existem em nenhum outro lugar.
    if ((pulled.patients || []).length) {
      Object.keys(state.cloudArchived).forEach(function (id) {
        if (!pulledIds[id]) delete state.cloudArchived[id];
      });
    }

    // Verdade do banco após este pull: usado no próximo pull para detectar deleções remotas.
    state.syncedPatientIds = Object.keys(pulledIds);
    return state;
  }

  // ---- Sincronizar: enviar só o que mudou, numa gravação só ---------------------------

  // Filhas com identidade por id. Antes o push apagava e reinseria TODAS as linhas de TODOS
  // os pacientes a cada Sincronizar; agora vai só a diferença para o que acabou de ser lido.
  const PUSH_CHILD_TABLES = ['problems', 'antibiotics', 'cultures', 'devices', 'exams', 'condutas', 'raw_texts'];
  // Chave de cada tabela do diff (as demais: id). A evolução é o DIA, não o id.
  const PUSH_ROW_KEY = {
    notes: function (r) { return String(r.patient_id); },
    prefs: function (r) { return String(r.key); },
    evolucoes: function (r) { return j(r.patient_id, r.data); },
  };
  // Colunas enviadas que não entram na comparação (o banco fica com a dele).
  const PUSH_ROW_IGNORE = { evolucoes: ['id'] };
  function pushRowKey(t) { return PUSH_ROW_KEY[t] || function (r) { return String(r.id); }; }

  // Valor enviado x valor guardado. Nulo só é igual a nulo ('' é outra coisa: o banco é
  // corrigido uma vez). Número compara como número: o aparelho pode guardar "7" onde o
  // banco devolve 7.
  function sameValue(sent, stored) {
    if (sent == null || stored == null) return sent == null && stored == null;
    if (typeof sent === 'number' || typeof stored === 'number') {
      return sent !== '' && stored !== '' && Number(sent) === Number(stored);
    }
    return String(sent) === String(stored);
  }
  // Primeira coluna ENVIADA que difere da linha guardada (null = igual). Colunas que só o
  // banco tem (updated_at) não contam.
  function differingColumn(sent, stored, ignore) {
    const keys = Object.keys(sent);
    for (let i = 0; i < keys.length; i++) {
      if (ignore && ignore.indexOf(keys[i]) !== -1) continue;
      if (!sameValue(sent[keys[i]], stored[keys[i]])) return keys[i];
    }
    return null;
  }
  // Linhas enviadas que o banco não tem, ou tem diferentes.
  function changedRows(t, sentRows, storedRows) {
    const keyOf = pushRowKey(t);
    const stored = {};
    (storedRows || []).forEach(function (r) { stored[keyOf(r)] = r; });
    return (sentRows || []).filter(function (row) {
      const cur = stored[keyOf(row)];
      return !cur || differingColumn(row, cur, PUSH_ROW_IGNORE[t]) !== null;
    });
  }
  function isLabRow(r) { return r.tipo === 'lab'; }
  function isNotLabRow(r) { return r.tipo !== 'lab'; }
  function labRowKey(r) { return j(r.patient_id, r.data, r.nome, r.resultado); }

  // O que falta gravar para o banco (pulled = o que acabou de ser lido) ficar igual ao
  // aparelho (payload = buildPushPayload):
  //   upsert[tabela]    linhas novas ou com alguma coluna diferente, inteiras
  //   remove[tabela]    ids de linhas-filhas que o banco tem e o aparelho não
  //   deletePatientIds  pacientes apagados no aparelho (o banco apaga os filhos em cascata)
  // Só mexe em filhos de paciente que o aparelho tem: paciente na nuvem, ou que não é
  // leito aqui, fica intocado. Paciente só é apagado por tombstone. Evolução nunca é
  // removida. Linha criada no banco DEPOIS da leitura não está em pulled, então não entra
  // em remove — o push antigo (apaga tudo e reinsere) a apagava.
  // Exame de laboratório: a identidade é data + nome + valor (como na mescla), não o id.
  // Linha igual fica como está no banco, com o id que já tem; valor corrigido = remove a
  // antiga + insere a nova. Antes todos os labs ganhavam id novo a cada push.
  function buildPushDiff(payload, pulled) {
    pulled = pulled || {};
    const diff = { deletePatientIds: (payload.deletePatientIds || []).slice(), upsert: {}, remove: {} };
    const owned = {};
    (payload.patients || []).forEach(function (p) { owned[p.id] = true; });

    diff.upsert.patients = changedRows('patients', payload.patients, pulled.patients);

    PUSH_CHILD_TABLES.forEach(function (t) {
      let sent = payload[t] || [];
      let stored = pulled[t] || [];
      const upsert = [], remove = [];
      if (t === 'exams') {
        const pool = {};
        stored.filter(isLabRow).forEach(function (r) {
          if (owned[r.patient_id]) (pool[labRowKey(r)] = pool[labRowKey(r)] || []).push(r);
        });
        sent.filter(isLabRow).forEach(function (row) {
          const same = pool[labRowKey(row)];
          if (same && same.length) same.shift(); else upsert.push(row);
        });
        Object.keys(pool).forEach(function (k) { pool[k].forEach(function (r) { remove.push(r.id); }); });
        sent = sent.filter(isNotLabRow);
        stored = stored.filter(isNotLabRow);
      }
      const sentIds = {};
      sent.forEach(function (row) { sentIds[row.id] = true; });
      changedRows(t, sent, stored).forEach(function (row) { upsert.push(row); });
      stored.forEach(function (r) { if (owned[r.patient_id] && !sentIds[r.id]) remove.push(r.id); });
      diff.upsert[t] = upsert;
      diff.remove[t] = remove;
    });

    ['notes', 'evolucoes', 'prefs'].forEach(function (t) {
      diff.upsert[t] = changedRows(t, payload[t], pulled[t]);
    });
    return diff;
  }

  // Quantas operações o diff carrega (0 = nada a gravar: nem chama o banco).
  function pushDiffSize(diff) {
    let n = (diff.deletePatientIds || []).length;
    Object.keys(diff.upsert || {}).forEach(function (t) { n += diff.upsert[t].length; });
    Object.keys(diff.remove || {}).forEach(function (t) { n += diff.remove[t].length; });
    return n;
  }

  // Confere o que o banco devolveu (as linhas como ficaram gravadas) com o que foi
  // enviado. A foto da sincronização é tirada do APARELHO; se o banco tivesse guardado
  // outra coisa, a mescla seguinte leria a diferença como "editado no banco" e trocaria o
  // dado do aparelho pelo errado. Lança com tabela.coluna; quem chama desfaz tudo.
  function verifyPush(diff, stored) {
    stored = stored || {};
    Object.keys(diff.upsert || {}).forEach(function (t) {
      const keyOf = pushRowKey(t);
      const got = {};
      (stored[t] || []).forEach(function (r) { got[keyOf(r)] = r; });
      diff.upsert[t].forEach(function (row) {
        const cur = got[keyOf(row)];
        const col = cur ? differingColumn(row, cur, PUSH_ROW_IGNORE[t]) : '';
        if (col !== null) {
          throw new Error('a gravação não conferiu com o banco (' + t + (col ? '.' + col : '') +
            '); este aparelho ficou como estava');
        }
      });
    });
  }

  // O Sincronizar inteiro: lê tudo (uma chamada, uma foto só do banco), mescla e grava só
  // a diferença (uma chamada, tudo ou nada).
  //   db.pull()      → Promise<{ patients: [], problems: [], ... }>
  //   db.push(diff)  → Promise<{ tabela: [linhas como ficaram gravadas] }>
  // As duas rejeitam em falha. Se QUALQUER coisa falhar depois da leitura, o estado volta
  // a ser exatamente o de antes (mescla desfeita, foto antiga): como a gravação é tudo ou
  // nada, o banco está como foi lido — ou inteiro como o aparelho pediu, se só a resposta
  // se perdeu —, e nos dois casos a próxima sincronização fecha certo com a foto antiga.
  // Antes, uma falha no meio deixava o banco pela metade e a foto era zerada: a
  // sincronização seguinte virava união e as linhas apagadas no aparelho voltavam.
  // Resolve com { sent }: quantas operações foram enviadas.
  async function runSync(state, db, opts) {
    // Ids antes de tudo, e fora do que é desfeito: se a gravação aconteceu e só a
    // resposta se perdeu, a nova tentativa tem de usar os mesmos ids.
    ensurePatientIds(state);
    ensureRowIds(state);
    const pulled = await db.pull();
    if (!pulled || !Array.isArray(pulled.patients)) throw new Error('resposta inesperada do banco na leitura');
    const backup = JSON.stringify(state);
    try {
      mergeStates(state, pulled);
      const newBase = buildSyncBase(state);
      // Pelo JSON, como vai pela rede: o que é comparado é o que o banco recebe.
      const payload = JSON.parse(JSON.stringify(buildPushPayload(state)));
      const diff = buildPushDiff(payload, pulled);
      const sent = pushDiffSize(diff);
      if (sent) verifyPush(diff, await db.push(diff));

      state.syncBase = newBase;
      const synced = {};
      (state.syncedPatientIds || []).forEach(function (id) { synced[id] = true; });
      payload.patients.forEach(function (p) { synced[p.id] = true; });
      diff.deletePatientIds.forEach(function (id) { delete synced[id]; });
      state.syncedPatientIds = Object.keys(synced);
      state.deletedPatientIds = [];
      state.lastSyncAt = (opts && opts.now) || new Date().toISOString();
      return { sent: sent };
    } catch (e) {
      const prev = JSON.parse(backup);
      Object.keys(state).forEach(function (k) { delete state[k]; });
      Object.assign(state, prev);
      throw e;
    }
  }

  return {
    uuid: uuid,
    initialsFromName: initialsFromName,
    knownPatientName: knownPatientName,
    bedInitials: bedInitials,
    parseHpp: parseHpp,
    joinHpp: joinHpp,
    fillPatientName: fillPatientName,
    filterSuggestions: filterSuggestions,
    dayNumber: dayNumber,
    formatDateBR: formatDateBR,
    estadoDoSync: estadoDoSync,
    progressoDoDia: progressoDoDia,
    fraseProgresso: fraseProgresso,
    fraseArquivados: fraseArquivados,
    statusAltaPrevista: statusAltaPrevista,
    estadoDoLeito: estadoDoLeito,
    selosDoCartao: selosDoCartao,
    acoesDoRegistro: acoesDoRegistro,
    chipAdmissao: chipAdmissao,
    buildPendencias: buildPendencias,
    agruparPendencias: agruparPendencias,
    LIMIARES: LIMIARES,
    labNumber: labNumber,
    buildLabsLine: buildLabsLine,
    tendenciasLab: tendenciasLab,
    buildDailySummary: buildDailySummary,
    DEFAULT_LAB_RANGES_TEXT: DEFAULT_LAB_RANGES_TEXT,
    parseLabRanges: parseLabRanges,
    classifyLab: classifyLab,
    parseLabText: parseLabText,
    applyLabEntry: applyLabEntry,
    pinnedExamIndex: pinnedExamIndex,
    sortExamNames: sortExamNames,
    togglePinnedExam: togglePinnedExam,
    movePinnedExam: movePinnedExam,
    atbBadge: atbBadge,
    seloControle: seloControle,
    linhaControle: linhaControle,
    fimPrevistoAtb: fimPrevistoAtb,
    resumoSecao: resumoSecao,
    GENDOC_LABEL: GENDOC_LABEL,
    showsQuedaCheck: showsQuedaCheck,
    DAILY_CHECKS: DAILY_CHECKS,
    defaultState: defaultState,
    migrateBed: migrateBed,
    buildReadmission: buildReadmission,
    personAdmissions: personAdmissions,
    previousAdmissions: previousAdmissions,
    groupArchived: groupArchived,
    groupCloudArchived: groupCloudArchived,
    migrateState: migrateState,
    buildPushPayload: buildPushPayload,
    applyPull: applyPull,
    buildPushDiff: buildPushDiff,
    pushDiffSize: pushDiffSize,
    verifyPush: verifyPush,
    runSync: runSync,
    markPatientDeleted: markPatientDeleted,
    resetLocalSync: resetLocalSync,
    hash8: hash8,
    buildSyncBase: buildSyncBase,
    mergeRowSets: mergeRowSets,
    mergeStates: mergeStates,
    EVOLUCAO_FIELDS: EVOLUCAO_FIELDS,
    newEvolucaoForToday: newEvolucaoForToday,
    parseDocBlocks: parseDocBlocks,
  };
});
