/* Injetado no fim da página capturada (tools/captura/capturar.cjs). Lê location.hash e
 * abre a tela pedida. `state`, openPatientDetails, openTrackerModal e showScreen são
 * globais do script do app. Telas:
 *   lista | arquivados | tarefas | paciente:N | paciente:N:aberto | modal:controle
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
