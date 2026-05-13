import { Box, Text } from 'ink';

/**
 * Vertical scrollbar primitive. Renders a 1-column-wide track with a
 * proportionally-sized thumb whose position reflects `scrollOffset`.
 *
 * Currently unused by the in-tree components — kept available for
 * future scrollable views (transcript, subagent browser, etc).
 */
export function Scrollbar({
  viewHeight,
  contentHeight,
  scrollOffset,
}: {
  viewHeight: number;
  contentHeight: number;
  scrollOffset: number;
}) {
  if (contentHeight <= viewHeight || viewHeight < 1) {
    return null;
  }
  const maxScroll = contentHeight - viewHeight;
  const ratio = maxScroll === 0 ? 0 : scrollOffset / maxScroll;
  const thumbSize = Math.max(1, Math.round((viewHeight / contentHeight) * viewHeight));
  const thumbPos = Math.round(ratio * (viewHeight - thumbSize));

  const track = Array.from({ length: viewHeight }, (_, i) => (i >= thumbPos && i < thumbPos + thumbSize ? '┃' : '│'));

  return (
    <Box flexDirection="column" flexShrink={0} width={1}>
      <Text>{track.join('')}</Text>
    </Box>
  );
}
