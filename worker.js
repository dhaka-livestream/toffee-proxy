// ======================================================
//  TOFFEE PROXY - s2.itcnbd.live স্টাইলের প্রোক্সি
//  Cloudflare Workers এর জন্য তৈরি
// ======================================================

// Toffee-র জন্য প্রয়োজনীয় হেডার
const TOFFEE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.122 Mobile Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Origin': 'https://www.toffeelive.com',
    'Referer': 'https://www.toffeelive.com/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    'Connection': 'keep-alive',
    // Edge-Cache-Cookie - Toffee-র জন্য সবচেয়ে গুরুত্বপূর্ণ
    'Cookie': 'Edge-Cache-Cookie=URLPrefix=aHR0cHM6Ly9ibGRjbXByb2QtY2RuLnRvZmZlZWxpdmUuY29tLw==; path=/; HttpOnly; Secure; SameSite=None'
};

// অনুমোদিত ডোমেইন
const ALLOWED_DOMAINS = [
    'bldcmprod-cdn.toffeelive.com',
    'mprod-cdn.toffeelive.com',
    'toffeelive.com',
    'cdn.toffeelive.com'
];

// m3u8 ফাইলের ভিতরে থাকা অন্যান্য ফাইলের এক্সটেনশন
const REWRITE_EXTENSIONS = ['.ts', '.m3u8', '.key', '.mp4', '.m4s'];

async function handleRequest(request) {
    const url = new URL(request.url);
    
    // 1. 'u' প্যারামিটার থেকে টার্গেট URL বের করুন
    const targetUrl = url.searchParams.get('u');
    if (!targetUrl) {
        return new Response(JSON.stringify({
            error: 'Missing "u" parameter',
            usage: '?u=https://bldcmprod-cdn.toffeelive.com/cdn/live/zee_bangla/playlist.m3u8'
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 2. সিকিউরিটি চেক - শুধু অনুমোদিত ডোমেইন
    try {
        const target = new URL(targetUrl);
        const isAllowed = ALLOWED_DOMAINS.some(domain =>
            target.hostname === domain || target.hostname.endsWith(`.${domain}`)
        );
        if (!isAllowed) {
            return new Response(JSON.stringify({
                error: 'Domain not allowed',
                allowed: ALLOWED_DOMAINS
            }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid URL' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 3. হেডার তৈরি করুন - Toffee-র জন্য প্রয়োজনীয় সব হেডার যোগ করুন
    const headers = new Headers(TOFFEE_HEADERS);
    
    // যদি ইউজার নিজের Cookie দেয়, সেটা ব্যবহার করুন
    if (request.headers.has('Cookie')) {
        headers.set('Cookie', request.headers.get('Cookie'));
    }
    
    // ক্লায়েন্টের IP ফরওয়ার্ড করুন (যদি প্রয়োজন হয়)
    const clientIP = request.headers.get('CF-Connecting-IP') || 
                     request.headers.get('X-Forwarded-For') || 
                     'unknown';
    headers.set('X-Forwarded-For', clientIP);

    // 4. টার্গেটে রিকোয়েস্ট পাঠান
    const modifiedRequest = new Request(targetUrl, {
        method: request.method,
        headers: headers,
        redirect: 'follow'
    });

    let originalResponse;
    try {
        originalResponse = await fetch(modifiedRequest);
    } catch (e) {
        return new Response(JSON.stringify({
            error: 'Failed to fetch target',
            message: e.message
        }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 5. কন্টেন্ট টাইপ চেক করুন
    const contentType = originalResponse.headers.get('content-type') || '';
    const isM3u8 = contentType.includes('application/vnd.apple.mpegurl') || 
                   contentType.includes('audio/mpegurl') ||
                   contentType.includes('video/mpegurl') ||
                   targetUrl.includes('.m3u8');

    // 6. যদি m3u8 না হয়, তাহলে সরাসরি রিটার্ন করুন
    if (!isM3u8) {
        // CORS হেডার যোগ করুন
        const response = new Response(originalResponse.body, {
            status: originalResponse.status,
            statusText: originalResponse.statusText,
            headers: originalResponse.headers
        });
        response.headers.set('Access-Control-Allow-Origin', '*');
        response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        return response;
    }

    // 7. m3u8 ফাইল রিড করুন
    const originalText = await originalResponse.text();
    const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

    // 8. সব লিংক রিরাইট করুন (শুধু .ts নয়, সব মিডিয়া ফাইল)
    let rewrittenText = originalText;
    
    // 8a. আপেক্ষিক পাথকে সম্পূর্ণ URL-এ রূপান্তর করুন
    rewrittenText = rewrittenText.replace(
        /^([^#\n\r]+\.(?:ts|m3u8|key|mp4|m4s))/gim,
        (match, file) => {
            let absoluteUrl = file;
            if (!file.startsWith('http://') && !file.startsWith('https://')) {
                absoluteUrl = new URL(file, baseUrl).href;
            }
            const proxyUrl = new URL(url.origin + url.pathname);
            proxyUrl.searchParams.set('u', absoluteUrl);
            return proxyUrl.href;
        }
    );

    // 8b. #EXT-X-MAP:URI="..." এর ভিতরের লিংক রিরাইট করুন
    rewrittenText = rewrittenText.replace(
        /(#EXT-X-MAP:URI=")([^"]+)(")/gi,
        (match, prefix, file, suffix) => {
            let absoluteUrl = file;
            if (!file.startsWith('http://') && !file.startsWith('https://')) {
                absoluteUrl = new URL(file, baseUrl).href;
            }
            const proxyUrl = new URL(url.origin + url.pathname);
            proxyUrl.searchParams.set('u', absoluteUrl);
            return `${prefix}${proxyUrl.href}${suffix}`;
        }
    );

    // 8c. #EXT-X-KEY:METHOD=AES-128,URI="..." এর ভিতরের লিংক রিরাইট করুন
    rewrittenText = rewrittenText.replace(
        /(#EXT-X-KEY:[^,]+URI=")([^"]+)(")/gi,
        (match, prefix, file, suffix) => {
            let absoluteUrl = file;
            if (!file.startsWith('http://') && !file.startsWith('https://')) {
                absoluteUrl = new URL(file, baseUrl).href;
            }
            const proxyUrl = new URL(url.origin + url.pathname);
            proxyUrl.searchParams.set('u', absoluteUrl);
            return `${prefix}${proxyUrl.href}${suffix}`;
        }
    );

    // 9. রেস্পন্স রিটার্ন করুন
    return new Response(rewrittenText, {
        status: originalResponse.status,
        statusText: originalResponse.statusText,
        headers: {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Cache-Control': 'public, max-age=30',
            'CDN-Cache-Control': 'public, max-age=30',
            'Cloudflare-CDN-Cache-Control': 'public, max-age=30'
        }
    });
}

// OPTIONS রিকোয়েস্ট হ্যান্ডেল করুন (CORS preflight)
async function handleOptions(request) {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Max-Age': '86400',
        }
    });
}

// Cloudflare Workers এন্ট্রি পয়েন্ট
addEventListener('fetch', event => {
    const request = event.request;
    
    if (request.method === 'OPTIONS') {
        event.respondWith(handleOptions(request));
    } else {
        event.respondWith(handleRequest(request));
    }
});
