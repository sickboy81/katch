// ==========================================
// CORE LOGICA DO KATCH DOWNLOADER
// ==========================================

// Global state variables
let SERVER_URL = "https://katch.onrender.com";

// DOM Elements
const tabs = document.querySelectorAll('.tab');
const sections = document.querySelectorAll('.section-content');
const globalStatus = document.getElementById('globalStatus');

// Form & Buttons
const btnAutoDownload = document.getElementById('btnAutoDownload');
const btnFullCapture = document.getElementById('btnFullCapture');
const btnManualDownload = document.getElementById('btnManualDownload');
const manualUrlInput = document.getElementById('manualUrl');

// History & Config
const historyList = document.getElementById('historyList');
const btnClearHistory = document.getElementById('btnClearHistory');
const chkSubs = document.getElementById('chkSubs');
const chkGifMode = document.getElementById('chkGifMode');
const chkSmartNaming = document.getElementById('chkSmartNaming');
const configServerUrl = document.getElementById('configServerUrl');
const btnSaveConfig = document.getElementById('btnSaveConfig');

// Lote (Batch)
const btnScanBatch = document.getElementById('btnScanBatch');
const batchResults = document.getElementById('batchResults');
const batchCount = document.getElementById('batchCount');
const btnDownloadBatch = document.getElementById('btnDownloadBatch');
const batchLinksScroll = document.getElementById('batchLinksScroll');
const batchFilter = document.getElementById('batchFilter');
let scannedLinks = [];
let filteredLinks = [];

// Extras
const chkAudioOnly = document.getElementById('chkAudioOnly');
const chkCopyLink = document.getElementById('chkCopyLink');
const chkShowQR = document.getElementById('chkShowQR');
const resSelect = document.getElementById('resSelect');

// QR
const qrContainer = document.getElementById('qrContainer');
const qrImage = document.getElementById('qrImage');
const btnCloseQR = document.getElementById('btnCloseQR');

// Shortcuts
const shortcutIcons = document.querySelectorAll('.shortcut-icon');

// Progress
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');

// Preview
const mediaPreview = document.getElementById('mediaPreview');
const previewImg = document.getElementById('previewImg');
const previewVideo = document.getElementById('previewVideo');
const previewTitle = document.getElementById('previewTitle');

// Themes
const themeSelect = document.getElementById('themeSelect');

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  // Carregar configurações locais
  const data = await chrome.storage.local.get(['serverUrl', 'downloadHistory', 'appTheme', 'totalDownloads']);

  if (data.appTheme) {
    document.body.className = `theme-${data.appTheme}`;
    themeSelect.value = data.appTheme;
  }

  if (data.serverUrl) {
    SERVER_URL = data.serverUrl; // sobrescreve só se tiver salvo manualmente no passado
  }

  renderHistory(data.downloadHistory || []);

  const total = data.totalDownloads || 0;
  const spanTotal = document.getElementById('txtTotalDownloads');
  if (spanTotal) spanTotal.textContent = `(${total} Salvo${total !== 1 ? 's' : ''})`;

  // Esconde ícone se falhar em carregar a imagem gerada
  document.getElementById('brandIcon').onerror = function () {
    this.style.display = 'none';
  };

  // --- NOVA FUNÇÃO: DETECÇÃO DE ÁREA DE TRANSFERÊNCIA ---
  // Se o usuário abrir o popup e tiver um link de vídeo no CTRL+C, já preenchemos
  try {
    const text = await navigator.clipboard.readText();
    const validSites = ['youtube.com', 'youtu.be', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com', 'reddit.com', 'facebook.com', 'fb.watch', 'tumblr.com', 'pinterest.com', 'pin.it', 'vimeo.com'];
    if (validSites.some(site => text.includes(site))) {
      manualUrlInput.value = text.trim();
      setStatus("Link detectado na Área de Transferência! ✨", "success");
      setTimeout(hideStatus, 2000);
    }
  } catch (e) {
    console.log("Permissão de clipboard negada ou indisponível.");
  }
  // ---------------------------------------------------

  // Setup shortcuts
  shortcutIcons.forEach(icon => {
    icon.addEventListener('click', () => {
      const url = icon.getAttribute('data-url');
      chrome.tabs.create({ url });
    });
  });

  // Theme Change
  themeSelect.addEventListener('change', async () => {
    const newTheme = themeSelect.value;
    document.body.className = `theme-${newTheme}`;
    await chrome.storage.local.set({ appTheme: newTheme });
  });

  // Close QR Modal
  btnCloseQR.addEventListener('click', () => {
    qrContainer.style.display = 'none';
  });
});

