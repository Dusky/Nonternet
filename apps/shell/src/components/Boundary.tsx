import { Component, type ErrorInfo, type ReactNode } from 'react';
import { en } from '@app/strings';
import { isChunkLoadError, reloadFresh, reloadForUpdate } from '../chunkError';

// One app crashing must not take the rest of the shell with it. This catches an error while an app draws,
// says so plainly, and offers to start that app again. It sits outside the translation context on purpose
// (it must work even if that is what broke), so it reads the English strings directly.
export class AppBoundary extends Component<{ children: ReactNode; label?: string }, { failed: boolean; round: number; updated: boolean }> {
  state = { failed: false, round: 0, updated: false };
  static getDerivedStateFromError(error: unknown) { return { failed: true, updated: isChunkLoadError(error) }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('An app failed to draw:', error, info.componentStack);
    // The site was updated under this page: start fresh once, on our own, rather than wait to be asked.
    if (isChunkLoadError(error)) reloadForUpdate();
  }
  render() {
    if (this.state.failed) {
      // The site was updated while this page was open: the app's file is gone. Reloading the page is the fix; trying the app again is not.
      if (this.state.updated) {
        return (
          <div className="empty" role="alert">
            <p>{en['boundary.updated']}</p>
            <button type="button" className="btn btn-primary" onClick={reloadFresh}>{en['boundary.reloadPage']}</button>
          </div>
        );
      }
      return (
        <div className="empty" role="alert">
          <p>{en['boundary.failed']}</p>
          <button type="button" className="btn" onClick={() => this.setState((s) => ({ failed: false, round: s.round + 1 }))}>{en['boundary.reload']}</button>
        </div>
      );
    }
    // A new key after "reload" makes the app start from scratch rather than draw the same broken state.
    return <div key={this.state.round} className="boundary">{this.props.children}</div>;
  }
}
