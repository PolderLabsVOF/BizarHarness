// src/web/components/VoiceNotesPanel.tsx — v5.0.0
//
// List + record + playback for voice notes.
// Wire into Memory tab as the "Voice Notes" source panel.

import { useEffect, useState } from 'react';
import { Play, Pause, Trash2, Search as SearchIcon, Mic } from 'lucide-react';
import { Card, CardTitle, CardMeta } from './Card';
import { VoiceRecorder } from './VoiceRecorder';
import { Button } from './Button';

type VoiceNote = {
  id: string;
  audioPath: string;
  notePath: string | null;
  transcript: string | null;
  durationSec: number | null;
  vaultPath: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

type Props = {
  /** Vault path to scope the panel to */
  vaultPath?: string;
  /** Key to force reload when parent refreshes */
  refreshKey?: number;
};

function NoteCard({ note, onDelete }: { note: VoiceNote; onDelete: (id: string) => void }) {
  const [playing, setPlaying] = useState(false);
  const [audio] = useState(() => {
    if (!note.audioPath) return null;
    const a = new Audio(`/api/voice/${note.id}/audio`);
    a.onended = () => setPlaying(false);
    return a;
  });

  const togglePlay = () => {
    if (!audio) return;
    if (playing) {
      audio.pause();
      audio.currentTime = 0;
      setPlaying(false);
    } else {
      audio.play();
      setPlaying(true);
    }
  };

  const created = new Date(note.createdAtMs).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="voice-note-card">
      <div className="voice-note-card-head">
        <div className="voice-note-card-meta">
          <span className="voice-note-date">{created}</span>
          {note.durationSec && (
            <span className="voice-note-duration">{Math.round(note.durationSec)}s</span>
          )}
        </div>
        <div className="voice-note-card-actions">
          {audio && (
            <button
              type="button"
              className="icon-btn"
              onClick={togglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
              title={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause size={13} /> : <Play size={13} />}
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={() => onDelete(note.id)}
            aria-label="Delete note"
            title="Delete note"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {note.transcript && (
        <p className="voice-note-transcript">{note.transcript}</p>
      )}

      {!note.transcript && (
        <p className="voice-note-no-transcript muted text-sm">No transcription available</p>
      )}
    </div>
  );
}

export function VoiceNotesPanel({ vaultPath, refreshKey = 0 }: Props) {
  const [notes, setNotes] = useState<VoiceNote[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const loadNotes = async () => {
    setLoading(true);
    try {
      const vaultParam = vaultPath ? `?vaultPath=${encodeURIComponent(vaultPath)}` : '';
      const r = await fetch(`/api/voice/list${vaultParam}`);
      const data = await r.json();
      setNotes(data.notes || []);
    } catch (err) {
      console.error('[VoiceNotesPanel] failed to load notes:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotes();
  }, [vaultPath, refreshKey]);

  const handleDelete = async (id: string) => {
    try {
      const r = await fetch(`/api/voice/${id}`, { method: 'DELETE' });
      if (r.ok || r.status === 204) {
        setNotes((prev) => prev.filter((n) => n.id !== id));
      }
    } catch (err) {
      console.error('[VoiceNotesPanel] delete failed:', err);
    }
  };

  const filtered = notes.filter(
    (n) =>
      !search ||
      (n.transcript?.toLowerCase().includes(search.toLowerCase()) ?? false),
  );

  return (
    <Card>
      <CardTitle>
        <Mic size={14} /> Voice Notes
      </CardTitle>
      <CardMeta>Record and transcribe audio notes into your vault</CardMeta>

      {/* Search */}
      <div className="memory-search-row">
        <input
          type="text"
          className="input search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search transcripts…"
          aria-label="Search voice notes"
        />
      </div>

      {/* Recorder */}
      <div className="voice-recorder-row">
        <VoiceRecorder vaultPath={vaultPath} onSaved={loadNotes} />
      </div>

      {/* Note list */}
      {loading ? (
        <p className="muted text-sm">Loading notes…</p>
      ) : filtered.length === 0 ? (
        <p className="muted text-sm">
          {search ? 'No notes match your search.' : 'No voice notes yet. Hit Record to add one.'}
        </p>
      ) : (
        <div className="voice-note-list">
          {filtered.map((n) => (
            <NoteCard key={n.id} note={n} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </Card>
  );
}
