// Vercel serverless entry — Bizar dashboard
// This file becomes api/index.js in the deployment.
import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Serve static files from the dashboard build
app.use(express.static(join(__dirname, '..', 'public')));

// Fallback to index.html for SPA routing
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, '..', 'public', 'index.html'));
});

export default app;
