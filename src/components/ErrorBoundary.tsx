"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="p-3 text-red-400 text-[10px]">
            <p className="font-medium">Erro no componente</p>
            <pre className="mt-1 whitespace-pre-wrap break-all text-red-300">
              {this.state.error.message}
            </pre>
            <button
              className="btn-quiet mt-2 px-2 py-1 text-[10px]"
              onClick={() => this.setState({ error: null })}
            >
              Tentar novamente
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
