import { Box, Text, useInput } from 'ink';
import type { ApprovalDecision, ApprovalRequest, ArgLine } from 'mu-agents';
import type React from 'react';

export interface ApprovalModalProps {
  request: ApprovalRequest;
  onDecide: (decision: ApprovalDecision) => void;
}

function trunc(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function fallbackFormat(args: Record<string, unknown>): ArgLine[] {
  return Object.entries(args).map(([label, val]) => ({
    label,
    value: trunc(typeof val === 'string' ? val : JSON.stringify(val), 80),
  }));
}

export function ApprovalModal({ request, onDecide }: ApprovalModalProps): React.ReactElement {
  useInput((input, key) => {
    if (key.return || input === 'y' || input === 'Y') {
      onDecide({ outcome: 'approve' });
      return;
    }
    if (input === 'a' || input === 'A') {
      onDecide({ outcome: 'approve', remember: true });
      return;
    }
    if (key.escape || input === 'n' || input === 'N') {
      onDecide({ outcome: 'deny' });
    }
  });

  const lines = request.argLines ?? fallbackFormat(request.args);

  return (
    <Box
      flexShrink={0}
      flexDirection="column"
      width="100%"
      borderStyle="round"
      borderColor="yellow"
      borderBackgroundColor="#0a0a0a"
      paddingX={1}
    >
      <Box gap={1}>
        <Text color="#ffffff" bold={true}>
          ⚠
        </Text>
        <Text color="#e0e0e0">
          <Text>{request.agentName}</Text>
          <Text> / </Text>
          <Text color="#ffffff" bold={true}>
            {request.toolName}
          </Text>
        </Text>
      </Box>
      {lines.map((line) => (
        <Box key={line.label}>
          <Text color="#e0e0e0">
            <Text dimColor={true}>{line.label}: </Text>
            {line.value}
          </Text>
        </Box>
      ))}
      <Box marginTop={1} gap={2}>
        <Text>
          <Text color="#ffffff" bold={true}>
            [y]
          </Text>
          <Text color="#e0e0e0"> approve</Text>
        </Text>
        <Text>
          <Text color="#ffffff" bold={true}>
            [a]
          </Text>
          <Text color="#e0e0e0"> session</Text>
        </Text>
        <Text>
          <Text color="#ffffff" bold={true}>
            [n]
          </Text>
          <Text color="#e0e0e0"> deny</Text>
        </Text>
      </Box>
    </Box>
  );
}
