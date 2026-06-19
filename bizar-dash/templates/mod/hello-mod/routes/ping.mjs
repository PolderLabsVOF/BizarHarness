// Sample route registration for the Hello Mod.
// v3 doesn't dynamically mount mod routes yet, but this file documents
// the intended shape for v3.1+.

export default function register({ app, state }) {
  app.get('/api/mods/hello-mod/ping', (req, res) => {
    res.json({ ok: true, from: 'hello-mod', ts: Date.now() });
  });
}
