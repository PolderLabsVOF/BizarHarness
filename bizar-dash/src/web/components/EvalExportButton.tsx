// src/components/EvalExportButton.tsx — v5.3.0
// Export button for downloading eval run results as CSV.

import React from 'react';
import { Download } from 'lucide-react';
import { Button } from './Button';
import { api } from '../lib/api';

type Props = {
  runId: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
};

export function EvalExportButton({ runId, variant = 'secondary', size = 'sm' }: Props) {
  const onExport = () => {
    const token = api.getToken();
    window.open(`/api/eval/runs/${encodeURIComponent(runId)}/export.csv?_t=${encodeURIComponent(token)}`, '_blank');
  };

  return (
    <Button variant={variant} size={size} onClick={onExport} title="Export results as CSV">
      <Download size={14} aria-hidden />
      Export CSV
    </Button>
  );
}
