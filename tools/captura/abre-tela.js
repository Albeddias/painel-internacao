/* Injetado no fim da página capturada (tools/captura/capturar.cjs). Lê location.hash e
 * abre a tela pedida. `state`, openPatientDetails, openTrackerModal e showScreen são
 * globais do script do app. Telas:
 *   lista | arquivados | tarefas | paciente:N | paciente:N:aberto | modal:controle | aviso | menu
 *   lista:check (marca o primeiro check) | lista:edicao (edita um problema: "alterações a enviar")
 *   lista:vazia (sem leitos) | lista:filtro (busca sem resultado)
 * Sufixo ":medir" em qualquer tela: etiqueta amarela com a altura do cabeçalho fixo da
 * tela ativa e a largura da janela. */
(function () {
  var partes = decodeURIComponent(location.hash.replace(/^#/, '')).split(':');
  var medir = partes[partes.length - 1] === 'medir';
  if (medir) partes.pop();
  var tela = partes[0] || 'lista';

  if (tela === 'arquivados') {
    setViewArchived(true);
  } else if (tela === 'tarefas') {
    document.getElementById('openTasksBtn').click();
  } else if (tela === 'paciente') {
    var n = Number(partes[1] || 0);
    if (partes[2] === 'aberto') {
      Object.keys(state.beds[n]).forEach(function (k) {
        if (/^is\w+Minimized$/.test(k)) state.beds[n][k] = false;
      });
    }
    openPatientDetails(n);
  } else if (tela === 'modal' && partes[1] === 'controle') {
    openPatientDetails(0);
    openTrackerModal(0);
  } else if (tela === 'lista' && partes[1] === 'check') {
    document.querySelector('#screen-list .dot').click();
  } else if (tela === 'lista' && partes[1] === 'vazia') {
    state.beds = [];
    renderScreenA();
  } else if (tela === 'lista' && partes[1] === 'filtro') {
    document.getElementById('searchInput').value = 'zzz';
    renderScreenA();
  } else if (tela === 'lista' && partes[1] === 'edicao') {
    state.beds[0].problems[0].descricao += ' x';
    saveData(state);
    renderScreenA();
  } else if (tela === 'menu') {
    openSheet('listMenuSheet');
  } else if (tela === 'aviso') {
    openPatientDetails(0);
    avisar('Não foi possível salvar neste aparelho: QuotaExceededError', { tom: 'perigo', fixo: true });
  }

  if (medir) {
    setTimeout(function () {
      var cab = document.querySelector('.screen.active header');
      var et = document.createElement('div');
      et.textContent = 'cab ' + (cab ? cab.offsetHeight : 0) + 'px · ' + window.innerWidth + 'w';
      et.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:99999;background:#fde047;color:#000;' +
        'font:bold 12px/1.2 monospace;padding:3px 6px;border:1px solid #000';
      document.body.appendChild(et);
    }, 300);
  }
})();