// ==========================================
// TAB NAVIGATION
// ==========================================
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    // Remover classes ATIVE de todos
    tabs.forEach(t => t.classList.remove('active'));
    sections.forEach(s => s.classList.remove('active'));

    // Adicionar active no clicado
    tab.classList.add('active');
    const targetId = tab.getAttribute('data-target');
    document.getElementById(targetId).classList.add('active');

    hideStatus();
  });
});

// ==========================================
// UI HELPERS
// ==========================================
function setStatus(message, type) {
  globalStatus.style.display = "block";
  globalStatus.textContent = message;
  globalStatus.className = `status-box status-${type}`; // types: loading, success, error

  if (type === 'loading') {
    progressContainer.style.display = 'block';
  } else {
    setTimeout(() => {
      if (!globalStatus.className.includes('loading')) {
        progressContainer.style.display = 'none';
      }
    }, 500);
  }
}

function hideStatus() {
  globalStatus.style.display = "none";
  progressContainer.style.display = 'none';
}

function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon128.png',
    title: title,
    message: message,
    priority: 2
  });
}

function toggleButtons(disabled) {
  btnAutoDownload.disabled = disabled;
  btnManualDownload.disabled = disabled;
  if (btnFullCapture) btnFullCapture.disabled = disabled;

  // Animação UX
  if (disabled) {
    btnAutoDownload.innerHTML = "⏳ Processando...";
    btnManualDownload.innerHTML = "⏳ Processando...";
  } else {
    btnAutoDownload.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Capturar Mídia Única`;
    btnManualDownload.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 8 12 12 16 14"></polyline></svg> Processar Link`;
    if (btnFullCapture) btnFullCapture.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> Gerar Print Completo`;
  }
}

// ==========================================
// HISTORY MANAGMENT
// ==========================================
async function saveToHistory(url, success, thumbUrl) {
  if (!success) return;

  let { downloadHistory, totalDownloads } = await chrome.storage.local.get(['downloadHistory', 'totalDownloads']);
  downloadHistory = downloadHistory || [];
  totalDownloads = (totalDownloads || 0) + 1;

  downloadHistory.unshift({
    url: url,
    thumb: thumbUrl || 'icon128.png',
    date: new Date().toLocaleString()
  });

  // Guardar apenas os 10 últimos
  if (downloadHistory.length > 10) downloadHistory.pop();

  await chrome.storage.local.set({ downloadHistory, totalDownloads });
  renderHistory(downloadHistory);

  const spanTotal = document.getElementById('txtTotalDownloads');
  if (spanTotal) spanTotal.textContent = `(${totalDownloads} Salvo${totalDownloads > 1 ? 's' : ''})`;
}

function renderHistory(historyArray) {
  historyList.innerHTML = '';
  if (!historyArray || historyArray.length === 0) {
    historyList.innerHTML = '<div class="empty-history">Nenhum vídeo capturado ainda.</div>';
    return;
  }

  historyArray.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
        <img src="${item.thumb}" onerror="this.src='icon128.png'" alt="Thumb" loading="lazy">
        <div class="history-content">
            <a href="${item.url}" target="_blank" class="url" title="${item.url}">${item.url}</a>
            <div class="date">${item.date}</div>
        </div>
    `;
    historyList.appendChild(div);
  });
}

btnClearHistory.addEventListener('click', async () => {
  await chrome.storage.local.set({ downloadHistory: [] });
  renderHistory([]);
  setStatus("Histórico limpo.", "success");
  setTimeout(hideStatus, 2000);
});

// ==========================================
// CONFIGURATION
// ==========================================
btnSaveConfig.addEventListener('click', async () => {
  const newUrl = configServerUrl.value.trim();
  if (newUrl) {
    // Remover a barra do final, se houver
    const cleanUrl = newUrl.replace(/\/+$/, "");
    SERVER_URL = cleanUrl;
    await chrome.storage.local.set({ serverUrl: SERVER_URL });
    setStatus("Configuração salva na nuvem da extensão!", "success");
  } else {
    setStatus("Preencha a URL", "error");
  }
  setTimeout(hideStatus, 3000);
});

