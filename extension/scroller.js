// Katch - Scroller Invisível

let currentScrollY = 0;
let maxScroll = 0;
let originalOverflow = '';
let originalFixedElements = [];

// Escuta comandos do Background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'PREPARE_AND_CAPTURE') {
        preparePage();
        takeChunk(false);
    } else if (request.action === 'SCROLL_NEXT') {
        scrollNext();
    } else if (request.action === 'RESTORE_PAGE') {
        restorePage();
    }
});

function preparePage() {
    // Salva o scroll original pra voltar depois
    currentScrollY = window.scrollY;

    // Força o scroll pro topo
    window.scrollTo(0, 0);

    // Esconde a barra de rolagem chata
    originalOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    // (Opcional) Poderíamos tentar esconder barras com position:fixed pra não repetir, 
    // mas pra manter simples e amplo, focamos nos mais básicos.
    const allElements = document.querySelectorAll('*');
    allElements.forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.position === 'fixed' || style.position === 'sticky') {
            originalFixedElements.push({ element: el, visibility: el.style.visibility });
            el.style.visibility = 'hidden';
        }
    });

    maxScroll = Math.max(
        document.body.scrollHeight, document.documentElement.scrollHeight,
        document.body.offsetHeight, document.documentElement.offsetHeight,
        document.body.clientHeight, document.documentElement.clientHeight
    );
}

function restorePage() {
    // Volta a barra e os elementos fixos
    document.documentElement.style.overflow = originalOverflow;

    originalFixedElements.forEach(item => {
        item.element.style.visibility = item.visibility;
    });

    // Volta o usuário pro lugar onde ele estava
    window.scrollTo(0, currentScrollY);
}

function getDocHeight() {
    return Math.max(
        document.body.scrollHeight, document.documentElement.scrollHeight,
        document.body.offsetHeight, document.documentElement.offsetHeight,
        document.body.clientHeight, document.documentElement.clientHeight
    );
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function takeChunk(isLast) {
    let progress = 100;

    // Recalcula maxScroll caso a página tenha feito lazy loading
    maxScroll = getDocHeight();

    if (!isLast && maxScroll > 0) {
        const viewHeight = window.innerHeight;
        const currentY = window.scrollY;
        progress = Math.min(Math.round(((currentY + viewHeight) / maxScroll) * 100), 99);
    }

    chrome.runtime.sendMessage({
        action: 'CAPTURE_VISIBLE_CHUNK',
        isDone: isLast,
        progress: progress
    });
}

async function scrollNext() {
    const viewHeight = window.innerHeight;
    const currentY = window.scrollY;

    // Recalcula maxScroll ao rolar para lidar com Infinite Scrolls simples
    maxScroll = getDocHeight();

    if (currentY + viewHeight >= maxScroll) {
        // Já chegamos no fim
        takeChunk(true);
    } else {
        // Rola exato o tamanho de uma tela (um pouco menos para ajudar na costura e evitar cortes secos)
        const scrollAmount = viewHeight;
        window.scrollBy(0, scrollAmount);

        // Aguarda a página renderizar fisicamente as novas imagens (Lazy loaders)
        await sleep(300);

        // Se a próxima rolagem já bater ou passar do fim, marcamos como a última
        const newY = window.scrollY;
        maxScroll = getDocHeight();

        // Se a posição Y não mudou entre os scrolls, é porque chegamos no limite real do DOM
        const reachedEnd = (newY + viewHeight >= maxScroll) || (newY === currentY);

        takeChunk(reachedEnd);
    }
}
