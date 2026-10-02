import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

// Serves /api/* from the ./api folder during `npm run dev`, mirroring Vercel functions.
function vercelApiDev() {
    return {
        name: 'vercel-api-dev',
        configureServer(server) {
            server.middlewares.use('/api', async (req, res, next) => {
                const path = new URL(req.url, 'http://x').pathname.replace(/\/$/, '');
                const file = resolve(__dirname, 'api', `.${path}.js`);
                if (path.includes('_lib') || !existsSync(file)) return next();
                try {
                    const mod = await server.ssrLoadModule(file);
                    await mod.default(req, res);
                } catch (err) {
                    console.error(err);
                    res.statusCode = 500;
                    res.end('API error');
                }
            });
        },
    };
}

export default defineConfig(({ mode }) => {
    Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
    return {
        plugins: [vercelApiDev()],
        build: {
            target: 'es2020',
            chunkSizeWarningLimit: 600, // three.js chunk is lazy-loaded
            rollupOptions: {
                // Each page is optional so a half-built section never breaks the build
                input: Object.fromEntries(
                    Object.entries({
                        main: 'index.html',
                        admin: 'admin/index.html',
                        buildings: 'buildings/index.html',
                    })
                        .map(([name, file]) => [name, resolve(__dirname, file)])
                        .filter(([, file]) => existsSync(file)),
                ),
                output: {
                    // One cacheable three.js chunk shared by the plot 3D view and the building visualiser
                    manualChunks: (id) => (id.includes('/node_modules/three/') ? 'three' : undefined),
                },
            },
        },
    };
});
