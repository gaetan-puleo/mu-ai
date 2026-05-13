import { Box, Text, useInput } from 'ink';
import type { ApprovalDecision, ApprovalRequest } from 'mu-agents';
import { useDispatch } from '../../state/AppContext';
import { useTheme } from '../../theme/ThemeContext';
import { Modal } from '../primitives/modal';

export interface ApprovalModalProps {
  req: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
}

export function ApprovalModal({ req, resolve }: ApprovalModalProps) {
  const theme = useTheme();
  const dispatch = useDispatch();

  const decide = (decision: ApprovalDecision): void => {
    resolve(decision);
    dispatch({ type: 'modal_close' });
  };

  useInput((input) => {
    const ch = input.toLowerCase();
    if (ch === 'y') decide({ outcome: 'approve' });
    else if (ch === 'n') decide({ outcome: 'deny' });
    else if (ch === 'a') decide({ outcome: 'approve', remember: true });
  });

  return (
    <Modal title="Approval required" width={70} footer="[y]es  [n]o  [a]llow always (this session)">
      <Box flexDirection="column">
        <Row label="agent" value={req.agentName} valueColor={theme.colors.agentBadge} />
        <Row label="tool" value={req.toolName} valueColor={theme.colors.tool} />
        <Row label="rule" value={req.matchedRule} />
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>args</Text>
          <Text>{JSON.stringify(req.args, null, 2)}</Text>
        </Box>
      </Box>
    </Modal>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <Box flexDirection="row">
      <Box width={8}>
        <Text dimColor>{label}</Text>
      </Box>
      <Text color={valueColor}>{value}</Text>
    </Box>
  );
}
