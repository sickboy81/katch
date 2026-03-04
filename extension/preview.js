// ==================================================
// KATCH PREVIEW - Versão 3.0 (File System Access API)
// ==================================================

let finalCanvas = null;
let cropperInstance = null;

const MAX_CANVAS_HEIGHT = 10000;

document.addEventListener('DOMContentLoaded', () => {
    const btnDownload = document.getElementById('btnDownload');
    const btnDownloadPdf = document.getElementById('btnDownloadPdf');
    const btnCropStart = document.getElementById('btnCropStart');
    const btnCropConfirm = document.getElementById('btnCropConfirm');
    const btnCropCancel = document.getElementById('btnCropCancel');
    const dividerActions = document.getElementById('dividerActions');
    const resultImage = document.getElementById('resultImage');

    // 1. Busca os snapshots
    chrome.runtime.sendMessage({ action: 'GET_SNAPSHOTS' }, async (response) => {
        if (response && response.snapshots && response.snapshots.length > 0) {
            await stitchImages(response.snapshots);
        } else {
            document.getElementById('loading').innerHTML = "Nenhuma captura encontrada. Tente novamente.";
        }
    });

    // 2. SALVAR PNG - Usa chrome.downloads para download direto (sem forçar diálogo)
    btnDownload.addEventListener('click', async () => {
        if (!finalCanvas) return;
        btnDownload.disabled = true;
        btnDownload.textContent = '⏳ Salvando...';

        try {
            // Usamos blob para não estourar limite de string da URL
            const blob = await canvasToBlob(finalCanvas, 'image/png');
            const blobUrl = URL.createObjectURL(blob);

            chrome.downloads.download({
                url: blobUrl,
                filename: 'katch_screenshot_' + Date.now() + '.png',
                saveAs: false // Deixa o navegador decidir se mostra aviso ou salva direto
            }, () => {
                // Limpa o blob após o download iniciar
                setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
            });

        } catch (e) {
            console.error('Erro ao salvar PNG:', e);
            alert('Erro ao salvar imagem: ' + e.message);
        } finally {
            btnDownload.disabled = false;
            btnDownload.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Salvar Imagem`;
        }
    });

    // 3. SALVAR PDF - múltiplas páginas A4 + chrome.downloads
    btnDownloadPdf.addEventListener('click', async () => {
        if (!finalCanvas) return;
        btnDownloadPdf.disabled = true;
        btnDownloadPdf.textContent = '⏳ Gerando PDF...';

        try {
            const { jsPDF } = window.jspdf;

            // Usa A4
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();

            const imgWidth = pageWidth;
            const imgHeight = (finalCanvas.height * pageWidth) / finalCanvas.width;

            const dataUrl = finalCanvas.toDataURL('image/jpeg', 0.92);

            let heightLeft = imgHeight;
            let position = 0;
            let page = 0;

            while (heightLeft > 0) {
                if (page > 0) pdf.addPage();
                pdf.addImage(dataUrl, 'JPEG', 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;
                position -= pageHeight;
                page++;
            }

            const pdfBlob = pdf.output('blob');
            const blobUrl = URL.createObjectURL(pdfBlob);

            chrome.downloads.download({
                url: blobUrl,
                filename: 'katch_screenshot_' + Date.now() + '.pdf',
                saveAs: false
            }, () => {
                setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
            });

        } catch (e) {
            console.error('Erro ao salvar PDF:', e);
            alert('Erro ao salvar PDF: ' + e.message);
        } finally {
            btnDownloadPdf.disabled = false;
            btnDownloadPdf.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> Salvar PDF`;
        }
    });

    // 4. RECORTAR
    btnCropStart.addEventListener('click', () => {
        toggleCropUI(true);
        cropperInstance = new Cropper(resultImage, { viewMode: 1, autoCropArea: 0.8 });
    });

    btnCropCancel.addEventListener('click', () => {
        if (cropperInstance) cropperInstance.destroy();
        toggleCropUI(false);
    });

    btnCropConfirm.addEventListener('click', () => {
        if (cropperInstance) {
            const canvas = cropperInstance.getCroppedCanvas();
            if (canvas) updateImage(canvas);
            cropperInstance.destroy();
        }
        toggleCropUI(false);
    });

    function toggleCropUI(isCropping) {
        btnCropStart.style.display = isCropping ? 'none' : 'flex';
        btnDownload.style.display = isCropping ? 'none' : 'flex';
        btnDownloadPdf.style.display = isCropping ? 'none' : 'flex';
        btnCropConfirm.style.display = isCropping ? 'flex' : 'none';
        btnCropCancel.style.display = isCropping ? 'flex' : 'none';
        dividerActions.style.display = isCropping ? 'block' : 'none';
    }
});

// Converte canvas para Blob de forma assíncrona
function canvasToBlob(canvas, type) {
    return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), type);
    });
}

async function stitchImages(snapshots) {
    const images = [];
    for (const src of snapshots) {
        images.push(await loadImage(src));
    }

    let width = images[0].width;
    let totalHeight = images.reduce((sum, img) => sum + img.height, 0);

    let scale = 1;
    if (totalHeight > MAX_CANVAS_HEIGHT) {
        scale = MAX_CANVAS_HEIGHT / totalHeight;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(totalHeight * scale);
    const ctx = canvas.getContext('2d');

    let currentY = 0;
    for (const img of images) {
        ctx.drawImage(img, 0, Math.round(currentY * scale), Math.round(width * scale), Math.round(img.height * scale));
        currentY += img.height;
    }

    updateImage(canvas);
}

function updateImage(canvas) {
    finalCanvas = canvas;

    canvas.toBlob((blob) => {
        if (!blob) {
            alert("Erro ao processar imagem.");
            return;
        }
        const url = URL.createObjectURL(blob);
        document.getElementById('resultImage').src = url;

        document.getElementById('loading').style.display = 'none';
        document.getElementById('previewContainer').style.display = 'block';
        document.getElementById('btnCropStart').style.display = 'flex';
        document.getElementById('btnDownload').style.display = 'flex';
        document.getElementById('btnDownloadPdf').style.display = 'flex';
    }, 'image/png');
}

function loadImage(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = src;
    });
}
