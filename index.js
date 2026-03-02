const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const ytdl = require('@distube/ytdl-core');
const instagramGetUrl = require('instagram-url-direct');
const getTwitterMedia = require('get-twitter-media');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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

            // No caso do YouTube os links diretos expiram com IP, por isso o justLink não faz sentido
            // Nós sempre devemos baixar e servir
            finalFilename = `youtube_${timestamp}${audioOnly ? '_audio.mp4' : '.mp4'}`;
            outputPath = path.join(downloadsDir, finalFilename);

            const filterType = audioOnly ? 'audioonly' : 'audioandvideo';
            const stream = ytdl(url, { quality: 'highest', filter: filterType });
            stream.pipe(fs.createWriteStream(outputPath));

            return new Promise((resolve) => {
                stream.on('finish', () => {
                    console.log(`  -> Sucesso: ${finalFilename}`);
                    res.json({ success: true, downloadUrl: `/downloads/${finalFilename}` });
                    resolve();
                });
                stream.on('error', (err) => {
                    res.status(500).json({ success: false, error: 'Falha YouTube: ' + err.message });
                    resolve();
                });
            });
        }

        // 2. INSTAGRAM
        else if (url.includes('instagram.com')) {
            console.log("  -> Link detectado: Instagram");
            finalFilename = `instagram_${timestamp}.mp4`;
            outputPath = path.join(downloadsDir, finalFilename);

            const links = await instagramGetUrl(url);
            if (!links || !links.url_list || links.url_list.length === 0) {
                return res.status(404).json({ success: false, error: 'Vídeo do Instagram não encontrado ou privado.' });
            }

            const directUrl = links.url_list[0];

            if (justLink) {
                return res.json({ success: true, downloadUrl: directUrl, directLink: directUrl });
            }

            await downloadFromDirectLink(directUrl, outputPath);
            console.log(`  -> Sucesso: ${finalFilename}`);
            return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}` });
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
                return res.status(404).json({ success: false, error: 'Nenhum vídeo extraído desse Tweet.' });
            }

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

            if (!response.data || !response.data.data || !response.data.data.play) {
                return res.status(500).json({ success: false, error: 'Falha ao buscar vídeo no TikTok. O formato da URL pode ser inválido.' });
            }

            const downloadLink = response.data.data.play; // direct link for play without watermark

            if (justLink) {
                return res.json({ success: true, downloadUrl: downloadLink, directLink: downloadLink });
            }

            await downloadFromDirectLink(downloadLink, outputPath);
            console.log(`  -> Sucesso: ${finalFilename}`);
            return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}` });

        }

        else {
            return res.status(400).json({ success: false, error: 'Plataforma não suportada. Use Youtube, Instagram, X ou TikTok.' });
        }

    } catch (err) {
        console.error("- Erro inesperado:", err.message);
        return res.status(500).json({ success: false, error: 'Erro interno ao processar: ' + err.message });
    }
});

app.listen(PORT, () => {
    console.log(`========================================================`);
    console.log(`🎬 Servidor de Download iniciado na porta: ${PORT}`);
    console.log(`✅ Suporte a: YouTube, Instagram, X (Twitter) e TikTok!`);
    console.log(`========================================================`);
});
