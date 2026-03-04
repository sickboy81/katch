// ==========================================
// KATCH BACKGROUND - DOWNLOADS AUTOMATIZADOS
// ==========================================

let serverUrl = "https://katch.onrender.com";

// Carrega o servidor configurado
chrome.storage.local.get(['serverUrl'], (data) => {
    if (data.serverUrl) serverUrl = data.serverUrl;
});

// Escuta mensagens do script de conteúdo (botões injetados)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "download_video") {
        console.log("🧲 Katch Background: Iniciando download remoto para:", request.url);

        fetch(`${serverUrl}/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: request.url })
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    chrome.downloads.download({
                        url: serverUrl + data.downloadUrl,
                        filename: 'katch_auto_' + Date.now() + '.mp4'
                    });
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false, error: data.error });
                }
            })
            .catch(err => {
                console.error("Erro no download automático:", err);
                sendResponse({ success: false, error: err.message });
            });

        return true; // Mantém o canal aberto para resposta assíncrona
    }
});

// ==========================================
// KATCH FULL PAGE SCREENSHOT
// ==========================================
let capturedSnapshots = [];
let captureTabId = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Retorna os snapshots para a página de preview
    if (request.action === 'GET_SNAPSHOTS') {
        sendResponse({ snapshots: capturedSnapshots });
        return true;
    }

    if (request.action === 'CLEAR_SNAPSHOTS') {
        capturedSnapshots = [];
        sendResponse({ success: true });
        return true;
    }

    // Download delegado pela preview page (garante extensão e nome correto)
    if (request.action === 'DOWNLOAD_FILE') {
        chrome.downloads.download({
            url: request.dataUrl,
            filename: request.filename
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error('Erro no download:', chrome.runtime.lastError.message);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true, downloadId });
            }
        });
        return true;
    }

    // Inicia a orquestração do Print
    if (request.action === 'START_FULL_CAPTURE') {
        captureTabId = request.tabId;
        capturedSnapshots = [];

        // Injeta o script de scroll na aba ativa
        chrome.scripting.executeScript({
            target: { tabId: captureTabId },
            files: ['scroller.js']
        }, () => {
            // Em seguida envia o comando pra ele preparar a tela (esconder scrollbars)
            chrome.tabs.sendMessage(captureTabId, { action: 'PREPARE_AND_CAPTURE' });
            sendResponse({ status: 'started' });
        });
        return true;
    }

    // O scroller.js parou o scroll, podemos tirar o print
    if (request.action === 'CAPTURE_VISIBLE_CHUNK') {
        if (request.progress !== undefined) {
            chrome.runtime.sendMessage({ action: 'UPDATE_PROGRESS', progress: request.progress }).catch(() => { });
        }

        // Delay de 150ms para as imagens da tela serem "pintadas" pelo navegador antes do print.
        setTimeout(() => {
            chrome.tabs.captureVisibleTab(null, { format: 'png', quality: 100 }, (dataUrl) => {
                if (chrome.runtime.lastError) {
                    console.error("Erro na captura de tela: ", chrome.runtime.lastError.message);

                    // Em caso de erro tenta novamente rolar
                    if (!request.isDone) {
                        chrome.tabs.sendMessage(captureTabId, { action: 'SCROLL_NEXT' }).catch(() => { });
                    }
                    return;
                }

                if (dataUrl) {
                    capturedSnapshots.push(dataUrl);
                }

                if (request.isDone) {
                    chrome.tabs.sendMessage(captureTabId, { action: 'RESTORE_PAGE' }).catch(() => { });
                    chrome.tabs.create({ url: chrome.runtime.getURL('preview.html') });
                } else {
                    chrome.tabs.sendMessage(captureTabId, { action: 'SCROLL_NEXT' }).catch(() => { });
                }
            });
        }, 150);
        return true;
    }
});
