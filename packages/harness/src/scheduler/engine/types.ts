export type Schedule =
  | { kind: 'cron'; expr: string }
  | { kind: 'interval'; ms: number }
  | { kind: 'once'; at?: number };

export interface TaskResult {
  ok: boolean;
  output?: string;
  error?: string;
}

export interface Task {
  id: string;
  skill: string;
  prompt: string;
  agent?: string;
  schedule: Schedule;
  enabled: boolean;
  createdAt: number;
  lastRun?: number;
  lastResult?: TaskResult;
}

export type TaskInput =
  & Omit<Task, 'id' | 'enabled' | 'createdAt' | 'lastRun' | 'lastResult'>
  & { enabled?: boolean };

export type TaskRunner = (task: Task) => Promise<TaskResult>;

export interface TaskStore {
  list(): Promise<Task[]>;
  get(id: string): Promise<Task | undefined>;
  create(input: TaskInput): Promise<Task>;
  update(id: string, patch: Partial<Task>): Promise<Task | undefined>;
  remove(id: string): Promise<void>;
}
