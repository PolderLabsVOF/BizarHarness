// src/web/components/VoiceRecorder.tsx — v5.0.0
//
// MediaRecorder wrapper: records audio in webm/opus, uploads to /api/voice/upload
// on stop, then calls onSaved(notePath, transcription) so the parent can refresh
// the note list.

import { useState, useRef } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { Button } from './Button';
import { logger } from '../lib/logger';

export type VoiceRecorderProps = {
  /** Vault path to store the transcript under */
  vaultPath?: string;
  /** Called after the note is saved with the note path and transcription text */
  onSaved?: (notePath: string, transcription: string | null) => void;
};

export function VoiceRecorder({ vaultPath, onSaved }: VoiceRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Prefer webm/opus; fall back to whatever the browser offers
      const mimeType =
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        chunksRef.current = [];
        // Stop all tracks to release the microphone
        stream.getTracks().forEach((t) => t.stop());
        await uploadAndTranscribe(blob);
      };

      recorder.start(1000); // timeslice=1s for chunk delivery
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      // getUserMedia not available or permission denied
      logger.error('[VoiceRecorder] failed to start recording:', err);
    }
  };

  const stopRecording = () => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    rec.stop();
    setRecording(false);
    setTranscribing(true);
  };

  const uploadAndTranscribe = async (blob: Blob) => {
    try {
      const form = new FormData();
      form.append('audio', blob, 'voice-note.webm');
      form.append('vaultPath', vaultPath || '');
      const res = await fetch('/api/voice/upload', { method: 'POST', body: form });
      if (!res.ok) {
        logger.error('[VoiceRecorder] upload failed:', res.status, await res.text());
        setTranscribing(false);
        return;
      }
      const { notePath, transcription } = await res.json();
      onSaved?.(notePath, transcription);
    } catch (err) {
      logger.error('[VoiceRecorder] upload error:', err);
    } finally {
      setTranscribing(false);
    }
  };

  return (
    <div className="voice-recorder">
      {!recording && !transcribing && (
        <Button variant="primary" size="sm" onClick={startRecording} aria-label="Start recording">
          <Mic size={14} /> Record
        </Button>
      )}
      {recording && (
        <Button variant="danger" size="sm" onClick={stopRecording} aria-label="Stop recording">
          <Square size={14} /> Stop
        </Button>
      )}
      {transcribing && (
        <Button variant="secondary" size="sm" disabled>
          <Loader2 size={14} className="spinning" /> Transcribing…
        </Button>
      )}
    </div>
  );
}
