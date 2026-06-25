/**
 * my-mod/route.mjs — example mod route.
 *
 * Mounted at /api/mods/my-mod. Replace with your mod's API.
 */
export default function register({ router, broadcast = () => {} }) {
  router.get('/hello', (req, res) => {
    res.json({ msg: 'Hello from my-mod!' });
  });

  router.get('/health', (req, res) => {
    res.json({ ok: true, mod: 'my-mod' });
  });
}