/**
 * React error boundary.
 *
 * A thrown render error must never leave a blank white page on a phone with no
 * console available. The boundary catches it, shows a recoverable screen, and offers
 * a reset that returns to the title without a full reload.
 *
 * Phaser scene exceptions are separate: they are caught in `GameLayer`'s async start
 * path and by Phaser's own loop, and surface through the same error screen.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorScreen } from '@/components/screens/ErrorScreen';

interface Props {
  children: ReactNode;
  /** Called when the player chooses to recover. */
  onReset?(): void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The stack is the only diagnostic available when this happens on a student's
    // phone, so log it verbatim rather than a summary.
    console.error('Unhandled UI error', error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <ErrorScreen
        message="画面の表示中にエラーが発生しました。タイトルに戻るか、再読み込みしてください。"
        detail={import.meta.env.DEV ? `${error.name}: ${error.message}` : null}
        onRetry={this.handleReset}
      />
    );
  }
}
