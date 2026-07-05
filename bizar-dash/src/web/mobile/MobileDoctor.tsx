// src/web/mobile/MobileDoctor.tsx — v5.4 mobile doctor health view with 30s auto-refresh.
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import type { DoctorStatus, DoctorCheck } from '../lib/types';

type HealthResponse = {
  status: DoctorStatus;
  issues: DoctorCheck[];
};

const REFRESH_INTERVAL_MS = 30_000;

export function MobileDoctor() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch_ = () => {
      api.get<HealthResponse>('/doctor/health')
        .then((r) => {
          setData(r);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    };
    fetch_();
    const id = setInterval(fetch_, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <div className="mobile-loading">
        <p>Running health checks…</p>
      </div>
    );
  }

  const status: DoctorStatus = data?.status ?? 'fail';
  const issues: DoctorCheck[] = data?.issues ?? [];

  return (
    <div className="mobile-doctor">
      <div className={`mobile-doctor-status is-${status}`}>
        {status === 'ok' && <CheckCircle2 size={48} />}
        {status === 'warn' && <AlertTriangle size={48} />}
        {status === 'fail' && <XCircle size={48} />}
        <div className="mobile-doctor-status-text">{status.toUpperCase()}</div>
        <div className="mobile-doctor-status-sub">Auto-refreshes every 30s</div>
      </div>

      {issues.length > 0 && (
        <div className="mobile-doctor-issues">
          <h3>Issues ({issues.length})</h3>
          {issues.map((i, idx) => (
            <div key={idx} className={`mobile-doctor-issue is-${i.status}`}>
              {i.status === 'warn' ? (
                <AlertTriangle size={16} />
              ) : (
                <XCircle size={16} />
              )}
              <div>
                <div className="mobile-doctor-issue-name">{i.name}</div>
                <div className="mobile-doctor-issue-msg">{i.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {status === 'ok' && issues.length === 0 && (
        <div className="mobile-doctor-ok">
          <CheckCircle2 size={24} />
          <p>All systems healthy.</p>
        </div>
      )}
    </div>
  );
}
