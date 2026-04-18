import type { DOMElement } from 'ink';
import { measureElement, useStdout } from 'ink';
import { useEffect, useLayoutEffect, useState } from 'react';

export function useTerminalSize() {
  const { stdout } = useStdout();
  const [size, setSize] = useState({ width: stdout.columns, height: stdout.rows });
  useEffect(() => {
    const onResize = () => setSize({ width: stdout.columns, height: stdout.rows });
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);
  return size;
}

export function useMeasure(
  viewRef: React.RefObject<DOMElement | null>,
  contentRef: React.RefObject<DOMElement | null>,
  contentKey?: unknown,
) {
  const [viewHeight, setViewHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: contentKey triggers re-measure on content changes
  useLayoutEffect(() => {
    const timer = setTimeout(() => {
      if (viewRef.current) {
        setViewHeight(measureElement(viewRef.current).height);
      }
      if (contentRef.current) {
        setContentHeight(measureElement(contentRef.current).height);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [viewRef, contentRef, contentKey]);

  return { viewHeight, contentHeight };
}
