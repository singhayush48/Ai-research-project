import React from 'react';
import { AlertCircle, X } from 'lucide-react';

export default function ErrorBanner({ message, onRetry, onDismiss }) {
  if (!message) return null;
  return (
    <div className="error-banner" role="alert">
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <AlertCircle size={15} style={{ flexShrink: 0 }} />
        {message}
      </span>
      <span className="error-banner-actions">
        {onRetry && (
          <button className="btn btn-ghost btn-small" onClick={onRetry}>
            Retry
          </button>
        )}
        {onDismiss && (
          <button className="btn btn-ghost btn-small" onClick={onDismiss} aria-label="Dismiss">
            <X />
          </button>
        )}
      </span>
    </div>
  );
}
