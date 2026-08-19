/**
 * Last line of defence for a render that throws.
 *
 * A class component because that is still the only way to catch a render error
 * in React. It shows a recoverable state rather than a blank page, and never
 * shows the error text - a stack trace is not something to put in front of a
 * user.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Result } from 'antd';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <Result
        status="error"
        title="Something went wrong"
        subTitle="This screen could not be displayed. Reloading usually clears it."
        extra={
          <Button type="primary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
      />
    );
  }
}
