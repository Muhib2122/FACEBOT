import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected error occurred.',
    };
  }

  componentDidCatch(error: Error) {
    console.error('FaceBot ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      let friendlyText = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message);
        if (parsed?.error) {
          friendlyText = `Cloud database error (${parsed.operationType || 'sync'} on ${parsed.path || 'workspace'}): ${parsed.error}`;
        }
      } catch {
        // plain string message
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2.5 text-red-700">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="text-sm font-semibold">FaceBot Cloud Sync Notice</h2>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed break-words">
              {friendlyText}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reload Portal
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
