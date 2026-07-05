// src/web/components/ScreenshotOCR.tsx — v5.0.0
//
// Combines ScreenshotCapture + extracted text display in one panel.
// Shows the screenshot preview and the OCR-extracted text side by side.

import { useState } from 'react';
import { FileText } from 'lucide-react';
import { ScreenshotCapture } from './ScreenshotCapture';
import { Card, CardTitle, CardMeta } from './Card';

export function ScreenshotOCR() {
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [notePath, setNotePath] = useState<string | null>(null);

  const handleTextExtracted = (text: string, path: string) => {
    setOcrText(text);
    setNotePath(path);
  };

  return (
    <div className="screenshot-ocr-panel">
      <ScreenshotCapture onTextExtracted={handleTextExtracted} />

      {ocrText !== null && (
        <Card variant="outlined" className="screenshot-ocr-result-card">
          <CardTitle>
            <FileText size={14} /> Extracted Text
          </CardTitle>
          {notePath && <CardMeta>Saved to: {notePath}</CardMeta>}

          <div className="screenshot-ocr-text">
            {ocrText ? (
              <pre className="screenshot-ocr-pre mono text-sm">{ocrText}</pre>
            ) : (
              <p className="muted text-sm">No text was found in the captured image.</p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
