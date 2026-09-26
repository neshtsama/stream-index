const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 5000;
const CAPTURE_TIMEOUT = 25000;

app.use(cors());
app.use(express.json());

function getEmbedUrl(serverId, type, id, season, episode) {
    const sId = parseInt(serverId, 10) || 1;
    const s = season || 1;
    const e = episode || 1;
    if (type === 'tv') {
        switch (sId) {
            case 1: return `https://vidsrc.sbs/embed/tv/${id}/${s}/${e}`;
            case 2: return `https://vidsrc.cc/v2/embed/tv/${id}/${s}/${e}`;
            case 3: return `https://vidsrc.pro/embed/tv/${id}/${s}/${e}`;
            default: return `https://vidsrc.sbs/embed/tv/${id}/${s}/${e}`;
        }
    } else {
        switch (sId) {
            case 1: return `https://vidsrc.sbs/embed/movie/${id}`;
            case 2: return `https://vidsrc.cc/v2/embed/movie/${id}`;
            case 3: return `https://vidsrc.pro/embed/movie/${id}`;
            default: return `https://vidsrc.sbs/embed/movie/${id}`;
        }
    }
}

function looksLikeManifest(url, contentType = '') {
    const u = url.toLowerCase();
    const ct = contentType.toLowerCase();
    return u.includes('.m3u8') || u.includes('/playlist') || u.includes('/manifest') || ct.includes('mpegurl');
}

const AD_HOSTS = ['doubleclick', 'adnxs', 'googlesyndication', 'pubmatic', 'rubiconproject', 'popads'];
function isAdUrl(url) {
    return AD_HOSTS.some(h => url.toLowerCase().includes(h));
}

app.get('/api/stream', async (req, res) => {
    const { id, type, season, episode, server = 1 } = req.query;

    if (!id || !type) {
        return res.status(400).json({ error: 'Missing required parameters.' });
    }

    const targetUrl = getEmbedUrl(server, type, id, season, episode);
    console.log(`[Playwright] Resolving Server ${server} (${type} ID: ${id})...`);

    let browser = null;
    let extractedM3u8 = null;

    try {
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--autoplay-policy=no-user-gesture-required',
                '--disable-web-security'
            ]
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        // Close ad popups automatically
        context.on('page', async (newPage) => {
            await newPage.close().catch(() => {});
        });

        const page = await context.newPage();

        // Intercept network requests across all frames
        page.on('request', (request) => {
            const reqUrl = request.url();
            if (!extractedM3u8 && looksLikeManifest(reqUrl) && !isAdUrl(reqUrl)) {
                extractedM3u8 = reqUrl;
                console.log(`[Captured Stream] ${reqUrl}`);
            }
        });

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});

        const startTime = Date.now();
        while (!extractedM3u8 && Date.now() - startTime < CAPTURE_TIMEOUT) {
            for (const frame of page.frames()) {
                try {
                    await frame.evaluate(() => {
                        document.querySelectorAll('video').forEach(v => {
                            v.muted = true;
                            v.play().catch(() => {});
                        });
                        document.querySelectorAll('[class*="play" i], button').forEach(b => b.click());
                    });
                } catch (e) {}
            }

            await page.mouse.click(640, 360).catch(() => {});
            await new Promise(r => setTimeout(r, 1000));
        }

        await browser.close();

        if (extractedM3u8) {
            // DEPLOYMENT FIX: build the proxy URL from the incoming request host,
            // so it works on Render (https) and locally — no hardcoded localhost.
            const proxiedUrl = `${req.protocol}://${req.get('host')}/api/m3u8-proxy?url=${encodeURIComponent(extractedM3u8)}&referer=${encodeURIComponent(targetUrl)}`;
            return res.json({ status: 'success', targetUrl: proxiedUrl, isRawStream: true });
        }

        return res.json({ status: 'success', targetUrl: targetUrl, isRawStream: false });

    } catch (error) {
        if (browser) await browser.close().catch(() => {});
        console.error(`[Playwright Error] ${error.message}`);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Proxy endpoint with manifest URL resolution
app.get('/api/m3u8-proxy', async (req, res) => {
    const { url, referer } = req.query;
    if (!url) return res.status(400).send('Missing URL');

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': referer || 'https://vidsrc.cc/'
            }
        });

        if (!response.ok) return res.status(response.status).send('Proxy fetch failed');

        let bodyText = await response.text();

        // Rewrite relative URLs in .m3u8 manifests to absolute CDN URLs
        if (bodyText.includes('#EXTM3U')) {
            const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
            bodyText = bodyText.replace(/^(?!#)(?!\s*$)(.+)/gm, (line) => {
                if (line.startsWith('http://') || line.startsWith('https://')) return line;
                return new URL(line.trim(), baseUrl).href;
            });
        }

        res.setHeader('Content-Type', 'application/x-mpegURL');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(bodyText);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Health check — useful on Render to confirm the service is up
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
    console.log(`StreamIndex backend running on port ${PORT}`);
});
