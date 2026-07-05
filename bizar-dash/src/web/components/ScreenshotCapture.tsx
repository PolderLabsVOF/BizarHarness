// src/web/components/ScreenshotCapture.tsx — v5.0.0
//
// Uses browser's getDisplayMedia() to capture a screen, window, or browser tab.
// Returns a blob URL for preview and uploads to /api/ocr/process for text extraction.

import { useState, useCallback } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { Button } from './Button';
import { Card, CardTitle } from './Card';
import { useToast } from './Toast';
import { api } from '../lib/api';

export type ScreenshotCaptureProps = {
  onTextExtracted?: (text: string, notePath: string) => void;
};

export function ScreenshotCapture({ onTextExtracted }: ScreenshotCaptureProps) {
  const toast = useToast();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const capture = useCallback(async () => {
    setCapturing(true);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { mediaSource: 'screen' } as MediaTrackConstraints,
      });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        toast.error('Failed to get canvas context');
        return;
      }
      ctx.drawImage(video, 0, 0);

      // Stop all tracks
      stream.getTracks().forEach((t) => t.stop());
      video.remove();

      canvas.toBlob(async (blob) => {
        if (!blob) {
          toast.error('Failed to capture screenshot');
          return;
        }
        const url = URL.createObjectURL(blob);
        setImageUrl(url);
        await processImage(blob);
      }, 'image/png');
    } catch (err) {
      if ((err as Error).name !== 'NotAllowedError') {
        toast.error(`Capture failed: ${(err as Error).message}`);
      }
      // NotAllowedError = user cancelled the picker — no toast needed
    } finally {
      setCapturing(false);
    }
  }, [toast]);

  const processImage = useCallback(async (blob: Blob) => {
    setProcessing(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          // Strip data:image/png;base64, prefix for API
          const b64 = result.includes(',') ? result.split(',')[1] : result;
          resolve(b64);
        };
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(blob);
      });

      const r = await api.post<{ ok: boolean; text: string; notePath: string }>('/ocr/process', {
        image: base64,
        lang: 'eng',
      });

      if (r.ok) {
        toast.success('Text extracted from screenshot');
        onTextExtracted?.(r.text, r.notePath);
      }
    } catch (err) {
      toast.error(`OCR failed: ${(err as Error).message}`);
    } finally {
      setProcessing(false);
    }
  }, [toast, onTextExtracted]);

  const dismiss = useCallback(() => {
    setImageUrl(null);
  }, []);

  return (
    <Card variant="outlined" className="screenshot-capture-card">
      <CardTitle><Camera size={14} /> Screenshot Capture</CardTitle>

      <div className="screenshot-capture-body">
        {!imageUrl ? (
          <div className="screenshot-capture-empty">
            <Camera size={32} className="muted" />
            <p className="muted text-sm">Capture your screen to extract text via OCR.</p>
            <Button
              variant="primary"
              size="sm"
              onClick={capture}
              disabled={capturing}
            >
              {capturing ? <Loader2 size={12} className="spinner" /> : <Camera size={12} />}
              {capturing ? 'Selecting…' : 'Capture Screen'}
            </Button>
          </div>
        ) : (
          <div className="screenshot-capture-preview">
            <img src={imageUrl} alt="Captured screenshot" className="screenshot-capture-img" />
            <div className="screenshot-capture-actions">
              {processing && (
                <span className="text-sm muted">
                  <Loader2 size={12} className="spinner" /> Extracting text…
                </span>
              )}
              <Button variant="ghost" size="sm" onClick={dismiss} disabled={processing}>
                Dismiss
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
