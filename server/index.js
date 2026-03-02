const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const ytdl = require('@distube/ytdl-core');
const instagramGetUrl = require('instagram-url-direct');
const getTwitterMedia = require('get-twitter-media');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegStatic);

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

// Função para converter MP4 para GIF (Primeiros 5 seg)
function convertToGif(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .setStartTime(0)
            .setDuration(5)
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
    });
}

// Função para pegar título genérico de qualquer página
async function getGenericTitle(u) {
    try {
        const { data: html } = await axios.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const match = html.match(/<meta property="og:title" content="([^"]+)"/) || html.match(/<title>([^<]+)<\/title>/);
        return match ? match[1].replace(/[\\/*?:"<>|]/g, "").substring(0, 50) : 'katch_media';
    } catch (e) { return 'katch_media'; }
}

app.post('/download', async (req, res) => {
    const { url, audioOnly, justLink, resolution, subs, gifMode } = req.body;

    if (!url) {
        return res.status(400).json({ success: false, error: 'URL do vídeo é obrigatória.' });
    }

    try {
        console.log(`\n[+] Processando link: ${url} | Res: ${resolution || 'default'} | Subs: ${subs} | GIF: ${gifMode}`);

        const timestamp = Date.now();
        let outputPath = '';
        let finalFilename = '';
        let videoTitle = 'katch_media';

        // 1. YOUTUBE
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            console.log("  -> Link detectado: YouTube");

            // Pegar Info para o Título e Legendas
            const info = await ytdl.getInfo(url);
            videoTitle = info.videoDetails.title.replace(/[\\/*?:"<>|]/g, "").substring(0, 50); // Limpa caracteres inválidos

            finalFilename = `${videoTitle}_${timestamp}${audioOnly ? '_audio.mp4' : '.mp4'}`;
            outputPath = path.join(downloadsDir, finalFilename);

            const filterType = audioOnly ? 'audioonly' : 'audioandvideo';
            let qualityPreference = 'highest';
            if (resolution === '1080p' || resolution === '720p' || resolution === '480p' || resolution === '360p') {
                qualityPreference = 'highestvideo';
            } else if (resolution === 'lowest') {
                qualityPreference = 'lowest';
            }

            const stream = ytdl(url, { quality: qualityPreference, filter: filterType });
            stream.pipe(fs.createWriteStream(outputPath));

            // Download de Legendas se solicitado
            if (subs && info.player_response.captions) {
                const tracks = info.player_response.captions.playerCaptionsTracklistRenderer.captionTracks;
                if (tracks && tracks.length > 0) {
                    const subUrl = tracks[0].baseUrl;
                    const subPath = outputPath.replace('.mp4', '.srt');
                    const { data: subData } = await axios.get(subUrl);
                    fs.writeFileSync(subPath, subData); // Simplificado: XML de legenda do YT
                }
            }

            return new Promise((resolve) => {
                stream.on('finish', async () => {
                    console.log(`  -> Sucesso: ${finalFilename}`);

                    if (gifMode) {
                        const gifPath = outputPath.replace('.mp4', '.gif');
                        await convertToGif(outputPath, gifPath);
                        finalFilename = finalFilename.replace('.mp4', '.gif');
                    }

                    res.json({ success: true, downloadUrl: `/downloads/${finalFilename}`, title: videoTitle });
                    resolve();
                });
                stream.on('error', (err) => {
                    res.status(500).json({ success: false, error: 'Falha YouTube: ' + err.message });
                    resolve();
                });
            });
        }

        // Para os outros, usamos o switch de if
        else if (url.includes('instagram.com')) {
            videoTitle = await getGenericTitle(url);
            const links = await instagramGetUrl(url);
            if (!links || !links.url_list || links.url_list.length === 0) {
                return res.status(404).json({ success: false, error: 'Vídeo do Instagram não encontrado.' });
            }
            const directUrl = links.url_list[0];
            const isImage = directUrl.includes('.jpg') || directUrl.includes('.webp') || directUrl.includes('.png');
            finalFilename = `${videoTitle}_${timestamp}${isImage ? '.jpg' : '.mp4'}`;
            outputPath = path.join(downloadsDir, finalFilename);
            if (justLink) return res.json({ success: true, downloadUrl: directUrl, directLink: directUrl, title: videoTitle });
            await downloadFromDirectLink(directUrl, outputPath);
            return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}`, title: videoTitle });
        }

        // 3. X / TWITTER
        else if (url.includes('twitter.com') || url.includes('x.com')) {
            videoTitle = await getGenericTitle(url);
            const tweetData = await getTwitterMedia(url, { text: true });
            let videoUrlToDownload = null;
            if (tweetData && tweetData.media && tweetData.media.length > 0) {
                const mediaVideos = tweetData.media.filter(m => m.type === 'video');
                videoUrlToDownload = mediaVideos.length > 0 ? mediaVideos[0].url : tweetData.media[0].url;
            }
            if (!videoUrlToDownload) return res.status(404).json({ success: false, error: 'Nenhuma mídia no Tweet.' });
            const isImage = videoUrlToDownload.includes('.jpg') || videoUrlToDownload.includes('.png');
            finalFilename = `${videoTitle}_${timestamp}${isImage ? '.jpg' : '.mp4'}`;
            outputPath = path.join(downloadsDir, finalFilename);
            if (justLink) return res.json({ success: true, downloadUrl: videoUrlToDownload, title: videoTitle });
            await downloadFromDirectLink(videoUrlToDownload, outputPath);
            return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}`, title: videoTitle });
        }

        // 4. TIKTOK
        else if (url.includes('tiktok.com')) {
            videoTitle = await getGenericTitle(url);
            const response = await axios.post('https://www.tikwm.com/api/', { url: url }, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }
            });
            let downloadLink = response.data?.data?.play || response.data?.data?.images?.[0];
            if (!downloadLink) return res.status(500).json({ success: false, error: 'Falha TikTok.' });
            const isImage = !response.data.data.play;
            finalFilename = `${videoTitle}_${timestamp}${isImage ? '.jpg' : '.mp4'}`;
            outputPath = path.join(downloadsDir, finalFilename);
            if (justLink) return res.json({ success: true, downloadUrl: downloadLink, title: videoTitle });
            await downloadFromDirectLink(downloadLink, outputPath);
            return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}`, title: videoTitle });
        }

        // 5. REDDIT
        else if (url.includes('reddit.com')) {
            videoTitle = await getGenericTitle(url);
            const cleanRedditUrl = url.split('?')[0].replace(/\/$/, '') + '.json';
            const response = await axios.get(cleanRedditUrl);
            const postData = response.data[0]?.data?.children[0]?.data;
            let mediaUrl = postData?.secure_media?.reddit_video?.fallback_url || postData?.url_overridden_by_dest || postData?.url;
            if (!mediaUrl) return res.status(404).json({ success: false, error: 'Mídia Reddit não encontrada.' });
            const isImage = mediaUrl.match(/\.(jpg|png|gif)/i);
            finalFilename = `${videoTitle}_${timestamp}${isImage ? '.jpg' : '.mp4'}`;
            outputPath = path.join(downloadsDir, finalFilename);
            if (justLink) return res.json({ success: true, downloadUrl: mediaUrl, title: videoTitle });
            await downloadFromDirectLink(mediaUrl, outputPath);
            return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}`, title: videoTitle });
        }

        // 6. FACEBOOK
        else if (url.includes('facebook.com') || url.includes('fb.watch')) {
            videoTitle = await getGenericTitle(url);
            const { data: html } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const hdMatch = html.match(/hd_src:"([^"]+)"/);
            const sdMatch = html.match(/sd_src:"([^"]+)"/);
            let mediaUrl = hdMatch ? hdMatch[1] : (sdMatch ? sdMatch[1] : null);
            if (!mediaUrl) mediaUrl = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1]?.replace(/\\/g, '');
            if (!mediaUrl) return res.status(404).json({ success: false, error: 'Mídia FB não encontrada.' });
            finalFilename = `${videoTitle}_${timestamp}.mp4`;
            outputPath = path.join(downloadsDir, finalFilename);
            if (justLink) return res.json({ success: true, downloadUrl: mediaUrl, title: videoTitle });
            await downloadFromDirectLink(mediaUrl, outputPath);
            return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}`, title: videoTitle });
        }

        // 7. TUMBLR
        else if (url.includes('tumblr.com')) {
            videoTitle = await getGenericTitle(url);
            const { data: html } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const videoMatch = html.match(/<meta property="og:video" content="([^"]+)"/) || html.match(/source src="([^"]+)"/);
            let mediaUrl = videoMatch ? videoMatch[1] : html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
            if (!mediaUrl) return res.status(404).json({ success: false, error: 'Mídia Tumblr não encontrada.' });
            finalFilename = `${videoTitle}_${timestamp}.mp4`;
            outputPath = path.join(downloadsDir, finalFilename);
            if (justLink) return res.json({ success: true, downloadUrl: mediaUrl, title: videoTitle });
            await downloadFromDirectLink(mediaUrl, outputPath);
            return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}`, title: videoTitle });
        }

        // 8. PINTEREST
        else if (url.includes('pinterest.com') || url.includes('pin.it')) {
            videoTitle = await getGenericTitle(url);
            const { data: html } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            let mediaUrl = html.match(/"contentUrl":"([^"]+)"/)?.[1]?.replace(/\\/g, '') || html.match(/https:\/\/[^"]+\.mp4/)?.[0];
            if (!mediaUrl) mediaUrl = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
            if (!mediaUrl) return res.status(404).json({ success: false, error: 'Mídia Pinterest não encontrada.' });
            finalFilename = `${videoTitle}_${timestamp}.mp4`;
            outputPath = path.join(downloadsDir, finalFilename);
            if (justLink) return res.json({ success: true, downloadUrl: mediaUrl, title: videoTitle });
            await downloadFromDirectLink(mediaUrl, outputPath);
            return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}`, title: videoTitle });
        }

        // 9. VIMEO
        else if (url.includes('vimeo.com')) {
            videoTitle = await getGenericTitle(url);
            const { data: html } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const configMatch = html.match(/(https:\/\/player\.vimeo\.com\/video\/[0-9]+\/config[^"]+)/);
            let videoUrl = null;
            if (configMatch) {
                const configUrl = configMatch[1].replace(/\\/g, '').replace(/&amp;/g, '&');
                const { data: configData } = await axios.get(configUrl);
                const bestVideo = configData?.request?.files?.progressive?.reduce((prev, curr) => (+prev.width > +curr.width) ? prev : curr);
                videoUrl = bestVideo?.url;
            }
            if (!videoUrl) return res.status(404).json({ success: false, error: 'Vimeo não encontrado.' });
            finalFilename = `${videoTitle}_${timestamp}.mp4`;
            outputPath = path.join(downloadsDir, finalFilename);
            if (justLink) return res.json({ success: true, downloadUrl: videoUrl, title: videoTitle });
            await downloadFromDirectLink(videoUrl, outputPath);
            return res.json({ success: true, downloadUrl: `/downloads/${finalFilename}`, title: videoTitle });
        }

        else {
            return res.status(400).json({ success: false, error: 'Plataforma não suportada.' });
        }

    } catch (err) {
        console.error("- Erro inesperado:", err.message);
        return res.status(500).json({ success: false, error: 'Erro interno: ' + err.message });
    }
});

app.listen(PORT, () => {
    console.log(`========================================================`);
    console.log(`🎬 Servidor de Download iniciado na porta: ${PORT}`);
    console.log(`✅ Suporte a: YouTube, Instagram, X, TikTok, Reddit, FB, Tumblr, Pinterest e Vimeo!`);
    console.log(`========================================================`);
});
