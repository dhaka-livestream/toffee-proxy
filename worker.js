// যেসব ডোমেইনকে প্রক্সি করতে পারবেন (অপব্যবহার রোধে)
const ALLOWED_DOMAINS = [
    'bldcmprod-cdn.toffeelive.com',
    'toffeelive.com'
];

async function handleRequest(request) {
    const url = new URL(request.url);

    // 1. 'u' প্যারামিটার থেকে টার্গেট URL বের করুন
    const targetUrl = url.searchParams.get('u');
    if (!targetUrl) {
        return new Response('Missing "u" parameter', { status: 400 });
    }

    // 2. নিরাপত্তা: শুধুমাত্র অনুমোদিত ডোমেইন প্রক্সি করুন
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

    // 3. আসল কন্টেন্টের জন্য রিকোয়েস্ট করুন
    const modifiedRequest = new Request(targetUrl, {
        method: request.method,
        headers: request.headers,
    });

    const originalResponse = await fetch(modifiedRequest);
    const contentType = originalResponse.headers.get('content-type') || '';

    // 4. যদি m3u8 ফাইল না হয়, তাহলে সরাসরি রেস্পন্স দিন
    if (!contentType.includes('application/vnd.apple.mpegurl') && !targetUrl.endsWith('.m3u8')) {
        return originalResponse;
    }

    // 5. m3u8 ফাইলের সব .ts লিংক পরিবর্তন করুন
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

    // 6. পরিবর্তিত m3u8 কন্টেন্ট রিটার্ন করুন
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

// Cloudflare Workers-এর এন্ট্রি পয়েন্ট
addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});
