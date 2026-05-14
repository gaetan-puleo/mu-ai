import { Box } from 'ink';
import { type Command, newMessage } from 'mu-core';
import { useEffect, useState } from 'react';
import type { SessionSummary } from '../../store';
import { useChordKeyboard } from '../hooks/useChordKeyboard';
import { useChatStatusSegments } from '../hooks/useStatusSegments';
import { useStreaming } from '../hooks/useStreaming';
import { useSubagentEvents } from '../hooks/useSubagentEvents';
import { useToasts } from '../hooks/useToasts';
import { useApp, useDispatch, useUi } from '../state/AppContext';
import { filterCommands } from './input/commandPicker';
import { InputBox } from './input/inputBox';
import { MessageList } from './messages/messageList';
import { ApprovalModal } from './modals/approvalModal';
import { ConfirmModal } from './modals/confirmModal';
import { InputModal } from './modals/inputModal';
import { ModelPickerModal } from './modals/modelPickerModal';
import { SelectModal } from './modals/selectModal';
import { SessionListModal } from './modals/sessionListModal';
import { SubagentBrowser } from './panels/subagentBrowser';
import { StatusBar } from './statusBar';
import { ToastLayer } from './toastLayer';

export interface AppProps {
  commands: () => readonly Command[];
  listSessions: () => SessionSummary[];
  switchSession: (id: string) => void;
  setModel: (model: string) => void;
}

type PickerState =
  | { kind: 'none' }
  | { kind: 'command'; partial: string; index: number }
  | { kind: 'mention'; partial: string; index: number };

export function App({ commands, listSessions, switchSession, setModel }: AppProps) {
  const { session, agents, submit } = useApp();
  const dispatch = useDispatch();
  const { messages, streaming, modal, panel, model } = useUi();

  useStreaming(session);
  useSubagentEvents(agents, session.id);
  useToasts();

  useEffect(() => {
    if (!agents) return;
    const update = (): void => {
      const a = agents.getActive(session);
      dispatch({ type: 'set_active_agent', name: a?.name });
    };
    update();
    return agents.onSwitch((event) => {
      if (event.sessionId === session.id) update();
    });
  }, [agents, session, dispatch]);

  const [picker, setPicker] = useState<PickerState>({ kind: 'none' });

  // Picker keyboard navigation.
  useChordKeyboard(
    {
      onArrowUp: () => {
        if (picker.kind !== 'none') setPicker({ ...picker, index: Math.max(0, picker.index - 1) });
      },
      onArrowDown: () => {
        if (picker.kind === 'command') {
          const matches = filterCommands(picker.partial, commands());
          setPicker({ ...picker, index: Math.min(matches.length - 1, picker.index + 1) });
        } else if (picker.kind === 'mention' && agents) {
          const matches = agents.getCompletions(picker.partial);
          setPicker({ ...picker, index: Math.min(matches.length - 1, picker.index + 1) });
        }
      },
      onEscape: () => {
        if (picker.kind !== 'none') setPicker({ kind: 'none' });
      },
    },
    picker.kind !== 'none' && !modal,
  );

  // Global keys (panel toggle).
  useChordKeyboard(
    {
      onTab: () => {
        if (picker.kind === 'none') dispatch({ type: 'panel_toggle', panel: 'subagent' });
      },
    },
    !modal && picker.kind === 'none',
  );

  const handleChange = (text: string): void => {
    if (text.startsWith('/')) {
      setPicker({ kind: 'command', partial: text.slice(1).split(' ')[0] ?? '', index: 0 });
    } else if (text.startsWith('@')) {
      setPicker({ kind: 'mention', partial: text.slice(1).split(' ')[0] ?? '', index: 0 });
    } else if (picker.kind !== 'none') {
      setPicker({ kind: 'none' });
    }
  };

  const handleSubmit = async (text: string): Promise<void> => {
    setPicker({ kind: 'none' });

    if (text.startsWith('/')) {
      const [head = '', ...rest] = text.slice(1).split(' ');

      // `/model` and `/sessions` are registered as real commands by the
      // mu-coding-tui plugin (see tui-start.ts) — no inline branches here.
      const cmd = commands().find((c) => c.name === head);
      if (!cmd) {
        await session.append(
          newMessage({
            role: 'system',
            content: `unknown command: /${head} (try /help)`,
            meta: { visibility: 'ui', transient: true },
          }),
        );
        return;
      }
      await cmd.execute(rest.join(' '), session);
      return;
    }

    await submit(text);
  };

  const statusSegments = useChatStatusSegments();

  return (
    <Box flexDirection="column">
      <StatusBar segments={statusSegments} />
      <Box flexDirection="row" flexGrow={1}>
        <Box flexDirection="column" flexGrow={1}>
          <MessageList messages={messages} streaming={streaming} />
        </Box>
        {panel === 'subagent' ? <SubagentBrowser /> : null}
      </Box>
      <ToastLayer />
      <InputBox
        onSubmit={handleSubmit}
        onChange={handleChange}
        disabled={!!modal}
        picker={
          picker.kind === 'none'
            ? undefined
            : { kind: picker.kind, partial: picker.partial, index: picker.index }
        }
        commands={commands()}
        agents={agents}
        model={model}
        streaming={!!streaming}
      />
      {modal ? (
        <ModalRoot
          modal={modal}
          listSessions={listSessions}
          switchSession={switchSession}
          setModel={setModel}
        />
      ) : null}
    </Box>
  );
}

function ModalRoot({
  modal,
  listSessions,
  switchSession,
  setModel,
}: {
  modal: NonNullable<ReturnType<typeof useUi>['modal']>;
  listSessions: () => SessionSummary[];
  switchSession: (id: string) => void;
  setModel: (model: string) => void;
}) {
  const dispatch = useDispatch();
  switch (modal.kind) {
    case 'approval':
      return <ApprovalModal req={modal.req} resolve={modal.resolve} />;
    case 'sessionList':
      return (
        <SessionListModal
          sessions={listSessions()}
          onSelect={(id) => {
            switchSession(id);
            dispatch({ type: 'modal_close' });
          }}
        />
      );
    case 'modelPicker':
      return (
        <ModelPickerModal
          models={modal.models}
          current={modal.current}
          onSelect={(m) => {
            // Update both: the external ProviderConfig (used by the next
            // session.run()) AND the UI state (status bar, future picker
            // `current` highlight). The two stores were drifting before
            // — `setModel` mutated config but never told React.
            setModel(m);
            dispatch({ type: 'set_model', model: m });
            dispatch({ type: 'modal_close' });
          }}
        />
      );
    case 'confirm':
      return <ConfirmModal title={modal.title} message={modal.message} resolve={modal.resolve} />;
    case 'select':
      return (
        <SelectModal
          title={modal.title}
          options={modal.options}
          placeholder={modal.placeholder}
          resolve={modal.resolve}
        />
      );
    case 'input':
      return <InputModal title={modal.title} placeholder={modal.placeholder} resolve={modal.resolve} />;
    default:
      return null;
  }
}
