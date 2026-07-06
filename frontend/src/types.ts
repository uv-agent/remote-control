export type Json = Record<string, unknown>;

export type ProjectInfo = {
  name?: string;
  path?: string;
};

export type RemoteConfig = {
  url?: string;
  host?: string;
  port?: number;
  auth_mode?: string;
  last_seq?: number;
  project?: ProjectInfo;
};

export type RemoteCapabilities = {
  limits?: {
    max_attachments?: number;
    max_file_bytes?: number;
    max_message_bytes?: number;
    sse_ring_max_events?: number;
    sse_ring_max_bytes?: number;
  };
  tui_features?: CapabilityFeature[];
  core?: CoreSummary;
};

export type CapabilityFeature = {
  id?: string;
  label?: string;
  status?: string;
  detail?: string;
};

export type CoreSummary = {
  agent_api?: boolean;
  models?: ModelSummary;
  pickers?: Record<string, PickerSummary>;
};

export type ModelSummary = {
  available?: boolean;
  default_level?: string;
  levels?: ModelLevelSummary[];
};

export type ModelLevelSummary = {
  id?: string;
  label?: string;
  model?: string;
  model_name?: string;
  provider?: string;
  api?: string;
  context_window_tokens?: number;
  supports_images?: boolean | null;
  provider_configured?: boolean;
  status?: string;
  is_default?: boolean;
};

export type PickerSummary = {
  available?: boolean;
  plugin?: string;
  id?: string;
  title?: string | Record<string, string>;
  trigger?: string;
  total?: number;
  items?: PickerItemSummary[];
};

export type PickerItemSummary = {
  id?: string;
  value?: string;
  description?: string;
  kind?: string;
  meta?: string;
};

export type Thread = {
  thread_id: string;
  title?: string;
  updated_at?: string;
  status?: string;
  active_model?: string;
  active_level?: string;
  turn_count?: number;
  last_text?: string;
};

export type TimelineEvent = Json & {
  _event_id?: number | string;
  thread_id?: string;
  type?: string;
  item?: Json;
  output?: unknown;
  text?: string;
  delta?: string;
  reasoning_text?: string;
  message?: string;
  title?: string;
  name?: string;
  tool_name?: string;
  call_id?: string;
  created_at?: string;
  timestamp?: string;
  attempt?: string | number;
  attachment?: {
    filename?: string;
    token?: string;
    canonical_token?: string;
  };
};

export type AttachmentDraft = {
  id: string;
  file: File;
  kind: "image" | "file";
  token: string;
  slot: number | null;
  filename: string;
  mime_type: string;
};

export type Status = {
  label: string;
  className: "running" | "done" | "error" | "muted";
};

export type InfoTab = "overview" | "events" | "attachments" | "status";
export type EventFilter = "all" | "message" | "tool" | "system" | "attachment";
export type ThemeName = "deep" | "light";
export type ThreadFilter = "all" | "running" | "done" | "attention";
export type DisplayRole = "user" | "assistant" | "reasoning" | "tool" | "system" | "error";

export type DisplayMessage = {
  kind: "message";
  key: string;
  role: DisplayRole;
  label: string;
  text: string;
  time?: string;
  occurredAt?: number;
};

export type DisplayItem = DisplayMessage;

export type TurnGroupModel = {
  key: string;
  user?: DisplayMessage;
  items: DisplayItem[];
};

export type ActivityDigest = {
  total: number;
  messages: number;
  executions: number;
  materials: number;
  contexts: number;
};

export type ActivityEntry = {
  key: string;
  category: EventFilter;
  title: string;
  body: string;
  meta: string;
};

export type MaterialEntry = {
  key: string;
  kind: "image" | "file";
  name: string;
  token: string;
  state: "待发送" | "已提交";
  context: string;
  hint: string;
  pending: boolean;
};
