// animuslex.app: solo corre cuando la URL no coincide exacto con un archivo
// (las URL exactas, como /servicios.html, las sirve Cloudflare directo).
//   /carpeta/      -> /carpeta/index.html (200)
//   /carpeta       -> 301 a /carpeta/
//   /pagina        -> /pagina.html (200, igual que hacía Render)
//   resto          -> 404
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const asset = async (p) => {
      const u = new URL(url);
      u.pathname = p;
      const res = await env.ASSETS.fetch(new Request(u, request));
      return res.status === 404 ? null : res;
    };

    if (path.endsWith('/')) {
      const res = await asset(path + 'index.html');
      if (res) return res;
    } else if (!/\.[A-Za-z0-9]+$/.test(path.split('/').pop())) {
      if (await asset(path + '/index.html')) {
        url.pathname = path + '/';
        return Response.redirect(url.toString(), 301);
      }
      const res = await asset(path + '.html');
      if (res) return res;
    }

    return env.ASSETS.fetch(request);
  },
};
