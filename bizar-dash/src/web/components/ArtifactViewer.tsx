// src/web/components/ArtifactViewer.tsx — modal viewer for rendered HTML artifacts.
import { useEffect, useState } from 'react';
import { X, ExternalLink, Download, FileText } from 'lucide-react';
import { useModal } from './Modal';
import { Spinner } from './Spinner';
import { api } from '../lib/api';

type ArtifactMeta = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  createdAt: string;
};

type Props = {
  artifactId: string;
  onClose: () => void;
};

export function ArtifactViewer({ artifactId, onClose }: Props) {
  const [meta, setMeta] = useState<ArtifactMeta | null>(null);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [metaData, contentData] = await Promise.all([
          api.get<ArtifactMeta>(`/artifacts/${encodeURIComponent(artifactId)}`),
          fetchRawContent(artifactId),
        ]);
        if (!cancelled) {
          setMeta(metaData);
          setContent(contentData);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load artifact:', err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [artifactId]);

  return (
    <div className="modal-backdrop" onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal artifact-viewer-modal" role="dialog" aria-modal="true">
        <header className="modal-header">
          <div className="modal-title-group">
            <FileText size={16} />
            <h2 className="modal-title">{meta?.name || 'Artifact'}</h2>
            {meta && (
              <span className="artifact-viewer-meta muted">
                {meta.contentType} · {formatBytes(meta.size)}
              </span>
            )}
          </div>
          <div className="modal-header-actions">
            {meta && (
              <>
                <a
                  href={`/api/artifacts/${encodeURIComponent(artifactId)}/content`}
                  target="_blank"
                  rel="noreferrer"
                  className="icon-btn"
                  title="Open in new tab"
                >
                  <ExternalLink size={16} />
                </a>
                <a
                  href={`/api/artifacts/${encodeURIComponent(artifactId)}/content`}
                  download={meta.name || 'artifact.html'}
                  className="icon-btn"
                  title="Download"
                >
                  <Download size={16} />
                </a>
              </>
            )}
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="modal-body artifact-viewer-body">
          {loading ? (
            <div className="artifact-viewer-loading">
              <Spinner />
              <span className="muted">Loading artifact…</span>
            </div>
          ) : content ? (
            <iframe
              srcDoc={content}
              className="artifact-viewer-iframe"
              sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
              title={meta?.name || 'Artifact'}
            />
          ) : (
            <div className="artifact-viewer-empty muted">
              <FileText size={32} />
              <p>No content available.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Fetch raw text content — bypasses the JSON api wrapper.
async function fetchRawContent(artifactId: string): Promise<string> {
  const r = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/content`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

// Hook to open the artifact viewer via the modal system.
export function openArtifactViewer(
  modal: ReturnType<typeof useModal>,
  artifactId: string,
) {
  modal.open({
    title: 'Artifact',
    width: 900,
    children: <ArtifactViewerModal artifactId={artifactId} />,
  });
}

function ArtifactViewerModal({ artifactId }: { artifactId: string }) {
  const [meta, setMeta] = useState<ArtifactMeta | null>(null);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [metaData, contentData] = await Promise.all([
          api.get<ArtifactMeta>(`/artifacts/${encodeURIComponent(artifactId)}`),
          fetchRawContent(artifactId),
        ]);
        if (!cancelled) {
          setMeta(metaData);
          setContent(contentData);
        }
      } catch {
        /* best-effort */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [artifactId]);

  return (
    <div className="artifact-viewer-embedded">
      {loading ? (
        <div className="artifact-viewer-loading">
          <Spinner />
          <span className="muted">Loading artifact…</span>
        </div>
      ) : content ? (
        <iframe
          srcDoc={content}
          className="artifact-viewer-iframe"
          sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
          title={meta?.name || 'Artifact'}
        />
      ) : (
        <div className="artifact-viewer-empty muted">
          <FileText size={32} />
          <p>No content available.</p>
        </div>
      )}
    </div>
  );
}
