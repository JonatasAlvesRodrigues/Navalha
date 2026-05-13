(function registerPwa() {
  const INSTALLED_KEY = 'navalha_pwa_installed';
  const installBtn = document.getElementById('installAppBtn');
  const installTip = document.getElementById('installAppTip');
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const wasInstalled = window.localStorage.getItem(INSTALLED_KEY) === '1';
  let deferredPrompt = null;

  function showInstallButton() {
    if (installBtn) installBtn.hidden = false;
  }

  function hideInstallButton() {
    if (installBtn) installBtn.hidden = true;
  }

  function showIosTip() {
    if (installTip) {
      installTip.hidden = false;
      installTip.textContent = 'No iPhone: Compartilhar > Adicionar à Tela de Início.';
    }
  }

  if (isStandalone || wasInstalled) {
    window.localStorage.setItem(INSTALLED_KEY, '1');
    hideInstallButton();
    if (installTip) installTip.hidden = true;
  } else if (isIos) {
    showInstallButton();
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    deferredPrompt = event;
    if (!window.localStorage.getItem(INSTALLED_KEY)) {
      showInstallButton();
    }
  });

  window.addEventListener('appinstalled', () => {
    window.localStorage.setItem(INSTALLED_KEY, '1');
    deferredPrompt = null;
    hideInstallButton();
    if (installTip) {
      installTip.hidden = false;
      installTip.textContent = 'App instalado com sucesso.';
    }
  });

  installBtn?.addEventListener('click', async () => {
    if (isIos && !deferredPrompt) {
      showIosTip();
      return;
    }
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome !== 'accepted' && installTip) {
      installTip.hidden = false;
      installTip.textContent = 'Instalação cancelada. Você pode tentar novamente quando quiser.';
    }
    deferredPrompt = null;
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        await navigator.serviceWorker.register('/sw.js?v=4');
      } catch (_err) {
        // noop
      }
    });
  }
})();

