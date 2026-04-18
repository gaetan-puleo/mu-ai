import { useMemo } from 'react';
import { useChatContext } from '../../context/chat';
import { PickerModal } from '../chatLayout';

export function Pickers() {
  const { toggles, models, sessions, session } = useChatContext();
  const sessionItems = useMemo(
    () =>
      sessions.map((s) => ({
        label: s.preview,
        value: s.path,
        description: `${s.messageCount} msgs`,
      })),
    [sessions],
  );

  return (
    <>
      <PickerModal
        visible={toggles.showModelPicker}
        title="Select model"
        items={models.models.map((m) => ({ label: m.id, value: m.id }))}
        placeholder="Search models..."
        onSelect={(id) => {
          models.selectModel(id);
          toggles.onTogglePicker();
        }}
        onCancel={toggles.onTogglePicker}
      />
      <PickerModal
        visible={toggles.showSessionPicker}
        title={`Sessions · ${sessions[0]?.project ?? 'project'}`}
        items={sessionItems}
        placeholder="Search sessions..."
        emptyMessage="No sessions found for this project"
        onSelect={(p) => {
          session.onLoadSession(p);
          toggles.onToggleSessionPicker();
        }}
        onCancel={toggles.onToggleSessionPicker}
      />
    </>
  );
}
