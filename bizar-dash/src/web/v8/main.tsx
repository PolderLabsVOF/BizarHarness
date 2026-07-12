import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './ui/theme/ThemeProvider.js';
import { DensityProvider } from './ui/theme/DensityProvider.js';
import { App } from './App.js';
import './ui/styles/globals.css';

/**
 * v8 entry — mounts the React 18 root with the theme + density providers
 * wrapping the App. The root element id is `root`; the v7 dashboard mounts
 * on `root` as well, so the v8 entry is wired from a separate route via
 * the dashboard server (see PLAN.md §4 for the v8 → v7 migration plan).
 */
const container = document.getElementById('root');
if (container === null) {
  throw new Error('v8 mount target #root not found in DOM.');
}

const root = createRoot(container);
root.render(
  <StrictMode>
    <ThemeProvider>
      <DensityProvider>
        <App />
      </DensityProvider>
    </ThemeProvider>
  </StrictMode>,
);