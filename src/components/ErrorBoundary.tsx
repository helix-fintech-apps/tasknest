import { Component, type ReactNode } from "react";
import { Button } from "./ui/Button";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          data-testid="page-error"
          className="rounded-lg border border-danger/30 bg-danger-bg p-4 text-sm text-danger"
        >
          <p className="mb-2 font-semibold">Something went wrong on this page</p>
          <p className="mb-3">{this.state.error.message}</p>
          <Button variant="secondary" size="sm" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
