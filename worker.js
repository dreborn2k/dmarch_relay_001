export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      
      console.log(`Request: ${path}`);
      
      if (path === '/RELAY/api/whitelist') {
        return await handleWhitelistProxy(env);
      }
      
      if (path.startsWith('/RELAY/')) {
        return await serveStaticFromGitHub(path, env);
      }
      
      if (path === '/') {
        return Response.redirect('https://' + url.host + '/RELAY/', 302);
      }
      
      return new Response('Not Found', { status: 404 });
    } catch (err) {
      console.error('Worker error:', err);
      return new Response(`Internal Error: ${err.message}`, { 
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  }
};

async function handleWhitelistProxy(env) {
  try {
    const token = env.GITHUB_TOKEN;
    
    if (!token) {
      console.error('GITHUB_TOKEN is missing!');
      return new Response('Error: GITHUB_TOKEN secret not configured in Cloudflare Dashboard', { 
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    
    const githubUrl = 'https://api.github.com/repos/dreborn2k/dmarchFF/contents/RELAY/config/whitelist.json?ref=main';
    
    console.log('Fetching from GitHub API...');
    
    const response = await fetch(githubUrl, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3.raw',
        'User-Agent': 'dmarchFF-Worker/1.0'
      }
    });
    
    if (!response.ok) {
      console.error(`GitHub API error: ${response.status}`);
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
    console.error('Proxy error:', err);
    return new Response(`Proxy Error: ${err.message}`, { status: 500 });
  }
}

async function serveStaticFromGitHub(path, env) {
  try {
    const token = env.GITHUB_TOKEN;
    
    if (!token) {
      return new Response('GITHUB_TOKEN not configured', { status: 500 });
    }
    
    const githubPath = path.replace('/RELAY/', '');
    const githubUrl = `https://api.github.com/repos/dreborn2k/dmarchFF/contents/RELAY/${githubPath}?ref=main`;
    
    const response = await fetch(githubUrl, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3.raw',
        'User-Agent': 'dmarchFF-Worker/1.0'
      }
    });
    
    if (!response.ok) {
      return new Response(`File not found: ${path}`, { status: 404 });
    }
    
    const ext = path.split('.').pop().toLowerCase();
    const contentType = {
      'html': 'text/html; charset=utf-8',
      'js': 'application/javascript',
      'css': 'text/css',
      'json': 'application/json',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'svg': 'image/svg+xml',
      'ico': 'image/x-icon'
    }[ext] || 'application/octet-stream';
    
    const content = await response.arrayBuffer();
    return new Response(content, {
      headers: { 
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (err) {
    return new Response(`Serve Error: ${err.message}`, { status: 500 });
  }
}
