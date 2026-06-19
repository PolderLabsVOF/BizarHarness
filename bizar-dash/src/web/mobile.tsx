// src/mobile.tsx — entry point for mobile dashboard.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MobileApp } from './MobileApp';
import './styles/mobile.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');
createRoot(root).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>,
);
