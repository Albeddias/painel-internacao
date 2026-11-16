// Banco de mentira para testar o Sincronizar (PainelCore.runSync) sem rede.
// Imita as duas funções do banco (supabase/migrations/010_painel_sync_rpc.sql):
//   pull()      = painel_sync_pull: tudo de uma vez; filhos de paciente 'nuvem' não vêm.
//   push(diff)  = painel_sync_push: tudo ou nada; grava só as colunas enviadas e devolve
//                 as linhas como ficaram gravadas.
const CHILD = ['problems', 'antibiotics', 'cultures', 'devices', 'exams', 'condutas', 'raw_texts'];
const ALL = ['patients'].concat(CHILD, ['evolucoes', 'notes', 'generated_docs', 'prefs']);
// Chave de conflito de cada tabela no upsert (as demais: id).
const CONFLICT = { notes: ['patient_id'], prefs: ['key'], evolucoes: ['patient_id', 'data'] };
// Colunas que o upsert não troca numa linha que já existe.
const KEEP = { evolucoes: ['id'] };
const UPSERT_ORDER = ['patients'].concat(CHILD, ['notes', 'evolucoes', 'prefs']);

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function createFakeDb(seed) {
  const db = {
    tables: {},
    pulls: 0,
    pushes: [],          // diffs recebidos (já como chegariam pela rede)
    failPull: null,      // mensagem → pull() rejeita
    failPush: null,      // mensagem → push() rejeita SEM gravar nada
    loseResponse: false, // true → push() grava tudo e rejeita (a resposta se perdeu)
    beforePush: null,    // fn(db): outra escrita (a IA) entre o pull e o push deste aparelho
    tamper: null,        // fn(stored): banco que guarda diferente do que recebeu
  };
  ALL.forEach(function (t) { db.tables[t] = clone((seed && seed[t]) || []); });

  db.pull = async function () {
    db.pulls++;
    if (db.failPull) throw new Error(db.failPull);
    const nuvem = {};
    db.tables.patients.forEach(function (p) { if (p.status === 'nuvem') nuvem[p.id] = true; });
    const out = {};
    ALL.forEach(function (t) {
      out[t] = clone(db.tables[t]).filter(function (r) {
        return t === 'patients' || t === 'prefs' || !nuvem[r.patient_id];
      });
      const pk = t === 'notes' ? 'patient_id' : (t === 'prefs' ? 'key' : 'id');
      out[t].sort(function (a, b) { return String(a[pk]).localeCompare(String(b[pk])); });
    });
    return out;
  };

  db.push = async function (diffSent) {
    const diff = clone(diffSent);
    db.pushes.push(diff);
    if (db.beforePush) db.beforePush(db);
    if (db.failPush) throw new Error(db.failPush);

    const work = clone(db.tables); // "transação": só vale se chegar ao fim
    const gone = {};
    (diff.deletePatientIds || []).forEach(function (id) { gone[id] = true; });
    work.patients = work.patients.filter(function (p) { return !gone[p.id]; });
    ALL.forEach(function (t) {
      if (t === 'patients' || t === 'prefs') return;
      work[t] = work[t].filter(function (r) { return !gone[r.patient_id]; }); // on delete cascade
    });
    CHILD.forEach(function (t) {
      const ids = {};
      ((diff.remove || {})[t] || []).forEach(function (id) { ids[id] = true; });
      work[t] = work[t].filter(function (r) { return !ids[r.id]; });
    });

    const stored = {};
    UPSERT_ORDER.forEach(function (t) {
      const rows = (diff.upsert || {})[t] || [];
      if (!rows.length) return;
      const conflict = CONFLICT[t] || ['id'];
      const keep = KEEP[t] || [];
      stored[t] = rows.map(function (row) {
        if (t !== 'patients' && t !== 'prefs' && !work.patients.some(function (p) { return p.id === row.patient_id; })) {
          throw new Error('violates foreign key constraint (' + t + ')');
        }
        let cur = work[t].find(function (r) { return conflict.every(function (c) { return r[c] === row[c]; }); });
        if (cur) {
          Object.keys(row).forEach(function (k) { if (keep.indexOf(k) === -1) cur[k] = row[k]; });
        } else {
          if (t !== 'notes' && t !== 'prefs' && work[t].some(function (r) { return r.id === row.id; })) {
            throw new Error('duplicate key value violates unique constraint (' + t + ')');
          }
          cur = Object.assign({}, row);
          work[t].push(cur);
        }
        return clone(cur);
      });
    });

    db.tables = work; // commit
    if (db.tamper) db.tamper(stored);
    if (db.loseResponse) throw new Error('rede caiu');
    return stored;
  };

  return db;
}

module.exports = { createFakeDb: createFakeDb, clone: clone, CHILD: CHILD };
