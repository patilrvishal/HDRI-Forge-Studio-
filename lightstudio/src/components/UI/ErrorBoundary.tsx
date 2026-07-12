import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React ErrorBoundary that catches runtime render errors and displays
 * a fallback UI instead of crashing the entire application.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            height: '100%',
            gap: 8,
            color: 'var(--text-dim)',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="1.5">
            <path d="M12 9v4M12 17h.01M5.07 19h13.86c1.55 0 2.57-1.64 1.87-3.04L13.87 4.64a2.09 2.09 0 00-3.74 0L3.2 15.96c-.7 1.4.32 3.04 1.87 3.04z" />
          </svg>
          <span style={{ fontSize: 10, textAlign: 'center', lineHeight: 1.4 }}>
            Render error occurred
          </span>
          <span
            style={{
              fontSize: 9,
              color: 'var(--danger)',
              fontFamily: 'var(--font-mono)',
              maxWidth: '90%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={this.state.error?.message}
          >
            {this.state.error?.message || 'Unknown error'}
          </span>
          <button
            onClick={this.handleRetry}
            style={{
              marginTop: 4,
              fontSize: 9,
              padding: '3px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--bg-input)',
              color: 'var(--text-sec)',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}