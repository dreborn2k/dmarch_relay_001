// Cloudflare Worker - dmarchFF (Fixed Version)
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      
      // Debug log (bisa dihapus nanti)
      console.log(`[Worker] Request: ${path}`);
      
      // ✅ 1. API Endpoint: Proxy whitelist.json
      if (path === '/RELAY/api/whitelist') {
        return await handleWhitelistProxy(env);
      }
      
      // ✅ 2. Serve static files dari GitHub Private Repo
      if (path.startsWith('/RELAY/')) {
        return await serveStaticFromGitHub(path, env);
      }
      
      // ✅ 3. Redirect root ke /RELAY/
      if (path === '/') {
        return Response.redirect('https://' + url.host + '/RELAY/', 302);
      }
      
      return new Response('Not Found', { status: 404 });
    } catch (err) {
      console.error('[Worker] Fatal error:', err);
      return new Response(`Internal Error: ${err.message}`, { 
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  }
};

// 🔐 Proxy whitelist.json dari GitHub Private Repo
async function handleWhitelistProxy(env) {
  try {
    const token = env.GITHUB_TOKEN;
    if (!token) {
      console.error('[Whitelist] GITHUB_TOKEN missing');
      return new Response('Error: GITHUB_TOKEN not configured', { 
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    
    const githubUrl = 'https://api.github.com/repos/dreborn2k/dmarchFF/contents/RELAY/config/whitelist.json?ref=main';
    
    const response = await fetch(githubUrl, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3.raw',
        'User-Agent': 'dmarchFF-Worker/1.0'
      }
    });
    
    if (!response.ok) {
      console.error(`[Whitelist] GitHub error: ${response.status}`);
      return new Response(`GitHub Error: ${response.status}`, { status: response.status });
    }
    
    const data = await response.text();
    return new Response(data, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300'
      }
    });
  } catch (err) {
    console.error('[Whitelist] Error:', err);
    return new Response(`Proxy Error: ${err.message}`, { status: 500 });
  }
}

// 📦 Serve static files dari GitHub Private Repo
async function serveStaticFromGitHub(path, env) {
  try {
    const token = env.GITHUB_TOKEN;
    if (!token) {
      return new Response('GITHUB_TOKEN not configured', { status: 500 });
    }
    
    // ✅ Handle directory request: /RELAY/ atau /RELAY → default ke index.html
    let githubPath = path.replace('/RELAY/', '');
    if (githubPath === '' || githubPath === '/' || githubPath.endsWith('/')) {
      githubPath = 'index.html';
    }
    
    console.log(`[Serve] Fetching: RELAY/${githubPath}`);
    
    const githubUrl = `https://api.github.com/repos/dreborn2k/dmarchFF/contents/RELAY/${githubPath}?ref=main`;
    
    const response = await fetch(githubUrl, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3.raw',  // ← Penting: raw content, bukan metadata JSON
        'User-Agent': 'dmarchFF-Worker/1.0'
      }
    });
    
    if (!response.ok) {
      console.error(`[Serve] File not found: ${githubPath}, status: ${response.status}`);
      return new Response(`File not found: ${path}`, { status: 404 });
    }
    
    // Deteksi Content-Type berdasarkan ekstensi
    const ext = githubPath.split('.').pop().toLowerCase();
    const contentType = {
      'html': 'text/html; charset=utf-8',
      'htm': 'text/html; charset=utf-8',
      'js': 'application/javascript',
      'css': 'text/css',
      'json': 'application/json',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'ico': 'image/x-icon',
      'woff': 'font/woff',
      'woff2': 'font/woff2',
      'ttf': 'font/ttf',
      'webp': 'image/webp'
    }[ext] || 'application/octet-stream';
    
    // Ambil content sebagai ArrayBuffer agar binary-safe
    const content = await response.arrayBuffer();
    
    return new Response(content, {
      headers: { 
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (err) {
    console.error('[Serve] Error:', err);
    return new Response(`Serve Error: ${err.message}`, { status: 500 });
  }
}