// ==========================================
// CORE DOWNLOAD LOGIC
// ==========================================
async function triggerDownload(videoUrl) {
  toggleButtons(true);
  setStatus("Conectando ao servidor Katch...", "loading");

  // Limpa preview anterior
  mediaPreview.style.display = 'none';

  // Simular progresso visual enquanto servidor trabalha
  let progress = 0;
  progressBar.style.width = "0%";
  const progressInterval = setInterval(() => {
    progress += (100 - progress) * 0.1; // Curva de progresso desacelerando
    progressBar.style.width = `${progress}%`;
    if (progress > 95) clearInterval(progressInterval);
  }, 1000);

  const isAudioOnly = chkAudioOnly.checked;
  const isCopyLink = chkCopyLink.checked;
  const isShowQR = chkShowQR.checked;

  try {
    const response = await fetch(`${SERVER_URL}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: videoUrl,
        audioOnly: isAudioOnly,
        justLink: isCopyLink,
        resolution: resSelect.value,
        subs: chkSubs.checked,
        gifMode: chkGifMode.checked
      })
    });

    const data = await response.json();

    if (data.success && data.downloadUrl) {
      const finalUrl = data.directLink || (SERVER_URL + data.downloadUrl);
      const isSmart = chkSmartNaming.checked;
      const cleanTitle = data.title ? data.title.replace(/[\\/*?:"<>|]/g, "") : 'katch_media';

      // ... download logic ...
      if (isShowQR) {
        qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(finalUrl)}`;
        qrContainer.style.display = 'flex';
      }

      if (isCopyLink) {
        await navigator.clipboard.writeText(finalUrl);
        setStatus("Link Copiado para a Área de Transferência!", "success");
      } else {
        setStatus("Pesca com Sucesso! 🎣 Baixando...", "success");

        let fileExt = '.mp4';
        if (chkGifMode.checked) fileExt = '.gif';
        else if (data.downloadUrl.includes('.jpg')) fileExt = '.jpg';
        else if (data.downloadUrl.includes('.png')) fileExt = '.png';

        const timestamp = Date.now();
        const baseName = isSmart ? cleanTitle : 'katch_media_' + timestamp;

        chrome.downloads.download({
          url: SERVER_URL + data.downloadUrl,
          filename: baseName + fileExt
        }, (id) => {
          showNotification('Katch: Sucesso!', `Download de "${data.title || 'Mídia'}" concluído.`);
        });
      }

      // Mostra preview final
      mediaPreview.style.display = 'flex';
      previewTitle.textContent = videoUrl; // Poderia vir do servidor

      // Tentar pegar uma miniatura real, ou favicon da plataforma
      let thumbUrl = await getThumbnail(videoUrl);

      const isVideoResponse = data.downloadUrl.toLowerCase().includes('.mp4');

      if (isVideoResponse) {
        previewImg.style.display = 'none';
        previewVideo.style.display = 'block';
        previewVideo.src = SERVER_URL + data.downloadUrl;
      } else {
        previewVideo.style.display = 'none';
        previewImg.style.display = 'block';
        previewImg.src = SERVER_URL + data.downloadUrl;
        thumbUrl = SERVER_URL + data.downloadUrl; // A própria imagem vira a thumb no histórico
      }

      saveToHistory(videoUrl, true, thumbUrl);
    } else {
      throw new Error(data.error || "Servidor não conseguiu extrair a mídia.");
    }
  } catch (err) {
    setStatus("Erro: " + err.message, "error");
    console.error("Katch Erro:", err);
  } finally {
    clearInterval(progressInterval);
    progressBar.style.width = "100%";
    toggleButtons(false);
  }
}

// ==========================================
// BATCH DOWNLOAD LOGIC
// ==========================================
btnScanBatch.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || tab.url.startsWith('chrome://')) {
      throw new Error("Página indetectável.");
    }

    setStatus("Escaneando mídias na página...", "loading");

    chrome.tabs.sendMessage(tab.id, { action: 'SCAN_BATCH_LINKS' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.links || response.links.length === 0) {
        setStatus("Nenhum link novo encontrado. Role a página para carregar mais vídeos e tente de novo.", "error");
        batchResults.style.display = 'none';
        return;
      }

      scannedLinks = response.links;
      filteredLinks = [...scannedLinks];
      renderBatchList();

      batchResults.style.display = 'block';
      setStatus(`Sucesso! ${scannedLinks.length} mídias encontradas.`, "success");
      setTimeout(hideStatus, 2000);
    });
  } catch (err) {
    setStatus(err.message, "error");
  }
});

function renderBatchList() {
  batchCount.textContent = `${filteredLinks.length} links filtrados`;
  batchLinksScroll.innerHTML = filteredLinks.map(l => `<div style="font-size: 10px; color: #ccc; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${l}</div>`).join('');
}

