import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div role="alert" data-testid="page-error" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Something went wrong on this page: {this.state.error.message}
          <button className="ml-3 underline" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
