import { Box, Text, useInput } from 'ink';
import type { ApprovalDecision, ApprovalRequest } from 'mu-agents';
import type React from 'react';

export interface ApprovalModalProps {
  request: ApprovalRequest;
  onDecide: (decision: ApprovalDecision) => void;
}

function prettyArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

/**
 * Modal rendered above the prompt while a tool call is awaiting approval.
 *
 * Key bindings:
 *   y / Enter — approve once
 *   a         — approve for this session (mu-agents remembers the rule until
 *               the session ends; see ApprovalGateway.clearSession)
 *   n / Esc   — deny
 *
 * The component is purely presentational — it does not own the pending
 * request. The parent (`Chat`) is responsible for clearing the modal after
 * `onDecide` fires.
 */
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

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
      <Box marginBottom={1}>
        <Text bold={true} color="yellow">
          Approve tool call?
        </Text>
      </Box>
      <Text>
        <Text dimColor={true}>agent : </Text>
        <Text>{request.agentName}</Text>
      </Text>
      <Text>
        <Text dimColor={true}>tool : </Text>
        <Text>{request.toolName}</Text>
      </Text>
      <Text>
        <Text dimColor={true}>rule : </Text>
        <Text>"{request.matchedRule}"</Text>
      </Text>
      <Box marginTop={1} marginBottom={1} flexDirection="column">
        <Text dimColor={true}>args:</Text>
        <Text>{prettyArgs(request.args)}</Text>
      </Box>
      <Text>
        <Text color="green">[y]</Text> approve once {'  '}
        <Text color="cyan">[a]</Text> approve for this session {'  '}
        <Text color="red">[n]</Text> deny
      </Text>
    </Box>
  );
}
