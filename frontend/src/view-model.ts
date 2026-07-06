import type {
  ActivityDigest,
  ActivityEntry,
  AttachmentDraft,
  CapabilityFeature,
  DisplayItem,
  DisplayMessage,
  EventFilter,
  Json,
  MaterialEntry,
  ModelLevelSummary,
  PickerItemSummary,
  PickerSummary,
  ProjectInfo,
  RemoteCapabilities,
  RemoteConfig,
  Status,
  Thread,
  ThreadFilter,
  TimelineEvent,
  TurnGroupModel,
} from "./types";
import { CONFLICT_LABELS, LEVEL_LABELS, LEVEL_OPTIONS, THREAD_FILTER_OPTIONS } from "./constants";

export function displayItemForEvent(event: TimelineEvent, fallback: string): DisplayItem | null {
  const key = displayEventKey(event, fallback);
  const occurredAt = displayEventTime(event);
  if (isUserDisplayEvent(event)) {
    return { kind: "message", key, role: "user", label: "你", text: userTextForEvent(event), time: eventTimeLabel(event), occurredAt };
  }
  if (isAssistantFinalEvent(event)) {
    const text = assistantTextForEvent(event);
    return { kind: "message", key, role: "assistant", label: "回复", text, time: eventTimeLabel(event), occurredAt };
  }
  if (isReasoningEvent(event)) {
    return { kind: "message", key, role: "reasoning", label: "工作过程", text: event.text || event.reasoning_text || "", time: eventTimeLabel(event), occurredAt };
  }
  if (event.type === "tool.started" || event.type === "tool.partial") return null;
  if (event.type === "tool.output" || event.type === "item.tool_output") {
    return { kind: "message", key, role: "tool", label: "执行记录", text: toolOutputText(event), time: eventTimeLabel(event), occurredAt };
  }
  if (event.type === "model.stream_retry") return null;
  if (event.type === "compaction.started" || event.type === "compaction.completed" || event.type === "item.compaction") return null;
  if (event.type === "item.image_attachment") {
    return { kind: "message", key, role: "system", label: "图片", text: event.attachment?.filename || event.attachment?.token || "图片素材", time: eventTimeLabel(event), occurredAt };
  }
  if (event.type === "item.file_attachment") {
    return { kind: "message", key, role: "system", label: "文件", text: event.attachment?.filename || event.attachment?.token || "文件素材", time: eventTimeLabel(event), occurredAt };
  }
  if (event.type === "turn.error") {
    return { kind: "message", key, role: "error", label: "运行失败", text: event.message || "操作失败", time: eventTimeLabel(event), occurredAt };
  }
  return null;
}

export function displayEventKey(event: TimelineEvent, fallback: string) {
  const id = event._event_id ?? event.event_id ?? event.sequence ?? fallback;
  return `display-${String(id)}`;
}

export function eventTurnKey(event: TimelineEvent, fallback: string) {
  return String(event.turn_id || event.run_id || event.response_id || event.thread_id || fallback);
}

export function isUserDisplayEvent(event: TimelineEvent) {
  return event.type === "item.user" || event.type === "turn.submitted";
}

export function isAssistantDeltaEvent(event: TimelineEvent) {
  return [
    "response.output_text.delta",
    "assistant.delta",
    "assistant.message.delta",
    "item.assistant_partial",
  ].includes(String(event.type || ""));
}

export function isAssistantFinalEvent(event: TimelineEvent) {
  return [
    "item.model_response",
    "item.assistant",
    "assistant.message.completed",
    "assistant.completed",
    "response.output_text.done",
  ].includes(String(event.type || ""));
}

export function isReasoningEvent(event: TimelineEvent) {
  return [
    "assistant.reasoning_delta",
    "assistant.reasoning_completed",
    "item.reasoning_partial",
    "item.reasoning",
  ].includes(String(event.type || ""));
}

