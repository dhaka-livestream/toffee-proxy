// ================== এখানে আপনার হেডার দিন ==================
// Toffee-র জন্য প্রয়োজনীয় হেডার
const CUSTOM_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://www.toffeelive.com',
    'Referer': 'https://www.toffeelive.com/',
    // Cookie অংশটি নিচে আলাদাভাবে রাখা ভালো, কারণ এটি প্রায়ই বদলায়
    // 'Cookie': 'Edge-Cache-Cookie=...' 
};
// ========================================================

// যেসব ডোমেইনকে প্রক্সি করতে পারবেন
const ALLOWED_DOMAINS = [
    'bldcmprod-cdn.toffeelive.com',
    'toffeelive.com'
];

async function handleRequest(request) {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('u');
    
    if (!targetUrl) {
        return new Response('Missing "u" parameter', { status: 400 });
    }

    // ১. নিরাপত্তা: শুধুমাত্র অনুমোদিত ডোমেইন
    try {
        const target = new URL(targetUrl);
        const isAllowed = ALLOWED_DOMAINS.some(domain =>
            target.hostname === domain || target.hostname.endsWith(`.${domain}`)
        );
        if (!isAllowed) {
            return new Response('Proxying this domain is not allowed.', { status: 403 });
        }
    } catch (e) {
        return new Response('Invalid target URL', { status: 400 });
    }

    // ২. হেডার তৈরি করা (কাস্টম + ওরিজিনাল রিকোয়েস্ট থেকে কিছু হেডার নেওয়া)
    const headers = new Headers(CUSTOM_HEADERS);
    
    // ওরিজিনাল রিকোয়েস্ট থেকে 'Cookie' এবং 'Authorization' হেডার নেওয়া (যদি থাকে)
    if (request.headers.has('Cookie')) {
        headers.set('Cookie', request.headers.get('Cookie'));
    }
    if (request.headers.has('Authorization')) {
        headers.set('Authorization', request.headers.get('Authorization'));
    }

    // ৩. টার্গেটে রিকোয়েস্ট পাঠানো
    const modifiedRequest = new Request(targetUrl, {
        method: request.method,
        headers: headers,
    });

    let originalResponse;
    try {
        originalResponse = await fetch(modifiedRequest);
    } catch (e) {
        return new Response(`Failed to fetch target: ${e.message}`, { status: 502 });
    }

    // ৪. কন্টেন্ট টাইপ চেক করা
    const contentType = originalResponse.headers.get('content-type') || '';
    const isM3u8 = contentType.includes('application/vnd.apple.mpegurl') || 
                   contentType.includes('audio/mpegurl') ||
                   targetUrl.endsWith('.m3u8');

    // ৫. যদি m3u8 না হয়, তাহলে সরাসরি রিটার্ন
    if (!isM3u8) {
        return originalResponse;
    }

    // ৬. m3u8 ফাইলের .ts লিংকগুলো পরিবর্তন করা
    const originalText = await originalResponse.text();
    const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

    const rewrittenText = originalText.replace(/([^\n\r]+\.ts)/gi, (match, tsFile) => {
        let absoluteTsUrl = tsFile;
        if (!tsFile.startsWith('http://') && !tsFile.startsWith('https://')) {
            absoluteTsUrl = new URL(tsFile, baseUrl).href;
        }
        const proxyUrl = new URL(url.origin + url.pathname);
        proxyUrl.searchParams.set('u', absoluteTsUrl);
        return proxyUrl.href;
    });

    // ৭. রেস্পন্স রিটার্ন করা
    return new Response(rewrittenText, {
        status: originalResponse.status,
        statusText: originalResponse.statusText,
        headers: {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=10',
        }
    });
}

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});
