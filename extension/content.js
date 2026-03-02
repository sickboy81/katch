// ==========================================
// KATCH CONTENT SCRIPT - INJEÇÃO DE BOTÕES
// ==========================================

console.log("🧲 Katch: Script de injeção carregado.");

// Função para criar o botão Katch estilizado
function createKatchButton(url) {
    const btn = document.createElement('button');
    btn.className = 'katch-injected-btn';
    btn.innerHTML = `<span>🧲 KATCH</span>`;
    btn.title = "Baixar com Katch";

    btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        btn.innerHTML = "⏳ Processando...";
        btn.disabled = true;

        // Envia mensagem para o background script ou abre o popup?
        // Na verdade, o mais fácil é a própria extensão capturar.
        // Mas vamos tentar enviar direto para o servidor se estiver disponível localmente
        // Ou simplesmente abrir o popup.

        // Melhor experiência: Enviar para o background realizar o download direto!
        chrome.runtime.sendMessage({ action: "download_video", url: url || window.location.href }, (response) => {
            if (response && response.success) {
                btn.innerHTML = "✅ Sucesso!";
            } else {
                btn.innerHTML = "❌ Erro";
            }
            setTimeout(() => {
                btn.innerHTML = "🧲 KATCH";
                btn.disabled = false;
            }, 3000);
        });
    };

    return btn;
}

// Injeção no YouTube (Debaixo do título ou perto dos botões de ação)
function injectYouTube() {
    // Tenta vários seletores comuns do YouTube que mudam frequentemente
    const targetSelectors = [
        '#top-level-buttons-computed',
        '#top-level-buttons',
        '.ytd-menu-renderer.style-scope.ytd-video-primary-info-renderer',
        'ytd-watch-metadata #actions'
    ];

    let target = null;
    for (const selector of targetSelectors) {
        target = document.querySelector(selector);
        if (target) break;
    }

    if (target && !document.querySelector('.katch-injected-btn')) {
        const btn = createKatchButton(window.location.href);
        // Insere no início ou fim do container de botões
        target.prepend(btn);
        console.log("🧲 Katch: Botão injetado no YouTube.");
    }
}

// Injeção no Instagram (Abaixo de cada Post na Feed ou Foto)
function injectInstagram() {
    // Procura por ícones de curtir/comentar para inserir ao lado
    const targets = document.querySelectorAll('section > span > button');
    targets.forEach(target => {
        const container = target.closest('section');
        if (container && !container.querySelector('.katch-injected-btn')) {
            // Tenta achar a URL do post
            const postLinkElement = container.closest('article').querySelector('a[href*="/p/"]');
            const url = postLinkElement ? `https://www.instagram.com${postLinkElement.getAttribute('href')}` : window.location.href;

            const btn = createKatchButton(url);
            btn.style.padding = "5px 10px";
            btn.style.fontSize = "10px";
            container.appendChild(btn);
        }
    });
}

// Injeção no Facebook
function injectFacebook() {
    // Procura botões de compartilhamento ou ações em posts
    const targets = document.querySelectorAll('[role="button"][aria-label*="Compartilhar"], [role="button"][aria-label*="Share"]');
    targets.forEach(target => {
        if (!target.parentNode.querySelector('.katch-injected-btn')) {
            const btn = createKatchButton(window.location.href);
            btn.style.scale = "0.8";
            target.parentNode.insertBefore(btn, target);
        }
    });
}

// Injeção no Tumblr
function injectTumblr() {
    const targets = document.querySelectorAll('.reblog_button, .like_button');
    targets.forEach(target => {
        const container = target.closest('.post_controls, .post-controls');
        if (container && !container.querySelector('.katch-injected-btn')) {
            const btn = createKatchButton(window.location.href);
            btn.style.scale = "0.6";
            btn.style.margin = "0";
            container.prepend(btn);
        }
    });
}

// Injeção no Pinterest
function injectPinterest() {
    const targets = document.querySelectorAll('[data-test-id="pin-action-bar"]');
    targets.forEach(target => {
        if (!target.querySelector('.katch-injected-btn')) {
            const btn = createKatchButton(window.location.href);
            btn.style.scale = "0.7";
            target.prepend(btn);
        }
    });
}

// Injeção no Vimeo
function injectVimeo() {
    // Vimeo interface sometimes has a share button or a control bar
    const targets = document.querySelectorAll('.vp-controls, .PlayerControls');
    targets.forEach(target => {
        if (!target.querySelector('.katch-injected-btn')) {
            const btn = createKatchButton(window.location.href);
            btn.style.scale = "0.6";
            btn.style.marginRight = "10px";
            btn.style.pointerEvents = "auto";
            target.prepend(btn);
        }
    });
}

// Observador para mudanças na página (Single Page Apps como YT e Insta)
const observer = new MutationObserver(() => {
    const url = window.location.href;
    if (url.includes('youtube.com/watch')) {
        injectYouTube();
    } else if (url.includes('instagram.com')) {
        injectInstagram();
    } else if (url.includes('facebook.com') || url.includes('fb.watch')) {
        injectFacebook();
    } else if (url.includes('tumblr.com')) {
        injectTumblr();
    } else if (url.includes('pinterest.com')) {
        injectPinterest();
    } else if (url.includes('vimeo.com')) {
        injectVimeo();
    }
});

// Escuta mensagens do popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'SCAN_BATCH_LINKS') {
        const links = new Set();
        const url = window.location.href;

        if (url.includes('youtube.com')) {
            // Seletor mais amplo para YouTube (Geralmente em canais e busca)
            const ytSelectors = [
                'a#video-title-link',
                'a#video-title',
                'a.ytd-thumbnail',
                'a.yt-simple-endpoint[href*="/watch?v="]',
                'ytd-grid-video-renderer a[href*="/watch?v="]',
                'ytd-rich-grid-media a[href*="/watch?v="]'
            ];

            ytSelectors.forEach(selector => {
                document.querySelectorAll(selector).forEach(a => {
                    if (a.href && a.href.includes('/watch?v=')) {
                        // Limpa o link de parâmetros extras como &t= ou &index=
                        const cleanUrl = a.href.split('&')[0];
                        links.add(cleanUrl);
                    }
                });
            });
        } else if (url.includes('instagram.com')) {
            // Links de posts/reels no Insta
            document.querySelectorAll('a[href*="/p/"], a[href*="/reels/"], a[href*="/reel/"]').forEach(a => {
                if (a.href) {
                    const cleanHref = a.href.split('?')[0];
                    links.add(cleanHref);
                }
            });
        } else if (url.includes('tiktok.com')) {
            // Links de vídeos no perfil do TikTok
            document.querySelectorAll('a[href*="/video/"]').forEach(a => {
                if (a.href) links.add(a.href.split('?')[0]);
            });
        }

        sendResponse({ links: Array.from(links) });
    }
});

observer.observe(document.body, { childList: true, subtree: true });
