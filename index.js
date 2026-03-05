const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const youtubedl = require('youtube-dl-exec');
const cheerio = require('cheerio');
const getTwitterMedia = require('get-twitter-media');
const { getPreview } = require('spotify-url-info')(fetch);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Servir a landing page (onde a extensão pode ser baixada)
app.use(express.static(path.join(__dirname, 'public')));

// Pasta temporária para downloads
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir);
}

app.use('/downloads', express.static(downloadsDir));

// Função ajudante para baixar o arquivo mp4 bruto de um link direto da web
async function downloadFromDirectLink(videoUrl, outputPath) {
    const writer = fs.createWriteStream(outputPath);
    const response = await axios({
        url: videoUrl,
        method: 'GET',
        responseType: 'stream',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/110.0.0.0 Safari/537.36',
            'Referer': videoUrl
        }
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

app.post('/download', async (req, res) => {
    const { url, audioOnly, justLink } = req.body;

    if (!url) {
        return res.status(400).json({ success: false, error: 'URL do vídeo é obrigatória.' });
    }

    try {
        console.log(`\n[+] Processando link: ${url}`);

        const timestamp = Date.now();
        let outputPath = '';
        let finalFilename = '';

        // 1. YOUTUBE
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            console.log("  -> Link detectado: YouTube");

            finalFilename = `youtube_${timestamp}${audioOnly ? '_audio.mp4' : '.mp4'}`;
            outputPath = path.join(downloadsDir, finalFilename);

            try {
                // TENTATIVA 1: yt-dlp com cookies do Chrome (funciona localmente)
                let info;
                try {
                    info = await youtubedl(url, {
                        dumpJson: true,
                        noCheckCertificates: true,
                        noWarnings: true,
                        cookiesFromBrowser: 'chrome',
                        f: audioOnly
                            ? 'bestaudio[ext=m4a]/bestaudio'
                            : 'best[ext=mp4]/best'
                    });
                } catch (cookieErr) {
                    console.log('  -> Cookies do Chrome falharam, tentando sem cookies...');
                    // TENTATIVA 2: yt-dlp com player_client alternativo (pode funcionar em servidores)
                    try {
                        info = await youtubedl(url, {
                            dumpJson: true,
                            noCheckCertificates: true,
                            noWarnings: true,
                            extractorArgs: 'youtube:player_client=mediaconnect',
                            f: audioOnly
                                ? 'bestaudio[ext=m4a]/bestaudio'
                                : 'best[ext=mp4]/best'
                        });
                    } catch (ytErr) {
                        console.log('  -> yt-dlp falhou completamente, tentando Piped API...');
                        // TENTATIVA 3: Piped API (proxy open-source do YouTube, sem cookies)
                        // Extrai o ID do vídeo da URL
                        let videoId = null;
                        const idMatch = url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
                        if (idMatch) videoId = idMatch[1];

                        if (!videoId) throw new Error('Não foi possível extrair o ID do vídeo.');

                        const pipedApis = [
                            'https://pipedapi.kavin.rocks',
                            'https://pipedapi.adminforge.de',
                            'https://pipedapi.in.projectsegfau.lt'
                        ];

                        let pipedSuccess = false;
                        for (const apiBase of pipedApis) {
                            try {
                                const pipedRes = await axios.get(`${apiBase}/streams/${videoId}`, { timeout: 10000 });
                                const data = pipedRes.data;
                                let streamUrl = null;

                                if (audioOnly && data.audioStreams && data.audioStreams.length > 0) {
                                    // Pega o áudio com maior bitrate
                                    const best = data.audioStreams.sort((a, b) => b.bitrate - a.bitrate)[0];
                                    streamUrl = best.url;
                                } else if (data.videoStreams && data.videoStreams.length > 0) {
                                    // Pega o melhor vídeo mp4
                                    const mp4s = data.videoStreams.filter(s => s.mimeType && s.mimeType.includes('video/mp4') && s.videoOnly === false);
                                    if (mp4s.length > 0) {
                                        streamUrl = mp4s.sort((a, b) => b.bitrate - a.bitrate)[0].url;
                                    } else {
                                        streamUrl = data.videoStreams.sort((a, b) => b.bitrate - a.bitrate)[0].url;
                                    }
                                }

                                if (streamUrl) {
                                    await downloadFromDirectLink(streamUrl, outputPath);
                                    console.log(`  -> Sucesso (Piped): ${finalFilename}`);
                                    return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}`, title: data.title || '' });
                                }
                            } catch (pipedErr) {
                                console.log(`  -> Piped ${apiBase} falhou, tentando próximo...`);
                            }
                        }
                        throw new Error('Todas as tentativas falharam para este vídeo do YouTube.');
                    }
                }

                // Pega a URL do melhor formato disponível
                let directUrl = info.url;
                if (!directUrl && info.formats && info.formats.length > 0) {
                    const mp4 = info.formats.slice().reverse().find(f => f.ext === 'mp4' && f.url);
                    directUrl = (mp4 || info.formats[info.formats.length - 1]).url;
                }

                if (!directUrl) throw new Error('URL de vídeo não encontrada.');

                await downloadFromDirectLink(directUrl, outputPath);

                console.log(`  -> Sucesso (yt-dlp URL): ${finalFilename}`);
                return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}`, title: info.title || '' });
            } catch (err) {
                console.error(err);
                return res.status(500).json({ success: false, error: 'Falha YouTube: ' + err.message });
            }
        }

        // 2. INSTAGRAM
        else if (url.includes('instagram.com')) {
            console.log("  -> Link detectado: Instagram");
            finalFilename = `instagram_${timestamp}.mp4`;
            outputPath = path.join(downloadsDir, finalFilename);

            try {
                const info = await youtubedl(url, {
                    dumpJson: true,
                    noCheckCertificates: true,
                    noWarnings: true
                });

                let directUrl = info.url || (info.formats && info.formats.length > 0 ? info.formats[info.formats.length - 1].url : null);

                if (!directUrl) {
                    throw new Error("Mídia não extraída da API do yt-dlp.");
                }

                let isImage = false;
                if (directUrl.includes('.jpg') || directUrl.includes('.webp') || directUrl.includes('.png')) {
                    isImage = true;
                }

                finalFilename = `instagram_${timestamp}${isImage ? '.jpg' : '.mp4'}`;
                outputPath = path.join(downloadsDir, finalFilename);

                if (justLink) {
                    return res.json({ success: true, downloadUrl: directUrl, directLink: directUrl });
                }

                await downloadFromDirectLink(directUrl, outputPath);
                console.log(`  -> Sucesso: ${finalFilename}`);
                return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}`, title: info.title || '' });

            } catch (e) {
                console.error(e);
                return res.status(500).json({ success: false, error: 'O link do Instagram é privado ou mudou de formato. Use vídeos públicos.' });
            }
        }

        // 3. SPOTIFY
        else if (url.includes('spotify.com')) {
            console.log("  -> Link detectado: Spotify");
            try {
                // Obter dados da música (Artista e Título)
                const metadata = await getPreview(url);
                const query = `${metadata.artist} - ${metadata.title}`;
                console.log(`     Buscando no YouTube: ${query}`);

                finalFilename = `spotify_${timestamp}_${metadata.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.mp3`;
                outputPath = path.join(downloadsDir, finalFilename);

                // Pesquisa 1 resultado no Youtube e baixa como MP3
                // Tenta com cookies do Chrome, senão com player_client alternativo
                try {
                    await youtubedl(`ytsearch1:${query}`, {
                        noCheckCertificates: true,
                        noWarnings: true,
                        cookiesFromBrowser: 'chrome',
                        extractAudio: true,
                        audioFormat: 'mp3',
                        output: outputPath
                    });
                } catch (cookieErr) {
                    console.log('  -> Cookies falharam para Spotify, tentando sem cookies...');
                    await youtubedl(`ytsearch1:${query}`, {
                        noCheckCertificates: true,
                        noWarnings: true,
                        extractorArgs: 'youtube:player_client=mediaconnect',
                        extractAudio: true,
                        audioFormat: 'mp3',
                        output: outputPath
                    });
                }

                console.log(`  -> Sucesso (Spotify/YT): ${finalFilename}`);
                return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}`, title: query });

            } catch (err) {
                console.error(err);
                return res.status(500).json({ success: false, error: 'Falha Spotify: ' + err.message });
            }
        }

        // 3. X / TWITTER
        else if (url.includes('twitter.com') || url.includes('x.com')) {
            console.log("  -> Link detectado: X/Twitter");
            finalFilename = `twitter_${timestamp}.mp4`;
            outputPath = path.join(downloadsDir, finalFilename);

            // getTwitterMedia retorna um objeto com propriedades .media
            const tweetData = await getTwitterMedia(url, { text: true });

            let videoUrlToDownload = null;
            if (tweetData && tweetData.media && tweetData.media.length > 0) {
                // Get the video with highest bitrate/quality or just the first video URL
                const mediaVideos = tweetData.media.filter(m => m.type === 'video');
                if (mediaVideos.length > 0) {
                    videoUrlToDownload = mediaVideos[0].url;
                } else if (tweetData.media[0].url) {
                    videoUrlToDownload = tweetData.media[0].url;
                }
            }

            if (!videoUrlToDownload) {
                return res.status(404).json({ success: false, error: 'Nenhuma mídia extraída desse Tweet.' });
            }

            const isImage = videoUrlToDownload.includes('.jpg') || videoUrlToDownload.includes('.png');
            finalFilename = `twitter_${timestamp}${isImage ? '.jpg' : '.mp4'}`;
            outputPath = path.join(downloadsDir, finalFilename);

            // Se o usuário só quer o link, interrompe e devolve a URL externa extraida
            if (justLink) {
                return res.json({ success: true, downloadUrl: videoUrlToDownload, directLink: videoUrlToDownload });
            }

            await downloadFromDirectLink(videoUrlToDownload, outputPath);
            console.log(`  -> Sucesso: ${finalFilename}`);
            return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}` });
        }

        // 4. TIKTOK (Sem marca d'água via API Gratuita e pública TikWM)
        else if (url.includes('tiktok.com')) {
            console.log("  -> Link detectado: TikTok");
            finalFilename = `tiktok_${timestamp}.mp4`;
            outputPath = path.join(downloadsDir, finalFilename);

            // Using the TikWM public unauthenticated API structure
            const response = await axios.post('https://www.tikwm.com/api/', { url: url }, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }
            });

            let downloadLink = null;
            let isImage = false;

            if (response.data && response.data.data) {
                if (response.data.data.play) {
                    downloadLink = response.data.data.play;
                } else if (response.data.data.images && response.data.data.images.length > 0) {
                    downloadLink = response.data.data.images[0];
                    isImage = true;
                }
            }

            if (!downloadLink) {
                return res.status(500).json({ success: false, error: 'Falha ao buscar mídia no TikTok. Pode ser conta privada ou formato inválido.' });
            }

            finalFilename = `tiktok_${timestamp}${isImage ? '.jpg' : '.mp4'}`;
            outputPath = path.join(downloadsDir, finalFilename);

            if (justLink) {
                return res.json({ success: true, downloadUrl: downloadLink, directLink: downloadLink });
            }

            await downloadFromDirectLink(downloadLink, outputPath);
            console.log(`  -> Sucesso: ${finalFilename}`);
            return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}` });

        }

        // 5. REDDIT
        else if (url.includes('reddit.com')) {
            console.log("  -> Link detectado: Reddit");
            finalFilename = `reddit_${timestamp}.mp4`;
            outputPath = path.join(downloadsDir, finalFilename);

            const cleanRedditUrl = url.split('?')[0].replace(/\/$/, '') + '.json';
            const response = await axios.get(cleanRedditUrl);
            const postData = response.data[0]?.data?.children[0]?.data;
            let mediaUrl = postData?.secure_media?.reddit_video?.fallback_url || postData?.media?.reddit_video?.fallback_url;
            let isImage = false;

            if (!mediaUrl) {
                mediaUrl = postData?.url_overridden_by_dest || postData?.url;
                if (mediaUrl && (mediaUrl.includes('.jpg') || mediaUrl.includes('.png') || mediaUrl.includes('.gif'))) {
                    isImage = true;
                } else {
                    mediaUrl = null;
                }
            }

            if (!mediaUrl) {
                return res.status(404).json({ success: false, error: 'Mídia do Reddit não encontrada.' });
            }

            finalFilename = `reddit_${timestamp}${isImage ? '.jpg' : '.mp4'}`;
            outputPath = path.join(downloadsDir, finalFilename);

            if (justLink) {
                return res.json({ success: true, downloadUrl: mediaUrl, directLink: mediaUrl });
            }

            await downloadFromDirectLink(mediaUrl, outputPath);
            console.log(`  -> Sucesso: ${finalFilename}`);
            return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}` });
        }

        // 6. FACEBOOK
        else if (url.includes('facebook.com') || url.includes('fb.watch')) {
            console.log("  -> Link detectado: Facebook");
            finalFilename = `fb_${timestamp}.mp4`;
            outputPath = path.join(downloadsDir, finalFilename);

            const { data: html } = await axios.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });

            // Regex basicas para extrair URLs de vídeo do FB (SD/HD)
            const hdMatch = html.match(/hd_src:"([^"]+)"/);
            const sdMatch = html.match(/sd_src:"([^"]+)"/);
            let mediaUrl = hdMatch ? hdMatch[1] : (sdMatch ? sdMatch[1] : null);
            let isImage = false;

            if (!mediaUrl) {
                const imgMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
                if (imgMatch) {
                    mediaUrl = imgMatch[1].replace(/\\/g, '');
                    isImage = true;
                }
            }

            if (!mediaUrl) {
                return res.status(404).json({ success: false, error: 'Não foi possível encontrar a mídia neste link do Facebook. Pode ser privada ou o link expirou.' });
            }

            finalFilename = `fb_${timestamp}${isImage ? '.jpg' : '.mp4'}`;
            outputPath = path.join(downloadsDir, finalFilename);

            if (justLink) {
                return res.json({ success: true, downloadUrl: mediaUrl, directLink: mediaUrl });
            }

            await downloadFromDirectLink(mediaUrl, outputPath);
            console.log(`  -> Sucesso: ${finalFilename}`);
            return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}` });
        }

        // 7. TUMBLR
        else if (url.includes('tumblr.com')) {
            console.log("  -> Link detectado: Tumblr");
            finalFilename = `tumblr_${timestamp}.mp4`;
            outputPath = path.join(downloadsDir, finalFilename);

            const { data: html } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });

            // Procura por meta og:video ou src do vídeo
            const videoMatch = html.match(/<meta property="og:video" content="([^"]+)"/) || html.match(/source src="([^"]+)"/);
            let mediaUrl = videoMatch ? videoMatch[1] : null;
            let isImage = false;

            if (!mediaUrl) {
                const imgMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
                if (imgMatch) {
                    mediaUrl = imgMatch[1];
                    isImage = true;
                }
            }

            if (!mediaUrl) {
                return res.status(404).json({ success: false, error: 'Mídia do Tumblr não encontrada.' });
            }

            finalFilename = `tumblr_${timestamp}${isImage ? '.jpg' : '.mp4'}`;
            outputPath = path.join(downloadsDir, finalFilename);

            if (justLink) {
                return res.json({ success: true, downloadUrl: mediaUrl, directLink: mediaUrl });
            }

            await downloadFromDirectLink(mediaUrl, outputPath);
            console.log(`  -> Sucesso: ${finalFilename}`);
            return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}` });
        }

        // 8. PINTEREST
        else if (url.includes('pinterest.com') || url.includes('pin.it')) {
            console.log("  -> Link detectado: Pinterest");
            finalFilename = `pinterest_${timestamp}.mp4`;
            outputPath = path.join(downloadsDir, finalFilename);

            // Fetch the page
            const { data: html } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });

            // Procura a URL do vídeo de alta qualidade dentro da tag do Pinterest ou og:video
            let mediaUrl = null;
            let isImage = false;

            const videoMatch = html.match(/"contentUrl":"([^"]+)"/);
            if (videoMatch) {
                mediaUrl = videoMatch[1].replace(/\\/g, '');
            } else {
                const alternateMatch = html.match(/<meta property="v:url" content="([^"]+)"/);
                if (alternateMatch) mediaUrl = alternateMatch[1];
            }

            // Converter final se for M3U8 para MP4 caso haja um link MP4 disponível?
            // Pinterest geralmente coloca VODs diretos.
            // Para m3u8 não funcionará apenas via fs.createWriteStream, mas assumimos vídeos nativos .mp4

            if (!mediaUrl || mediaUrl.includes('.m3u8')) {
                // Tenta puxar MP4 da estrutura de dados do pin
                const mp4Match = html.match(/https:\/\/[^"]+\.mp4/);
                if (mp4Match) mediaUrl = mp4Match[0].replace(/\\/g, '');
            }

            // Fallback to image
            if (!mediaUrl) {
                const imgMatch = html.match(/<meta property="og:image" name="og:image" content="([^"]+)"/) || html.match(/<meta property="og:image" content="([^"]+)"/) || html.match(/<meta name="og:image" content="([^"]+)"/);
                if (imgMatch) {
                    mediaUrl = imgMatch[1];
                    isImage = true;
                }
            }

            if (!mediaUrl) {
                return res.status(404).json({ success: false, error: 'Mídia do Pinterest não encontrada.' });
            }

            finalFilename = `pinterest_${timestamp}${isImage ? '.jpg' : '.mp4'}`;
            outputPath = path.join(downloadsDir, finalFilename);

            if (justLink) {
                return res.json({ success: true, downloadUrl: mediaUrl, directLink: mediaUrl });
            }

            await downloadFromDirectLink(mediaUrl, outputPath);
            console.log(`  -> Sucesso: ${finalFilename}`);
            return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}` });
        }

        // 9. VIMEO
        else if (url.includes('vimeo.com')) {
            console.log("  -> Link detectado: Vimeo");
            finalFilename = `vimeo_${timestamp}.mp4`;
            outputPath = path.join(downloadsDir, finalFilename);

            const { data: html } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });

            // Vimeo guarda as URLs do MP4 no configUrl ou num objeto JSON direto no HTML (window.vimeo.clip_page_config)
            const configMatch = html.match(/(https:\/\/player\.vimeo\.com\/video\/[0-9]+\/config[^"]+)/);
            let videoUrl = null;

            if (configMatch) {
                const configUrl = configMatch[1].replace(/\\/g, '').replace(/&amp;/g, '&');
                const { data: configData } = await axios.get(configUrl);

                const progressiveVideos = configData?.request?.files?.progressive;
                if (progressiveVideos && progressiveVideos.length > 0) {
                    // Pega o de melhor qualidade
                    const bestVideo = progressiveVideos.reduce((prev, current) => (+prev.width > +current.width) ? prev : current);
                    videoUrl = bestVideo.url;
                }
            } else {
                // Alternativa via metatag ou json
                const mp4Match = html.match(/"url":"(https:\/\/[^"]+\.mp4[^"]*)"/);
                if (mp4Match) {
                    videoUrl = mp4Match[1].replace(/\\/g, '');
                }
            }

            if (!videoUrl) {
                return res.status(404).json({ success: false, error: 'Vídeo do Vimeo não encontrado ou é protegido.' });
            }

            if (justLink) {
                return res.json({ success: true, downloadUrl: videoUrl, directLink: videoUrl });
            }

            await downloadFromDirectLink(videoUrl, outputPath);
            console.log(`  -> Sucesso: ${finalFilename}`);
            return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}` });
        }

        else {
            return res.status(400).json({ success: false, error: 'Plataforma não suportada. Use Youtube, Instagram, X, TikTok, Reddit, Facebook, Tumblr, Pinterest ou Vimeo.' });
        }

    } catch (err) {
        console.error("- Erro inesperado:", err.message);
        return res.status(500).json({ success: false, error: 'Erro interno ao processar: ' + err.message });
    }
});

app.listen(PORT, () => {
    console.log(`========================================================`);
    console.log(`🎬 Servidor de Download iniciado na porta: ${PORT}`);
    console.log(`✅ Suporte a: YouTube, Instagram, X, TikTok, Reddit, FB, Tumblr, Pinterest e Vimeo!`);
    console.log(`========================================================`);
});
