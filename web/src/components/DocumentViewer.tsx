import { useEffect, useState } from 'react';
import { uploadsApi, type BadgeDocument } from '../api';
import { docLabel } from '../lib/labels';
import { Button, ErrorBox, Modal, Spinner } from './ui';

/**
 * Uploaded verification documents are private: GET /uploads/:name needs the Authorization header,
 * so a plain <a href> or <img src> would 401. Fetch as a blob and show it from an object URL.
 */
export function DocumentViewer({ docs, initial = 0, onClose, title }: { docs: BadgeDocument[]; initial?: number; onClose: () => void; title?: string }) {
  const [index, setIndex] = useState(initial);
  const doc = docs[index];
  const [state, setState] = useState<{ url?: string; type?: string; error?: unknown; loading: boolean }>({ loading: true });

  useEffect(() => {
    let objectUrl: string | undefined;
    let cancelled = false;
    setState({ loading: true });
    if (!doc) return;
    if (!doc.url.includes('/uploads/')) {
      setState({ loading: false, error: new Error(`This document (${doc.url}) is not a FixAm upload, so it cannot be previewed. Seeded demo data uses placeholder paths.`) });
      return;
    }
    uploadsApi
      .fetchBlob(doc.url)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ loading: false, url: objectUrl, type: blob.type });
      })
      .catch((e) => !cancelled && setState({ loading: false, error: e }));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc]);

  return (
    <Modal
      title={title ?? 'Document'}
      size="wide"
      onClose={onClose}
      footer={
        <>
          {docs.length > 1 && (
            <>
              <Button disabled={index === 0} onClick={() => setIndex(index - 1)}>
                ← Previous
              </Button>
              <span className="muted small" style={{ alignSelf: 'center' }}>
                {index + 1} of {docs.length}
              </span>
              <Button disabled={index >= docs.length - 1} onClick={() => setIndex(index + 1)}>
                Next →
              </Button>
            </>
          )}
          {state.url && (
            <a className="btn" href={state.url} download={doc.url.split('/').pop()}>
              Download
            </a>
          )}
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {doc && (
        <div className="stack-sm">
          <div className="row-between">
            <strong>{docLabel(doc.type)}</strong>
            {doc.number && <span className="mono">No. {doc.number}</span>}
          </div>
          {state.loading && <Spinner label="Loading document…" />}
          {state.error !== undefined && <ErrorBox error={state.error} />}
          {state.url && state.type === 'application/pdf' && <iframe className="doc-frame" src={state.url} title={docLabel(doc.type)} />}
          {state.url && state.type?.startsWith('image/') && <img className="doc-img" src={state.url} alt={docLabel(doc.type)} />}
        </div>
      )}
    </Modal>
  );
}
