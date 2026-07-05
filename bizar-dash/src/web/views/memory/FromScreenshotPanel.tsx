// src/web/views/memory/FromScreenshotPanel.tsx — v5.0.0
//
// Memory tab panel that wraps ScreenshotOCR for the three-column Memory layout.
// Provides a self-contained screenshot → OCR → save workflow.

import { ScreenshotOCR } from '../../components/ScreenshotOCR';
import { Card } from '../../components/Card';

type Props = {
  refreshKey: number;
};

export function FromScreenshotPanel({ refreshKey: _refreshKey }: Props) {
  return (
    <div className="memory-panel-content">
      <Card variant="outlined" className="memory-panel-card">
        <div className="memory-panel-body">
          <ScreenshotOCR />
        </div>
      </Card>
    </div>
  );
}