batchFilter.addEventListener('input', () => {
  const val = batchFilter.value.toLowerCase();
  filteredLinks = scannedLinks.filter(l => l.toLowerCase().includes(val));
  renderBatchList();
});

btnDownloadBatch.addEventListener('click', async () => {
  if (filteredLinks.length === 0) return;

  if (!confirm(`Deseja iniciar o download em lote de ${filteredLinks.length} arquivos?`)) return;

  btnDownloadBatch.disabled = true;
  let successCount = 0;

  for (let i = 0; i < filteredLinks.length; i++) {
    const link = filteredLinks[i];
    const progress = Math.round(((i + 1) / filteredLinks.length) * 100);

    setStatus(`Lote: ${i + 1}/${filteredLinks.length}`, "loading");
    progressBar.style.width = `${progress}%`;

    try {
      const res = await fetch(`${SERVER_URL}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: link,
          audioOnly: chkAudioOnly.checked,
          justLink: chkCopyLink.checked,
          resolution: resSelect.value,
          subs: chkSubs.checked,
          gifMode: chkGifMode.checked
        })
      });

      const data = await res.json();
      if (data.success && data.downloadUrl) {
        const isSmart = chkSmartNaming.checked;
        const cleanTitle = data.title ? data.title.replace(/[\\/*?:"<>|]/g, "") : 'batch_item';
        let fileExt = '.mp4';
        if (chkGifMode.checked) fileExt = '.gif';

        chrome.downloads.download({
          url: SERVER_URL + data.downloadUrl,
          filename: (isSmart ? cleanTitle : 'katch_batch_' + Date.now()) + fileExt
        });
        successCount++;
      }
    } catch (e) { console.warn(e); }
  }

  showNotification('Katch: Lote Concluído', `${successCount} arquivos foram processados com sucesso.`);
  setStatus(`Lote finalizado! ${successCount} baixados.`, "success");
  btnDownloadBatch.disabled = false;
  setTimeout(hideStatus, 5000);
});

// Handler para Aba Ativa (AUTO)
btnAutoDownload.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || tab.url.startsWith('chrome://')) {
      throw new Error("Página indetectável. Teste na janela do vídeo.");
    }
    triggerDownload(tab.url);
  } catch (err) {
    setStatus(err.message, "error");
  }
});

// Handler para Full Page Capture
if (btnFullCapture) {
  btnFullCapture.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url || tab.url.startsWith('chrome://')) {
        throw new Error("Não é possível capturar esta página do sistema.");
      }

      toggleButtons(true);
      if (btnFullCapture) btnFullCapture.innerHTML = "⏳ Capturando Tela...";
      setStatus("Iniciando captura de rolagem...", "loading");

      chrome.runtime.sendMessage({ action: 'START_FULL_CAPTURE', tabId: tab.id }, (response) => {
        if (chrome.runtime.lastError) {
          setStatus("Erro ao iniciar captura: " + chrome.runtime.lastError.message, "error");
          toggleButtons(false);
          if (btnFullCapture) btnFullCapture.innerHTML = "📸 Tentar Novamente";
        } else {
          // Exibe a barra de progresso do zero
          globalStatus.style.display = 'block';
          progressContainer.style.display = 'block';
          progressBar.style.width = '0%';
          setStatus("Escaneando a página... 0%", "loading");
        }
      });
    } catch (err) {
      setStatus(err.message, "error");
      toggleButtons(false);
    }
  });
}

// Handler para Loop Manual (MANUAL)
btnManualDownload.addEventListener('click', () => {
  const manualLink = manualUrlInput.value.trim();
  if (!manualLink) {
    setStatus("Por favor, cole um link antes.", "error");
    return;
  }
  triggerDownload(manualLink);
});

// Helper para descobrir Thumbnails
async function getThumbnail(url) {
  try {
    // 1. YouTube cover
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const match = url.match(/(?:\?v=|\/embed\/|\.be\/)([^&\n?#]+)/);
      if (match && match[1]) return `https://img.youtube.com/vi/${match[1]}/default.jpg`;
    }

    // 2. Tiktok cover placeholder via api ou genérico
    if (url.includes('tiktok.com')) return 'https://www.google.com/s2/favicons?domain=tiktok.com&sz=128';

    // 3. Fallback: Tenta um fetch simples (pode falhar por CORS) ou retorna favicon
    const res = await fetch(url, { method: 'HEAD' }).catch(() => null);

    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  } catch (e) {
    return 'icon128.png';
  }
}