export function groupDisplayItems(items: DisplayItem[]) {
  const groups: TurnGroupModel[] = [];
  let current: TurnGroupModel | null = null;
  for (const item of items) {
    if (item.kind === "message" && item.role === "user") {
      current = { key: `turn-${item.key}`, user: item, items: [] };
      groups.push(current);
      continue;
    }
    if (!current) {
      current = { key: `standalone-${item.key}`, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups;
}

export function isProcessDisplayItem(item: DisplayItem) {
  return item.kind === "message" && (item.role === "reasoning" || item.role === "tool");
}

export function processDigestSummary(toolCount: number, reasoningCount: number) {
  const parts = [];
  if (reasoningCount) parts.push(`${reasoningCount} 步分析`);
  if (toolCount) parts.push(`${toolCount} 次执行`);
  return parts.length ? parts.join(" · ") : "正在整理";
}

export function processWorkLabel(items: DisplayMessage[]) {
  const times = items.map((item) => item.occurredAt || 0).filter(Boolean).sort((a, b) => a - b);
  if (times.length >= 2) {
    const duration = Math.max(0, (times.at(-1) || 0) - times[0]);
    if (duration >= 1000) return `已工作 ${formatShortDuration(duration)}`;
  }
  const latest = items.at(-1)?.time;
  return latest || "已整理";
}

export function formatShortDuration(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.max(1, Math.round(minutes / 60))} 小时`;
}

export function threadRunTitle(thread: Thread | null, status: Status) {
  if (!thread) return "准备开始新任务";
  if (status.className === "running") return "运行中";
  if (status.className === "error") return "待处理";
  if (status.label === "已停止") return "已停止";
  return status.className === "done" ? "已完成" : "就绪";
}

export function threadRunDetail(thread: Thread | null, status: Status, level: string) {
  if (!thread) return "输入消息后会创建新的线程";
  const model = thread.active_model || "模型未指定";
  const levelText = level ? levelLabel(level) : "默认档位";
  if (status.className === "running") return `${model} · ${levelText}`;
  if (status.className === "error") return "打开活动查看原因";
  if (status.label === "已停止") return "可以继续输入";
  const updated = thread.updated_at ? ` · 更新于 ${formatRelativeTime(thread.updated_at)}` : "";
  return `${model}${updated}`;
}

export function taskProgressText(thread: Thread | null, status: Status, visibleEventCount: number) {
  if (!thread) return "发送第一条消息后会创建任务";
  if (status.className === "running") return "正在执行，新的活动会自动同步";
  if (status.className === "error") return "需要处理最近一次运行结果";
  if (status.label === "已停止") return "已接管，可以继续输入下一步";
  if (visibleEventCount) return `${visibleEventCount} 条进展已整理`;
  return "等待下一次提交";
}

export function runtimeSummary(config: RemoteConfig | null, state: ReturnType<typeof connectionState>) {
  if (!config) return "等待远程服务提供入口";
  if (state.className === "done") return "浏览器会话已连接到远程服务";
  if (state.className === "running") return "正在同步远程服务状态";
  if (state.className === "error") return "连接中断，页面会保留本地缓存";
  return "远程入口已准备";
}

export function composerTitle(thread: Thread | null, status: Status) {
  if (!thread) return "新任务";
  if (status.className === "running") return "任务运行中";
  if (status.className === "error") return "继续修复";
  return "继续这条任务线";
}

export function composerFocusDetail(thread: Thread | null, level: string, conflict: string) {
  if (!thread) return "发送后创建线程";
  const pieces = [
    thread.active_model || "",
    level ? levelLabel(level) : "",
    conflictLabel(conflict),
  ].filter(Boolean);
  return pieces.join(" · ") || "准备继续";
}

export function composerHint(thread: Thread | null, status: Status, attachments: number) {
  if (attachments) return `${attachments} 个素材会随本轮发送`;
  if (!thread) return "发送后会创建线程";
  if (status.className === "running") return "可以排队、询问或接管";
  if (thread.updated_at) return `上次更新 ${formatRelativeTime(thread.updated_at)}`;
  return "输入下一步指令";
}

export function composerStateLabel(status: Status, hasDraft: boolean) {
  if (status.className === "running") return "运行中";
  if (hasDraft) return "有草稿";
  if (status.className === "error") return "待处理";
  return "就绪";
}

export function composerPlaceholder(thread: Thread | null, attachments: number) {
  if (attachments) return "描述这批素材的处理方式";
  if (!thread) return "初始化任务";
  return "提出后续修改要求";
}

export function foldLabel(item: DisplayMessage) {
  if (item.role === "reasoning") return "分析";
  if (item.role === "tool") return "执行";
  if (item.role === "error") return "需要处理";
  return item.label;
}

export function shouldFoldText(text: string, maxChars = 520, maxLines = 8) {
  return text.length > maxChars || text.split(/\r?\n/).length > maxLines;
}

export function textPreview(text: string, max = 120) {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function previewText(text: string, max = 120) {
  return textPreview(stripMarkdownMarkers(text), max);
}

export function stripMarkdownMarkers(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1");
}

export function mergeEventsMap(previous: Map<string, TimelineEvent[]>, threadId: string, events: TimelineEvent[]) {
  if (!events.length) return previous;
  const next = new Map(previous);
  const byId = new Map((next.get(threadId) || []).map((event) => [event._event_id, event]));
  for (const event of events) byId.set(event._event_id, event);
  next.set(threadId, [...byId.values()].sort((a, b) => Number(a._event_id || 0) - Number(b._event_id || 0)));
  return next;
}

export function isLiveTimelineEvent(event: TimelineEvent) {
  return [
    "tool.started",
    "tool.partial",
    "tool.output",
    "model.stream_retry",
    "judge.started",
    "judge.completed",
    "compaction.started",
    "compaction.completed",
    "assistant.reasoning_completed",
    "assistant.message.completed",
    "assistant.completed",
    "response.output_text.done",
    "item.assistant",
    "turn.submitted",
    "turn.started",
    "turn.completed",
    "turn.interrupted",
    "turn.error",
  ].includes(String(event.type || ""));
}

export function normalizeThreadFilter(value: string): ThreadFilter {
  return THREAD_FILTER_OPTIONS.some((option) => option.value === value) ? value as ThreadFilter : "all";
}

export function countThreadsByFilter(threads: Thread[], eventsByThread: Map<string, TimelineEvent[]>, liveEvents: TimelineEvent[]): Record<ThreadFilter, number> {
  const counts: Record<ThreadFilter, number> = { all: threads.length, running: 0, done: 0, attention: 0 };
  for (const thread of threads) {
    const status = statusForThread(thread, eventsByThread, liveEvents);
    if (threadMatchesFilter(thread, status, "running")) counts.running += 1;
    if (threadMatchesFilter(thread, status, "done")) counts.done += 1;
    if (threadMatchesFilter(thread, status, "attention")) counts.attention += 1;
  }
  return counts;
}

export function filterThreads(threads: Thread[], query: string, filter: ThreadFilter, eventsByThread: Map<string, TimelineEvent[]>, liveEvents: TimelineEvent[]) {
  const value = query.toLowerCase();
  return threads.filter((thread) => {
    const haystack = `${thread.title || ""} ${thread.last_text || ""} ${thread.thread_id || ""}`.toLowerCase();
    const status = statusForThread(thread, eventsByThread, liveEvents);
    return (!value || haystack.includes(value)) && threadMatchesFilter(thread, status, filter);
  });
}

export function threadMatchesFilter(_thread: Thread, status: Status, filter: ThreadFilter) {
  if (filter === "all") return true;
  if (filter === "running") return status.className === "running";
  if (filter === "done") return status.className === "done";
  if (filter === "attention") return status.className === "error" || status.label === "已停止";
  return true;
}

export function compareThreads(a: Thread, b: Thread) {
  return dateValue(b.updated_at) - dateValue(a.updated_at);
}

export function projectUpdatedAt(threads: Thread[]) {
  const latest = threads.reduce((max, thread) => Math.max(max, dateValue(thread.updated_at)), 0);
  return latest ? new Date(latest).toISOString() : "";
}

export function statusForThread(thread: Thread | null, eventsByThread: Map<string, TimelineEvent[]>, liveEvents: TimelineEvent[]): Status {
  if (!thread) return { label: "草稿", className: "muted" };
  const liveTerminal = liveEvents
    .filter((event) => event.thread_id === thread.thread_id && ["turn.started", "turn.completed", "turn.interrupted", "turn.error"].includes(String(event.type || "")))
    .at(-1);
  if (liveTerminal?.type === "turn.started") return { label: "运行中", className: "running" };
  if (liveTerminal?.type === "turn.error") return { label: "失败", className: "error" };
  if (liveTerminal?.type === "turn.interrupted") return { label: "已停止", className: "muted" };
  if (liveTerminal?.type === "turn.completed") return { label: "已完成", className: "done" };
  const rawStatus = String(thread.status || "").toLowerCase();
  if (["running", "in_progress", "active"].includes(rawStatus)) return { label: "运行中", className: "running" };
  if (["failed", "failure", "error"].includes(rawStatus)) return { label: "失败", className: "error" };
  if (["interrupted", "cancelled", "canceled", "stopped"].includes(rawStatus)) return { label: "已停止", className: "muted" };
  if (["completed", "complete", "done", "merged"].includes(rawStatus)) return { label: "已完成", className: "done" };
  const events = eventsByThread.get(thread.thread_id) || [];
  const lastTerminal = [...events].reverse().find((event) => ["turn.completed", "turn.interrupted", "turn.error"].includes(String(event.type || "")));
  if (lastTerminal?.type === "turn.error") return { label: "失败", className: "error" };
  if (lastTerminal?.type === "turn.interrupted") return { label: "已停止", className: "muted" };
  if (lastTerminal?.type === "turn.completed" || (thread.turn_count || 0) > 0) return { label: "已完成", className: "done" };
  return { label: "就绪", className: "muted" };
}

export function threadCardMeta(thread: Thread, events: TimelineEvent[], status: Status) {
  const parts = [];
  if (thread.active_model) parts.push(thread.active_model);
  if (thread.active_level) parts.push(levelLabel(thread.active_level));
  if (thread.turn_count) parts.push(`${thread.turn_count} 轮`);
  if (!parts.length && thread.last_text) parts.push(thread.last_text);
  if (!parts.length) parts.push(status.label);
  return parts.join(" · ");
}

export function activityDigest(events: TimelineEvent[]): ActivityDigest {
  let messages = 0;
  let executions = 0;
  let materials = 0;
  let contexts = 0;
  for (const event of events) {
    const category = eventCategory(event);
    if (category === "message") messages += 1;
    else if (category === "tool") executions += 1;
    else if (category === "attachment") materials += 1;
    else contexts += 1;
  }
  return {
    total: events.length,
    messages,
    executions,
    materials,
    contexts,
  };
}

export function activityDigestTitle(digest: ActivityDigest) {
  if (!digest.total) return "等待任务活动";
  if (digest.executions) return "执行步骤已同步";
  if (digest.messages > 1) return "对话已更新";
  return "任务已有记录";
}

export function activityDigestBody(digest: ActivityDigest) {
  if (!digest.total) return "提交消息后，这里会按时间整理消息、执行、素材和上下文活动。";
  const parts = [`${digest.total} 条活动`];
  if (digest.messages) parts.push(`${digest.messages} 条对话`);
  if (digest.executions) parts.push(`${digest.executions} 次执行`);
  if (digest.materials) parts.push(`${digest.materials} 个素材`);
  if (digest.contexts) parts.push(`${digest.contexts} 条运行更新`);
  return parts.join(" · ");
}

export function materialSummaryText(pending: number, committed: number, images: number, files: number) {
  const parts = [];
  if (pending) parts.push(`${pending} 个待发送`);
  if (committed) parts.push(`${committed} 个已提交`);
  if (images) parts.push(`${images} 张图片`);
  if (files) parts.push(`${files} 个文件`);
  return parts.length ? `${parts.join(" · ")}。` : "素材会在发送时上传；输入框 token 是唯一绑定入口。";
}

export function activityEntryForEvent(event: TimelineEvent, index: number): ActivityEntry {
  const category = eventCategory(event);
  const key = String(event._event_id ?? `${event.type || "event"}-${event.created_at || event.timestamp || index}`);
  if (category === "message") {
    const isUser = isUserDisplayEvent(event);
    const text = isUser ? userTextForEvent(event) : assistantTextForEvent(event);
    return {
      key,
      category,
      title: isUser ? "新的输入" : "回复已更新",
      body: compactText(stripMarkdownMarkers(text), 140) || (isUser ? "用户提交了一轮任务" : "任务产出了新的回复"),
      meta: eventTimeLabel(event),
    };
  }
  if (category === "attachment") {
    const token = event.attachment?.token || event.attachment?.canonical_token || "";
    const filename = event.attachment?.filename || "";
    return {
      key,
      category,
      title: event.type === "item.image_attachment" ? "图片已加入" : "文件已加入",
      body: filename || token || "素材已加入任务",
      meta: token || eventTimeLabel(event),
    };
  }
  if (category === "tool") {
    const name = String(event.name || event.tool_name || "");
    return {
      key,
      category,
      title: "执行完成",
      body: name ? `${name} 已返回结果` : "执行结果已同步到任务详情",
      meta: eventTimeLabel(event),
    };
  }
  return {
    key,
    category,
    title: event.type === "turn.error" ? "运行失败" : "运行更新",
    body: compactText(String(event.message || event.title || eventSummary(event) || ""), 140) || "上下文状态已更新",
    meta: eventTimeLabel(event),
  };
}

export function materialEntries(events: TimelineEvent[], attachments: AttachmentDraft[]): MaterialEntry[] {
  const pending = attachments.map((attachment) => ({
    key: `draft-${attachment.id}`,
    kind: attachment.kind,
    name: attachment.filename,
    token: attachment.token,
    state: "待发送" as const,
    context: attachment.kind === "image" ? "发送时进入模型上下文" : "发送时生成文件引用",
    hint: attachment.mime_type || "发送时上传",
    pending: true,
  }));
  const committed = attachmentEvents(events).map((item, index) => ({
    key: `event-${item.token || item.filename || index}`,
    kind: item.kind,
    name: item.filename || item.token || "素材",
    token: item.token,
    state: "已提交" as const,
    context: item.kind === "image" ? "图片内容已进入模型上下文" : "文件以引用形式进入任务说明",
    hint: item.kind === "image" ? "模型可直接理解图片内容" : "提交时已生成引用",
    pending: false,
  }));
  return [...pending, ...committed.reverse()];
}

export function attachmentEvents(events: TimelineEvent[]): Array<{ kind: "image" | "file"; token: string; filename: string }> {
  return events
    .filter((event) => event.type === "item.image_attachment" || event.type === "item.file_attachment")
    .map((event) => ({
      kind: event.type === "item.image_attachment" ? "image" : "file",
      token: event.attachment?.token || event.attachment?.canonical_token || "",
      filename: event.attachment?.filename || "",
    }));
}

export function eventCategory(event: TimelineEvent): EventFilter {
  if (event.type === "item.image_attachment" || event.type === "item.file_attachment") return "attachment";
  if (isUserDisplayEvent(event) || isAssistantFinalEvent(event)) return "message";
  if (event.type?.startsWith("tool.") || event.type === "item.tool_output") return "tool";
  return "system";
}

export function isProductEvent(event: TimelineEvent) {
  return ![
    "tool.started",
    "tool.partial",
    "model.stream_retry",
    "response.output_text.delta",
    "assistant.delta",
    "assistant.message.delta",
    "assistant.reasoning_delta",
    "item.assistant_partial",
    "item.reasoning_partial",
    "compaction.started",
    "compaction.completed",
    "item.compaction",
    "turn.started",
    "turn.completed",
    "turn.interrupted",
  ].includes(String(event.type || ""));
}

export function eventSummary(event: TimelineEvent) {
  if (isUserDisplayEvent(event)) return userTextForEvent(event).slice(0, 160);
  if (isAssistantFinalEvent(event)) return assistantTextForEvent(event).slice(0, 160);
  if (event.type === "tool.started") return event.name || event.tool_name || "准备运行工具";
  if (event.type === "tool.output" || event.type === "item.tool_output") return toolOutputText(event).slice(0, 160);
  if (event.type === "item.image_attachment" || event.type === "item.file_attachment") return event.attachment?.filename || event.attachment?.token || event.attachment?.canonical_token || "附件";
  if (event.type === "turn.started") return "运行中";
  if (event.type === "turn.completed") return "已完成";
  if (event.type === "turn.interrupted") return "已停止";
  if (event.type === "compaction.started") return "正在整理上下文";
  if (event.type === "compaction.completed" || event.type === "item.compaction") return "上下文已整理";
  if (event.message) return String(event.message).slice(0, 160);
  if (event.title) return String(event.title).slice(0, 160);
  return formatRelativeTime(event.created_at || event.timestamp || "") || "";
}

export function eventLabel(event: TimelineEvent) {
  if (isUserDisplayEvent(event)) return "用户消息";
  if (isAssistantFinalEvent(event)) return "回复已更新";
  if (isReasoningEvent(event)) return "思考过程";
  if (event.type === "tool.started") return "工具准备";
  if (event.type === "tool.output" || event.type === "item.tool_output" || event.type === "tool.partial") return "执行结果";
  if (event.type === "item.image_attachment" || event.type === "item.file_attachment") return "素材";
  if (event.type?.startsWith("compaction.") || event.type === "item.compaction") return "上下文";
  if (event.type === "turn.error") return "运行失败";
  if (event.type?.startsWith("turn.")) return "运行状态";
  if (event.type === "model.stream_retry") return "模型连接";
  if (event.type?.startsWith("thread.")) return "线程更新";
  return "活动";
}

export function eventTimeLabel(event: TimelineEvent) {
  const time = formatRelativeTime(event.created_at || event.timestamp || "");
  return time;
}

export function displayEventTime(event: TimelineEvent) {
  return dateValue(event.created_at || event.timestamp || "");
}

export function compactText(value: string, max = 160) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function itemText(item: unknown) {
  const value = item as Json | undefined;
  if (typeof value?.text === "string") return value.text;
  if (typeof value?.content === "string") return value.content;
  const content = Array.isArray(value?.content) ? value.content as Json[] : [];
  return content.filter((part) => ["input_text", "output_text", "text", "refusal"].includes(String(part.type || ""))).map((part) => String(part.text || "")).join("\n");
}

export function firstTextValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

export function userTextForEvent(event: TimelineEvent) {
  const payload = event.payload as Json | undefined;
  const payloadItem = payload?.item as Json | undefined;
  return firstTextValue(
    event.text,
    event.message,
    event.prompt,
    event.input,
    payload?.text,
    payload?.message,
    payload?.input,
    payload?.prompt,
    itemText(event.item),
    itemText(payloadItem),
  ) || "已提交新的任务";
}

export function assistantTextForEvent(event: TimelineEvent) {
  if (event.type === "item.model_response") {
    const output = (event.output || []) as Json[];
    const text = modelOutputText(output) || String(event.text || event.message || "");
    return [text, modelToolSummary(output)].filter(Boolean).join("\n\n");
  }
  const output = Array.isArray(event.output) ? modelOutputText(event.output as Json[]) : "";
  const item = event.item as Json | undefined;
  return String(event.text || event.message || event.delta || output || itemText(item) || "");
}

export function assistantDeltaText(event: TimelineEvent) {
  if (!isAssistantDeltaEvent(event)) return "";
  return String(event.delta || event.text || event.message || "");
}

export function modelOutputText(output: Json[]) {
  const parts: string[] = [];
  for (const item of output || []) {
    if (["output_text", "text"].includes(String(item.type || "")) && item.text) {
      parts.push(String(item.text));
      continue;
    }
    if (item.type !== "message") continue;
    for (const part of (Array.isArray(item.content) ? item.content as Json[] : [])) {
      if (["output_text", "text"].includes(String(part.type || "")) && part.text) parts.push(String(part.text));
    }
  }
  return parts.join("\n");
}

export function modelToolSummary(output: Json[]) {
  const calls = output.filter((item) => item.type === "function_call");
  return calls.map((call) => `工具调用 · ${String(call.name || call.call_id || "run")}`).join("\n");
}

export function toolOutputText(event: TimelineEvent) {
  const item = event.item || {};
  const raw = event.output ?? item.output ?? event.text ?? "";
  if (typeof raw === "string") return raw.slice(0, 4000);
  try {
    return JSON.stringify(raw, null, 2).slice(0, 4000);
  } catch {
    return String(raw).slice(0, 4000);
  }
}

export function uniqueFileToken(filename: string, text: string, attachments: AttachmentDraft[]) {
  const base = `[File ${filename}]`;
  const existing = new Set(attachments.map((attachment) => attachment.token));
  if (!existing.has(base) && countUnquotedToken(text, base) === 0) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `[File ${filename} #${index}]`;
    if (!existing.has(candidate) && countUnquotedToken(text, candidate) === 0) return candidate;
  }
  return `[File ${filename} #${crypto.randomUUID().slice(0, 8)}]`;
}

export function countUnquotedToken(text: string, token: string) {
  if (!token) return 0;
  let count = 0;
  let start = 0;
  while (true) {
    const index = text.indexOf(token, start);
    if (index < 0) return count;
    const end = index + token.length;
    if (!isImmediatelyQuoted(text, index, end)) count += 1;
    start = end;
  }
}

export function isImmediatelyQuoted(text: string, start: number, end: number) {
  const pairs = new Set(['""', "''", "“”", "‘’"]);
  if (start <= 0 || end >= text.length) return false;
  return pairs.has(`${text[start - 1]}${text[end]}`);
}

export function removeFirstToken(text: string, token: string) {
  const index = text.indexOf(token);
  if (index < 0) return text;
  return `${text.slice(0, index)}${text.slice(index + token.length)}`.replace(/[ \t]{2,}/g, " ").trimStart();
}

export function needsSpaceBefore(value: string) {
  return value.length > 0 && !/\s$/.test(value);
}

export function positiveNumber(value?: number) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function connectionText(connection: string) {
  if (connection === "open") return "工作台已连接";
  if (connection === "error") return "正在恢复连接";
  return "正在打开工作台";
}

export function connectionState(connection: string): Status & { hint: string } {
  if (connection === "open") return { label: "在线", hint: "变更会自动同步", className: "done" };
  if (connection === "error") return { label: "恢复中", hint: "页面会自动接回", className: "running" };
  return { label: "连接中", hint: "正在打开远程工作台", className: "running" };
}

export function levelLabel(value?: string) {
  return value ? LEVEL_LABELS[value] || value : "默认";
}

export function modelLevelOptions(capabilities: RemoteCapabilities | null, currentValue = "") {
  const levels = capabilities?.core?.models?.levels || [];
  const defaultLevel = capabilities?.core?.models?.default_level || "";
  const options = levels.length
    ? [
        { value: "", label: defaultLevel ? `默认（${levelLabel(defaultLevel)}）` : "默认" },
        ...levels.map((level) => {
          const value = String(level.id || "");
          const model = String(level.model || level.model_name || "");
          const label = levelLabel(value);
          return { value, label: model ? `${label} · ${model}` : label };
        }).filter((option) => option.value),
      ]
    : LEVEL_OPTIONS;
  if (currentValue && !options.some((option) => option.value === currentValue)) {
    return [...options, { value: currentValue, label: levelLabel(currentValue) }];
  }
  return options;
}

export function mentionItems(picker?: PickerSummary) {
  if (!picker?.available) return [];
  const seen = new Set<string>();
  return (picker.items || [])
    .filter((item) => {
      const value = String(item.value || "");
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .slice(0, 8);
}

export function appendComposerToken(text: string, token: string) {
  const cleanToken = token.trim();
  if (!cleanToken) return text;
  const prefix = needsSpaceBefore(text) ? `${text} ` : text;
  return `${prefix}${cleanToken} `;
}

export function toolIndexSummary(pickers: Record<string, PickerSummary> = {}) {
  const total = ["mcp", "skills"].reduce((sum, key) => {
    const picker = pickers[key];
    if (!picker?.available) return sum;
    return sum + Number(picker.total || picker.items?.length || 0);
  }, 0);
  const connected = ["mcp", "skills"].filter((key) => pickers[key]?.available).length;
  if (connected && total) return `${total} 个条目`;
  if (connected) return `${connected} 个插入源`;
  return "等待启用";
}

export function pickerItemTitle(item: PickerItemSummary) {
  const value = String(item.value || item.id || "").replace(/^@/, "");
  if (!value) return item.kind || "条目";
  const parts = value.split(/[/:]+/).filter(Boolean);
  return parts.at(-1) || value;
}

export function conflictLabel(value?: string) {
  return value ? CONFLICT_LABELS[value] || value : CONFLICT_LABELS.queue;
}

export function capabilityRow(feature: CapabilityFeature, index: number) {
  const id = String(feature.id || "");
  const status = capabilityStatus(feature.status);
  return {
    key: feature.id || feature.label || String(index),
    label: feature.label || capabilityLabel(id),
    detail: capabilityDetail(id, feature.detail),
    status: status.label,
    stateClass: status.className,
  };
}

export function capabilityLabel(id: string) {
  const labels: Record<string, string> = {
    threads: "线程",
    transcript: "转录",
    composer: "输入框",
    attachments: "附件",
    status: "状态",
    models: "模型",
    mcp: "MCP",
    skills: "技能",
  };
  return labels[id] || "能力";
}

export function capabilityStatus(status?: string): { label: string; className: Status["className"] } {
  if (status === "available") return { label: "可用", className: "done" };
  if (status === "unavailable") return { label: "不可用", className: "muted" };
  return { label: "不可用", className: "muted" };
}

export function capabilityDetail(id: string, detail = "") {
  if (["models", "mcp", "skills"].includes(id) && detail) {
    return sanitizeCapabilityDetail(detail);
  }
  const details: Record<string, string> = {
    threads: "任务入口、历史记录和标题管理",
    transcript: "消息、工具结果、素材和运行记录",
    composer: "多行输入、档位和提交策略",
    attachments: "图片上下文和文件素材",
    status: "连接状态、会话保护和远程入口",
    models: "模型和档位摘要",
    mcp: "MCP 插入源",
    skills: "技能索引",
  };
  return details[id] || sanitizeCapabilityDetail(detail) || "按服务能力显示";
}

export function sanitizeCapabilityDetail(detail: string) {
  return detail
    .replace(/\bdaemon\b/gi, "远程服务")
    .replace(/\bSSE\b/g, "实时连接")
    .replace(/\bblob token\b/gi, "文件标记")
    .replace(/\bblob\b/gi, "素材")
    .replace(/\blevel\b/gi, "档位")
    .replace(/\bMCP declarations\b/gi, "MCP 服务")
    .replace(/\bmention\b/gi, "插入")
    .replace(/\bskill picker\b/gi, "技能选择器")
    .replace(/\bUI API\b/gi, "界面接口")
    .replace(/缓存/g, "本地恢复")
    .trim();
}

export function capabilitySummary(features: CapabilityFeature[]) {
  const available = features.filter((feature) => feature.status === "available").length;
  const unavailable = features.length - available;
  const parts = [
    available ? `${available} 项可用` : "",
    unavailable > 0 ? `${unavailable} 项不可用` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "按服务能力显示";
}

export function uploadLimitText(limits: RemoteCapabilities["limits"] = {}) {
  const parts = [
    limits.max_attachments ? `${limits.max_attachments} 个附件` : "",
    limits.max_message_bytes ? `${formatBytes(limits.max_message_bytes)} 消息` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "按服务配置";
}

export function dateValue(value?: string) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function formatRelativeTime(value?: string) {
  const time = dateValue(value);
  if (!time) return "";
  const diff = Math.max(0, Date.now() - time);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)}分钟`;
  if (diff < day) return `${Math.floor(diff / hour)}小时`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}天`;
  return new Intl.DateTimeFormat(undefined, { month: "2-digit", day: "2-digit" }).format(new Date(time));
}

export function formatBytes(value?: number) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const rounded = size >= 10 || index === 0 ? Math.round(size) : Math.round(size * 10) / 10;
  return `${rounded}${units[index]}`;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "");
}

export function autoSize(input: HTMLTextAreaElement | null) {
  if (!input) return;
  input.style.height = "auto";
  input.style.height = `${Math.min(168, input.scrollHeight)}px`;
}
