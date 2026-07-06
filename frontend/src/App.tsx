import React, { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Select from "@radix-ui/react-select";
import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AtSign,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Copy,
  FilePlus2,
  Folder,
  GitFork,
  Info,
  Image as ImageIcon,
  Moon,
  PanelLeftClose,
  Paperclip,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SunMoon,
  UploadCloud,
  Workflow,
  X,
} from "lucide-react";
import "./styles.css";

type Json = Record<string, unknown>;

type ProjectInfo = {
  name?: string;
  path?: string;
};

type RemoteConfig = {
  url?: string;
  host?: string;
  port?: number;
  auth_mode?: string;
  last_seq?: number;
  project?: ProjectInfo;
};

type RemoteCapabilities = {
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

type CapabilityFeature = {
  id?: string;
  label?: string;
  status?: string;
  detail?: string;
};

type CoreSummary = {
  agent_api?: boolean;
  models?: ModelSummary;
  pickers?: Record<string, PickerSummary>;
};

type ModelSummary = {
  available?: boolean;
  default_level?: string;
  levels?: ModelLevelSummary[];
};

type ModelLevelSummary = {
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

type PickerSummary = {
  available?: boolean;
  plugin?: string;
  id?: string;
  title?: string | Record<string, string>;
  trigger?: string;
  total?: number;
  items?: PickerItemSummary[];
};

type PickerItemSummary = {
  id?: string;
  value?: string;
  description?: string;
  kind?: string;
  meta?: string;
};

type Thread = {
  thread_id: string;
  title?: string;
  updated_at?: string;
  status?: string;
  active_model?: string;
  active_level?: string;
  turn_count?: number;
  last_text?: string;
};

type TimelineEvent = Json & {
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

type AttachmentDraft = {
  id: string;
  file: File;
  kind: "image" | "file";
  token: string;
  slot: number | null;
  filename: string;
  mime_type: string;
};

type Status = {
  label: string;
  className: "running" | "done" | "error" | "muted";
};

type InfoTab = "overview" | "events" | "attachments" | "status";
type EventFilter = "all" | "message" | "tool" | "system" | "attachment";
type ThemeName = "deep" | "light";
type ThreadFilter = "all" | "running" | "done" | "attention";
type DisplayRole = "user" | "assistant" | "reasoning" | "tool" | "system" | "error";
type DisplayMessage = {
  kind: "message";
  key: string;
  role: DisplayRole;
  label: string;
  text: string;
  time?: string;
  occurredAt?: number;
  editable?: boolean;
  forkable?: boolean;
};
type DisplayChange = {
  kind: "change";
  key: string;
  summary: ChangeSummary;
};
type DisplayItem = DisplayMessage | DisplayChange;
type TurnGroupModel = {
  key: string;
  user?: DisplayMessage;
  items: DisplayItem[];
};

const LEVEL_OPTIONS = [
  { value: "", label: "默认" },
  { value: "small", label: "快速" },
  { value: "medium", label: "标准" },
  { value: "large", label: "深度" },
];

const CONFLICT_OPTIONS = [
  { value: "queue", label: "排队" },
  { value: "guide", label: "询问" },
  { value: "interrupt", label: "接管" },
  { value: "reject", label: "空闲" },
];
const SELECT_DEFAULT_VALUE = "__default__";

const THREAD_FILTER_OPTIONS: Array<{ value: ThreadFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "running", label: "运行" },
  { value: "done", label: "完成" },
  { value: "attention", label: "待处理" },
];

const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const CACHE_DB_NAME = "uv-agent-remote-control";
const LEVEL_LABELS: Record<string, string> = {
  low: "快速",
  small: "快速",
  medium: "标准",
  high: "深度",
  deep: "深度",
  large: "深度",
};
const CONFLICT_LABELS: Record<string, string> = {
  queue: "排队运行",
  guide: "先询问",
  interrupt: "停止后运行",
  reject: "忙时不提交",
};

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [authCode, setAuthCode] = useState("");
  const [authError, setAuthError] = useState("");
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [config, setConfig] = useState<RemoteConfig | null>(null);
  const [capabilities, setCapabilities] = useState<RemoteCapabilities | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [eventsByThread, setEventsByThread] = useState<Map<string, TimelineEvent[]>>(new Map());
  const [liveEvents, setLiveEvents] = useState<TimelineEvent[]>([]);
  const [liveDrafts, setLiveDrafts] = useState<Map<string, string>>(new Map());
  const [liveReasoningDrafts, setLiveReasoningDrafts] = useState<Map<string, string>>(new Map());
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [imageSlot, setImageSlot] = useState(1);
  const [connection, setConnection] = useState("booting");
  const [lastSeq, setLastSeq] = useLocalNumber("uvrc:lastSeq", 0);
  const [selectedLevel, setSelectedLevel] = useLocalString("uvrc:level", "");
  const [selectedConflict, setSelectedConflict] = useLocalString("uvrc:conflict", "queue");
  const [threadFilter, setThreadFilter] = useLocalString("uvrc:threadFilter", "all");
  const [theme, setTheme] = useLocalString("uvrc:theme", "deep");
  const [view, setView] = useState<"list" | "thread" | "info">("list");
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoTab, setInfoTab] = useState<InfoTab>("overview");
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [composerText, setComposerText] = useState("");
  const [toast, setToast] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [db, setDb] = useState<IDBDatabase | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimer = useRef<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastSeqRef = useRef(lastSeq);

  const normalizedTheme: ThemeName = theme === "light" ? "light" : "deep";
  const normalizedThreadFilter = normalizeThreadFilter(threadFilter);
  const desktop = useMedia("(min-width: 860px)");
  const currentThread = threads.find((thread) => thread.thread_id === selectedThreadId) || null;
  const selectedEvents = selectedThreadId ? eventsByThread.get(selectedThreadId) || [] : [];
  const filteredThreads = useMemo(() => filterThreads(threads, searchQuery, normalizedThreadFilter, eventsByThread, liveEvents), [threads, searchQuery, normalizedThreadFilter, eventsByThread, liveEvents]);
  const threadFilterCounts = useMemo(() => countThreadsByFilter(threads, eventsByThread, liveEvents), [threads, eventsByThread, liveEvents]);
  const runningCount = threads.filter((thread) => statusForThread(thread, eventsByThread, liveEvents).className === "running").length;
  const currentStatus = statusForThread(currentThread, eventsByThread, liveEvents);
  const currentChanges = summarizeThreadChanges(selectedEvents);

  useEffect(() => {
    document.body.dataset.view = view;
    document.body.dataset.connection = connection;
    document.body.dataset.infoOpen = infoOpen ? "true" : "false";
    document.body.dataset.treeCollapsed = treeCollapsed ? "true" : "false";
    document.body.dataset.theme = normalizedTheme;
  }, [view, connection, infoOpen, treeCollapsed, normalizedTheme]);

  useEffect(() => {
    openCache().then(setDb);
    api<{ authenticated: boolean }>("/api/auth/status", { auth: false })
      .then((status) => {
        setAuthenticated(status.authenticated);
        if (status.authenticated) void boot();
      })
      .catch((error) => {
        setAuthenticated(false);
        showToast(error.message || "连接失败");
      });
    return () => eventSourceRef.current?.close();
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    connectEvents();
    return () => eventSourceRef.current?.close();
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        setSearchOpen(false);
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (key === "k") {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (key === "n") {
        event.preventDefault();
        startNewThread();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [authenticated, searchOpen]);

  useEffect(() => {
    lastSeqRef.current = lastSeq;
  }, [lastSeq]);

  useEffect(() => {
    autoSize(composerRef.current);
    syncAttachmentTokens(composerText);
  }, [composerText]);

  async function boot() {
    await loadSystemState();
    await refreshThreads();
  }

  async function loadSystemState() {
    const [nextConfig, nextCapabilities] = await Promise.all([
      api<RemoteConfig>("/api/config").catch(() => null),
      api<RemoteCapabilities>("/api/capabilities").catch(() => null),
    ]);
    setConfig(nextConfig);
    setCapabilities(nextCapabilities);
    if (nextConfig?.project) setProject(nextConfig.project);
  }

  async function refreshThreads() {
    const data = await api<{ project?: ProjectInfo; threads?: Thread[] }>("/api/threads");
    const nextThreads = [...(data.threads || [])].sort(compareThreads);
    setProject(data.project || null);
    setThreads(nextThreads);
    const selected = selectedThreadId && nextThreads.some((thread) => thread.thread_id === selectedThreadId) ? selectedThreadId : null;
    if (!selected && desktop && nextThreads[0]) {
      await selectThread(nextThreads[0].thread_id, { keepScroll: true });
      return;
    }
    if (!selected) setSelectedThreadId(null);
  }

  async function refreshAll() {
    await loadSystemState();
    await refreshThreads();
  }

  async function selectThread(threadId: string, options: { keepScroll?: boolean } = {}) {
    setSelectedThreadId(threadId);
    setView("thread");
    const cached = db ? await cacheGetEvents(db, threadId) : [];
    if (cached.length) {
      setEventsByThread((previous) => mergeEventsMap(previous, threadId, cached));
    }
    const lastCached = Number(cached.at(-1)?._event_id || 0);
    const data = await api<{ events?: TimelineEvent[] }>(`/api/threads/${encodeURIComponent(threadId)}/events?after=${lastCached}&limit=500`);
    setEventsByThread((previous) => mergeEventsMap(previous, threadId, data.events || []));
    if (db && data.events?.length) await cachePutEvents(db, threadId, data.events);
    if (!options.keepScroll) {
      requestAnimationFrame(() => {
        const timeline = document.querySelector("#timeline");
        if (timeline) timeline.scrollTop = timeline.scrollHeight;
      });
    }
  }

  function connectEvents() {
    eventSourceRef.current?.close();
    setConnection("connecting");
    const source = new EventSource(`/api/events?after=${lastSeqRef.current || 0}`);
    eventSourceRef.current = source;
    source.onopen = () => setConnection("open");
    source.onerror = () => setConnection("error");
    source.onmessage = async (message) => {
      const seq = Number(message.lastEventId || "0");
      if (seq) {
        lastSeqRef.current = seq;
        setLastSeq(seq);
      }
      const payload = JSON.parse(message.data) as Json;
      if (payload.kind === "sync_required") {
        await syncSelectedFromServer();
        return;
      }
      if (payload.kind === "stored_event") {
        const event = payload.event as TimelineEvent | undefined;
        if (event?.thread_id) {
          setEventsByThread((previous) => mergeEventsMap(previous, event.thread_id as string, [event]));
          if (db) await cachePutEvents(db, event.thread_id, [event]);
          void refreshThreads();
        }
        return;
      }
      if (payload.kind === "live_event") {
        applyLiveEvent((payload.event || {}) as TimelineEvent);
        return;
      }
      if (payload.kind === "turn_submitted") void refreshThreads();
    };
  }

  async function syncSelectedFromServer() {
    if (!selectedThreadId) return;
    const events = eventsByThread.get(selectedThreadId) || [];
    const last = events.at(-1)?._event_id || 0;
    const data = await api<{ events?: TimelineEvent[] }>(`/api/threads/${encodeURIComponent(selectedThreadId)}/events?after=${last}&limit=500`);
    setEventsByThread((previous) => mergeEventsMap(previous, selectedThreadId, data.events || []));
  }

  function applyLiveEvent(event: TimelineEvent) {
    const turnId = String(event.turn_id || "");
    if (!turnId) return;
    if (event.type === "response.output_text.delta" || event.type === "assistant.delta" || event.type === "assistant.message.delta") {
      setLiveDrafts((previous) => new Map(previous).set(turnId, (previous.get(turnId) || "") + (event.delta || event.text || "")));
      return;
    }
    if (event.type === "assistant.reasoning_delta") {
      setLiveReasoningDrafts((previous) => new Map(previous).set(turnId, (previous.get(turnId) || "") + (event.text || "")));
      return;
    }
    if (isLiveTimelineEvent(event)) {
      setLiveEvents((previous) => [...previous, { ...event, _event_id: `live-${Date.now()}-${previous.length}` }].slice(-100));
    }
    if (["turn.completed", "turn.interrupted", "turn.error", "item.model_response", "item.assistant", "assistant.message.completed", "assistant.completed", "response.output_text.done"].includes(String(event.type || ""))) {
      setLiveDrafts((previous) => {
        const next = new Map(previous);
        next.delete(turnId);
        return next;
      });
      setLiveReasoningDrafts((previous) => {
        const next = new Map(previous);
        next.delete(turnId);
        return next;
      });
    }
  }

  async function submitComposer(event: FormEvent) {
    event.preventDefault();
    const text = composerText.trim();
    if (!text || sendBusy) return;
    const duplicated = attachments.find((attachment) => countUnquotedToken(text, attachment.token) > 1);
    if (duplicated) {
      showToast(`${duplicated.token} 只能出现一次`);
      return;
    }
    const liveAttachments = attachments.filter((attachment) => countUnquotedToken(text, attachment.token) > 0);
    const maxMessageBytes = positiveNumber(capabilities?.limits?.max_message_bytes);
    const totalAttachmentBytes = liveAttachments.reduce((total, attachment) => total + attachment.file.size, 0);
    if (maxMessageBytes && totalAttachmentBytes > maxMessageBytes) {
      showToast(`本轮附件超过 ${formatBytes(maxMessageBytes)}`);
      return;
    }
    const form = new FormData();
    const payload: Json = {
      text,
      thread_id: selectedThreadId,
      title: text.slice(0, 48),
      conflict: selectedConflict || "queue",
      attachments: liveAttachments.map((attachment, index) => ({
        part: `file_${index}`,
        kind: attachment.kind,
        token: attachment.token,
        slot: attachment.slot,
        filename: attachment.filename,
        mime_type: attachment.mime_type,
      })),
    };
    if (selectedLevel) payload.level = selectedLevel;
    form.append("payload", new Blob([JSON.stringify(payload)], { type: "application/json" }));
    liveAttachments.forEach((attachment, index) => form.append(`file_${index}`, attachment.file, attachment.filename));
    setSendBusy(true);
    try {
      const result = await api<{ thread_id: string }>("/api/turns", { method: "POST", form });
      setSelectedThreadId(result.thread_id);
      setAttachments([]);
      setComposerText("");
      await refreshThreads();
      setView("thread");
    } catch (error) {
      addLocalError(error);
    } finally {
      setSendBusy(false);
    }
  }

  async function cancelThread(threadId: string | null) {
    if (!threadId) return;
    try {
      await api(`/api/threads/${encodeURIComponent(threadId)}/cancel`, { method: "POST", body: {} });
      showToast("已请求停止");
    } catch (error) {
      addLocalError(error);
    }
  }

  async function cancelSelectedThread() {
    await cancelThread(selectedThreadId);
  }

  async function verifyAuth(event: FormEvent) {
    event.preventDefault();
    setAuthError("");
    try {
      await api("/api/auth/verify", { method: "POST", auth: false, body: { code: authCode.trim() } });
      setAuthenticated(true);
      await boot();
    } catch (error) {
      setAuthError(errorMessage(error) || "验证失败");
    }
  }

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3200);
  }

  function addLocalError(error: unknown) {
    const threadId = selectedThreadId;
    if (!threadId) {
      showToast(errorMessage(error) || "操作失败");
      return;
    }
    setLiveEvents((previous) => [
      ...previous,
      { thread_id: threadId, type: "turn.error", message: errorMessage(error) || "操作失败", _event_id: `local-error-${Date.now()}` },
    ]);
  }

  function startNewThread() {
    setSelectedThreadId(null);
    setAttachments([]);
    setComposerText("");
    setView("thread");
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function focusComposer() {
    setView("thread");
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function clearComposer() {
    if (!composerText && !attachments.length) return;
    setAttachments([]);
    setComposerText("");
    focusComposer();
    showToast("已清空输入");
  }

  function startEditingCurrentTitle() {
    if (!currentThread) return;
    setDraftTitle(currentThread.title || "");
    setEditingTitle(true);
    setView("thread");
  }

  function openInfoTab(tab: InfoTab) {
    setInfoTab(tab);
    if (desktop) {
      setInfoOpen(true);
    } else {
      setView("info");
    }
  }

  function toggleInfoPane() {
    if (!desktop) {
      setView("info");
      return;
    }
    setInfoOpen((value) => !value);
  }

  function closeInfoPane() {
    if (!desktop) {
      setView("thread");
      return;
    }
    setInfoOpen(false);
  }

  function editMessageDraft(text: string) {
    setComposerText(text);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      const length = composerRef.current?.value.length || 0;
      composerRef.current?.setSelectionRange(length, length);
    });
    showToast("已放入输入框");
  }

  function forkMessageDraft(text: string) {
    startNewThread();
    setComposerText(`继续这段内容：\n\n${text}`);
    showToast("已创建分支草稿");
  }

  function prepareChangeUndo(summary: ChangeSummary) {
    const files = summary.files.slice(0, 6).join("\n- ");
    setComposerText(`请撤销上一轮文件修改。${files ? `\n\n涉及文件：\n- ${files}` : ""}`);
    requestAnimationFrame(() => composerRef.current?.focus());
    showToast("已生成撤销请求草稿");
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("已复制");
    } catch (error) {
      showToast(errorMessage(error) || "复制失败");
    }
  }

  function addSelectedFiles(files: FileList | null) {
    if (!files?.length) return;
    const created: AttachmentDraft[] = [];
    const maxAttachments = positiveNumber(capabilities?.limits?.max_attachments);
    const maxFileBytes = positiveNumber(capabilities?.limits?.max_file_bytes);
    const maxMessageBytes = positiveNumber(capabilities?.limits?.max_message_bytes);
    let nextBytes = attachments.reduce((total, attachment) => total + attachment.file.size, 0);
    let nextSlot = imageSlot;
    let nextText = composerText;
    let blockedMessage = "";
    for (const file of Array.from(files)) {
      if (maxAttachments && attachments.length + created.length >= maxAttachments) {
        blockedMessage = `单次最多 ${maxAttachments} 个附件`;
        break;
      }
      if (maxFileBytes && file.size > maxFileBytes) {
        blockedMessage = `${file.name || "附件"} 超过 ${formatBytes(maxFileBytes)}`;
        continue;
      }
      if (maxMessageBytes && nextBytes + file.size > maxMessageBytes) {
        blockedMessage = `本轮附件超过 ${formatBytes(maxMessageBytes)}`;
        break;
      }
      const isImage = SUPPORTED_IMAGE_TYPES.has(file.type);
      const filename = file.name || (isImage ? `image-${nextSlot}.png` : `attachment-${attachments.length + created.length + 1}`);
      const token = isImage ? `[Image #${nextSlot++}]` : uniqueFileToken(filename, nextText, [...attachments, ...created]);
      created.push({
        id: crypto.randomUUID(),
        file,
        kind: isImage ? "image" : "file",
        token,
        slot: isImage ? nextSlot - 1 : null,
        filename,
        mime_type: file.type || "application/octet-stream",
      });
      nextBytes += file.size;
      nextText = `${nextText}${needsSpaceBefore(nextText) ? " " : ""}${token} `;
    }
    if (blockedMessage) showToast(blockedMessage);
    if (!created.length) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setImageSlot(nextSlot);
    setAttachments((previous) => [...previous, ...created]);
    setComposerText(nextText);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment(id: string) {
    const attachment = attachments.find((item) => item.id === id);
    if (!attachment) return;
    setAttachments((previous) => previous.filter((item) => item.id !== id));
    setComposerText((text) => removeFirstToken(text, attachment.token));
  }

  function syncAttachmentTokens(text: string) {
    setAttachments((previous) => {
      const next = previous.filter((attachment) => countUnquotedToken(text, attachment.token) > 0);
      return next.length === previous.length ? previous : next;
    });
  }

  async function saveTitle(commit: boolean) {
    if (!currentThread) return;
    const next = draftTitle.trim();
    setEditingTitle(false);
    if (!commit || !next || next === (currentThread.title || "")) return;
    try {
      await api(`/api/threads/${encodeURIComponent(currentThread.thread_id)}/title`, { method: "POST", body: { title: next } });
      await refreshThreads();
    } catch (error) {
      addLocalError(error);
    }
  }

  function titleKeydown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveTitle(true);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      void saveTitle(false);
    }
  }

  const shellProps = {
    project,
    threads,
    filteredThreads,
    selectedThreadId,
    selectedEvents,
    liveEvents,
    runningCount,
    currentStatus,
    connection,
    lastSeq,
    config,
    capabilities,
    theme: normalizedTheme,
    threadFilter: normalizedThreadFilter,
    threadFilterCounts,
    setThreadFilter: (filter: ThreadFilter) => setThreadFilter(filter),
    toggleTheme: () => setTheme(normalizedTheme === "light" ? "deep" : "light"),
    refreshAll,
    startNewThread,
    openSearch: () => setSearchOpen(true),
    cancelThread,
    cancelSelectedThread,
    selectThread,
    selectFirstThread: () => {
      const first = filteredThreads[0] || threads[0];
      if (first) void selectThread(first.thread_id);
    },
    treeCollapsed,
    setTreeCollapsed,
    openInfoTab,
  };

  if (authenticated === null) return <SessionGate mode="loading" />;

  return (
    <Tooltip.Provider delayDuration={380} skipDelayDuration={120}>
      <>
      {!authenticated && (
        <AuthOverlay authCode={authCode} setAuthCode={setAuthCode} authError={authError} verifyAuth={verifyAuth} />
      )}
      <CommandPalette
        open={searchOpen}
        query={searchQuery}
        setQuery={setSearchQuery}
        close={() => setSearchOpen(false)}
        threads={filteredThreads}
        currentThread={currentThread}
        status={currentStatus}
        changes={currentChanges}
        composerText={composerText}
        attachmentCount={attachments.length}
        startNewThread={startNewThread}
        selectThread={(threadId) => void selectThread(threadId)}
        openInfoTab={openInfoTab}
        setComposerText={setComposerText}
        focusComposer={focusComposer}
        clearComposer={clearComposer}
        cancelSelectedThread={() => void cancelSelectedThread()}
        startEditingTitle={startEditingCurrentTitle}
        prepareChangeUndo={prepareChangeUndo}
      />
      {toast && <div className="toast">{toast}</div>}
        <div className="app-shell">
          <aside className="sidebar">
            <MobileHome {...shellProps} />
            <DesktopRail {...shellProps} />
          </aside>
          <main className="thread-pane">
            <ThreadPane
              thread={currentThread}
              project={project}
              events={selectedEvents}
              liveEvents={liveEvents}
              liveDrafts={liveDrafts}
              liveReasoningDrafts={liveReasoningDrafts}
              status={currentStatus}
              changes={currentChanges}
              capabilities={capabilities}
              selectedLevel={selectedLevel}
              setSelectedLevel={setSelectedLevel}
              selectedConflict={selectedConflict}
              setSelectedConflict={setSelectedConflict}
              composerText={composerText}
              setComposerText={setComposerText}
              composerRef={composerRef}
              fileInputRef={fileInputRef}
              attachments={attachments}
              removeAttachment={removeAttachment}
              addSelectedFiles={addSelectedFiles}
              submitComposer={submitComposer}
              sendBusy={sendBusy}
              cancelSelectedThread={cancelSelectedThread}
              backToList={() => setView("list")}
              openSearch={() => setSearchOpen(true)}
              openInfo={() => toggleInfoPane()}
              openInfoTab={openInfoTab}
              editMessageDraft={editMessageDraft}
              forkMessageDraft={forkMessageDraft}
              prepareChangeUndo={prepareChangeUndo}
              copyText={copyText}
              editingTitle={editingTitle}
              draftTitle={draftTitle}
              setDraftTitle={setDraftTitle}
              startEditingTitle={startEditingCurrentTitle}
              saveTitle={saveTitle}
              titleKeydown={titleKeydown}
            />
          </main>
          <InfoPane
            thread={currentThread}
            project={project}
            config={config}
            capabilities={capabilities}
            events={selectedEvents}
            attachments={attachments}
            infoTab={infoTab}
            setInfoTab={openInfoTab}
            eventFilter={eventFilter}
            setEventFilter={setEventFilter}
            close={closeInfoPane}
            cancelSelectedThread={cancelSelectedThread}
            db={db}
            lastSeq={lastSeq}
            connection={connection}
            runningCount={runningCount}
            status={currentStatus}
            changes={currentChanges}
          />
        </div>
      </>
    </Tooltip.Provider>
  );
}

function AuthOverlay({
  authCode,
  setAuthCode,
  authError,
  verifyAuth,
}: {
  authCode: string;
  setAuthCode: (value: string) => void;
  authError: string;
  verifyAuth: (event: FormEvent) => void;
}) {
  return (
    <div className="auth-overlay">
      <form className="auth-panel" onSubmit={verifyAuth}>
        <SessionGateHeader
          title="等待设备鉴权..."
          copy="输入本机服务显示的验证码，同步工作区和任务。"
        />
        <div className="auth-form-row">
          <label>
            <span>验证码</span>
            <input value={authCode} onChange={(event) => setAuthCode(event.target.value)} autoComplete="one-time-code" autoFocus />
          </label>
          <button type="submit">进入</button>
        </div>
        <p className="error-text">{authError}</p>
        <SessionStepList
          steps={[
            { label: "连接控制服务", value: "已建立", state: "done" },
            { label: "设备鉴权", value: authCode ? "等待验证" : "输入验证码", state: authError ? "error" : "running" },
            { label: "同步工作区", value: "鉴权后开始", state: "muted" },
            { label: "打开任务面板", value: "准备中", state: "muted" },
          ]}
        />
      </form>
    </div>
  );
}

function SessionGate({ mode }: { mode: "loading" }) {
  return (
    <div className="auth-overlay">
      <section className="auth-panel session-loading" aria-live="polite">
        <SessionGateHeader
          title={mode === "loading" ? "已配对，正在加载工作区..." : "连接远程工作台"}
          copy="连接已建立，正在同步桌面端工作区和任务。"
        />
        <SessionStepList
          steps={[
            { label: "连接中转服务", value: "已建立", state: "done" },
            { label: "设备鉴权", value: "已通过", state: "done" },
            { label: "等待桌面端配对", value: "已配对", state: "done" },
            { label: "同步工作区", value: "进行中", state: "running" },
          ]}
        />
      </section>
    </div>
  );
}

function SessionGateHeader({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="session-gate-head">
      <span className="session-gate-dot" />
      <div>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
    </div>
  );
}

type ShellProps = {
  project: ProjectInfo | null;
  threads: Thread[];
  filteredThreads: Thread[];
  selectedThreadId: string | null;
  selectedEvents: TimelineEvent[];
  liveEvents: TimelineEvent[];
  runningCount: number;
  currentStatus: Status;
  connection: string;
  lastSeq: number;
  config: RemoteConfig | null;
  capabilities: RemoteCapabilities | null;
  theme: ThemeName;
  threadFilter: ThreadFilter;
  threadFilterCounts: Record<ThreadFilter, number>;
  setThreadFilter: (filter: ThreadFilter) => void;
  toggleTheme: () => void;
  refreshAll: () => Promise<void>;
  startNewThread: () => void;
  openSearch: () => void;
  cancelThread: (threadId: string | null) => Promise<void>;
  cancelSelectedThread: () => Promise<void>;
  selectThread: (threadId: string) => Promise<void>;
  selectFirstThread: () => void;
  treeCollapsed: boolean;
  setTreeCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  openInfoTab: (tab: InfoTab) => void;
};

function MobileHome(props: ShellProps) {
  const updated = projectUpdatedAt(props.threads);
  const remote = remoteSurfaceState(props);
  const workspaceCount = workspaceOverviewText(props);
  const workspaceName = props.project?.name || "uv-agent";
  const workspacePath = props.project?.path || "等待远程服务返回项目路径";
  const modeLabel = workspaceModeLabel(props.config);
  return (
    <section className="mobile-home">
      <header className="mobile-hero">
        <div>
          <h1>uv-agent 远程控制</h1>
          <p>{remote.title}</p>
        </div>
        <div className="hero-actions">
          <IconButton title={props.theme === "light" ? "切换到深色主题" : "切换到浅色主题"} onClick={props.toggleTheme}>
            {props.theme === "light" ? <Moon /> : <SunMoon />}
          </IconButton>
          <IconButton title="搜索" onClick={props.openSearch}>
            <Search />
          </IconButton>
        </div>
      </header>
      <section className={clsx("mobile-remote-note", remote.className)}>
        <span className={clsx("session-state-dot", remote.className)} />
        <p>{remote.note}</p>
      </section>
      <div className="mobile-section-head">
        <div>
          <h2>当前设备上的工作区和任务</h2>
          <p>{workspaceCount}</p>
        </div>
        <div className="tiny-actions">
          <IconButton title={props.treeCollapsed ? "展开工作区" : "收起全部工作区"} onClick={() => props.setTreeCollapsed((value) => !value)}>
            <PanelLeftClose />
          </IconButton>
          <IconButton title="运行面板" onClick={() => props.openInfoTab("status")}>
            <SlidersHorizontal />
          </IconButton>
          <IconButton title="刷新工作区和任务" onClick={() => void props.refreshAll()}>
            <RefreshCw />
          </IconButton>
        </div>
      </div>
      <div className="workspace-card">
        <div className="workspace-row">
          <button className="workspace-main-button" type="button" onClick={props.selectFirstThread}>
            <span className="workspace-icon"><Folder size={16} /></span>
            <span className="workspace-main">
              <span className="workspace-title-line">
                <strong>{workspaceName}</strong>
                <span className={clsx("tag", remote.className, "workspace-mode")}>{modeLabel}</span>
              </span>
              <span className="workspace-path">{workspacePath}</span>
              <span className="workspace-time">{updated ? `更新于 ${formatRelativeTime(updated)}` : "暂无更新"}</span>
            </span>
          </button>
          <span className="workspace-count">{props.threads.length} 个任务</span>
          <IconButton title="新建任务" className="workspace-add" onClick={props.startNewThread}><Plus /></IconButton>
        </div>
        {!props.treeCollapsed && (
          <div className="mobile-thread-list">
            {props.filteredThreads.length ? (
              props.filteredThreads.map((thread) => (
                <MobileThreadButton key={thread.thread_id} thread={thread} selected={thread.thread_id === props.selectedThreadId} liveEvents={props.liveEvents} onClick={() => void props.selectThread(thread.thread_id)} />
              ))
            ) : (
                <ThreadEmptyState search={props.openSearch} start={props.startNewThread} hasThreads={!!props.threads.length} />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function DesktopRail(props: ShellProps) {
  const modeLabel = workspaceModeLabel(props.config);
  return (
    <section className="desktop-rail">
      <div className="rail-top">
        <button className="nav-arrow" type="button"><ChevronLeft size={17} /></button>
        <button className="nav-arrow" type="button"><ChevronRight size={17} /></button>
      </div>
      <div className="command-stack">
        <CommandButton icon={<Plus size={15} />} label="新建任务" meta="Ctrl+N" onClick={props.startNewThread} />
        <CommandButton icon={<Search size={15} />} label="搜索" meta="Ctrl+K" onClick={props.openSearch} />
        <CapabilityMenu capabilities={props.capabilities} openStatus={() => props.openInfoTab("status")} />
      </div>
      <section className="project-tree">
        <div className="section-pill-row">
          <span className="section-pill">项目</span>
          <span className="section-tools">
            <IconButton title="刷新" onClick={() => void props.refreshAll()}><RefreshCw /></IconButton>
            <IconButton title="折叠" onClick={() => props.setTreeCollapsed((value) => !value)}><PanelLeftClose /></IconButton>
          </span>
        </div>
        <button className="project-row" type="button" onClick={props.selectFirstThread}>
          <span className="tree-caret">⌄</span>
          <span className="folder-icon"><Folder size={15} /></span>
          <span className="project-name">{props.project?.name || "uv-agent"}</span>
          <span className="project-mode">{modeLabel}</span>
          <span className="project-count">{props.threads.length}</span>
        </button>
        {!props.treeCollapsed && (
          <div className="thread-list">
            {props.filteredThreads.length ? props.filteredThreads.map((thread) => (
              <DesktopThreadButton
                key={thread.thread_id}
                thread={thread}
                selected={thread.thread_id === props.selectedThreadId}
                events={props.selectedThreadId === thread.thread_id ? props.selectedEvents : []}
                liveEvents={props.liveEvents}
                onClick={() => void props.selectThread(thread.thread_id)}
              />
            )) : (
              <ThreadEmptyState search={props.openSearch} start={props.startNewThread} hasThreads={!!props.threads.length} compact />
            )}
          </div>
        )}
        </section>
      <footer className="rail-footer">
        <span className="avatar">4</span>
        <span className="rail-user">
          <strong>{props.project?.name || "uv-agent"}</strong>
          <small>{props.config?.auth_mode === "none" ? "本地模式" : "远程模式"}</small>
        </span>
        <span className="connection-dot"></span>
        <IconButton title={props.theme === "light" ? "切换到深色主题" : "切换到浅色主题"} onClick={props.toggleTheme}>
          {props.theme === "light" ? <Moon /> : <SunMoon />}
        </IconButton>
        <IconButton title="运行" onClick={() => props.openInfoTab("status")}><Settings /></IconButton>
      </footer>
    </section>
  );
}

function ThreadPane(props: {
  thread: Thread | null;
  project: ProjectInfo | null;
  events: TimelineEvent[];
  liveEvents: TimelineEvent[];
  liveDrafts: Map<string, string>;
  liveReasoningDrafts: Map<string, string>;
  status: Status;
  changes: ChangeSummary | null;
  capabilities: RemoteCapabilities | null;
  selectedLevel: string;
  setSelectedLevel: (value: string) => void;
  selectedConflict: string;
  setSelectedConflict: (value: string) => void;
  composerText: string;
  setComposerText: (value: string) => void;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  attachments: AttachmentDraft[];
  removeAttachment: (id: string) => void;
  addSelectedFiles: (files: FileList | null) => void;
  submitComposer: (event: FormEvent) => void;
  sendBusy: boolean;
  cancelSelectedThread: () => Promise<void>;
  backToList: () => void;
  openSearch: () => void;
  openInfo: () => void;
  openInfoTab: (tab: InfoTab) => void;
  editMessageDraft: (text: string) => void;
  forkMessageDraft: (text: string) => void;
  prepareChangeUndo: (summary: ChangeSummary) => void;
  copyText: (text: string) => Promise<void>;
  editingTitle: boolean;
  draftTitle: string;
  setDraftTitle: (value: string) => void;
  startEditingTitle: () => void;
  saveTitle: (commit: boolean) => Promise<void>;
  titleKeydown: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const rows = renderRows(props);
  const level = props.thread?.active_level || props.selectedLevel || "";
  const levelOptions = modelLevelOptions(props.capabilities, props.selectedLevel);
  const draftReady = Boolean(props.composerText.trim() || props.attachments.length);
  const metaItems = threadMetaItems(props.project, props.thread, level);
  const showRunStrip = props.status.className === "running" || props.status.className === "error" || Boolean(props.changes);
  const dragDepth = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    if (!dragCarriesFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!dragCarriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (!dragCarriesFiles(event)) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragActive(false);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!dragCarriesFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    props.addSelectedFiles(event.dataTransfer.files);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!event.clipboardData.files.length) return;
    event.preventDefault();
    props.addSelectedFiles(event.clipboardData.files);
  }

  return (
    <>
      <header className="mobile-task-bar">
        <IconButton title="返回任务列表" onClick={props.backToList}><ChevronLeft /></IconButton>
        <div className="mobile-task-title">
          <strong>任务会话</strong>
          <span>{props.project?.name || "uv-agent"}</span>
        </div>
        <IconButton title="任务信息" onClick={props.openInfo}><Info /></IconButton>
      </header>
      <header className="thread-head">
        <IconButton title="返回" className="mobile-only" onClick={props.backToList}><ChevronLeft /></IconButton>
        <div className="thread-heading">
          <div className="thread-title-row">
            {props.editingTitle ? (
              <input
                className="title-input"
                value={props.draftTitle}
                onChange={(event) => props.setDraftTitle(event.target.value)}
                onKeyDown={props.titleKeydown}
                onBlur={() => void props.saveTitle(true)}
                autoFocus
              />
            ) : (
              <h2>{props.thread?.title || "新任务"}</h2>
            )}
            <IconButton title="重命名" className="title-edit" onClick={props.startEditingTitle}><Pencil /></IconButton>
          </div>
          <div className="thread-meta-trail" aria-label="任务上下文">
            {metaItems.map((item) => (
              <span className={clsx("thread-meta-chip", item.kind)} key={`${item.kind}-${item.label}`}>
                {item.icon}
                <span>{item.label}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="thread-actions">
          <IconButton title="搜索" onClick={props.openSearch}><Search /></IconButton>
          <IconButton title="信息" onClick={props.openInfo}><Info /></IconButton>
          <button
            className="ghost-btn desktop-action"
            type="button"
            title="停止当前运行"
            disabled={props.status.className !== "running"}
            onClick={() => void props.cancelSelectedThread()}
          >
            停止
          </button>
        </div>
      </header>
      {showRunStrip && (
        <>
          <div className="thread-floating-status" aria-hidden="false">
            <ThreadRunStrip thread={props.thread} status={props.status} changes={props.changes} level={level} openEvents={() => props.openInfoTab("events")} />
          </div>
          <div className="mobile-status-ribbon">
            <ThreadRunStrip thread={props.thread} status={props.status} changes={props.changes} level={level} openEvents={() => props.openInfoTab("events")} />
          </div>
        </>
      )}
      <section id="timeline" className="timeline">
        {rows.length ? rows : <div className="timeline-empty">{props.thread ? "暂无活动" : "暂无任务"}</div>}
      </section>
      <form className="composer" onSubmit={props.submitComposer}>
        <div
          className={clsx("composer-box", draftReady && "has-draft", dragActive && "dragging")}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dragActive && <div className="composer-drop-hint">松开添加到本轮上下文</div>}
          <div className="composer-topline">
            <span className="composer-focus">
              <Workflow size={15} />
              <span>
                <strong>{composerTitle(props.thread, props.status)}</strong>
                <small>{composerFocusDetail(props.thread, level, props.selectedConflict)}</small>
              </span>
            </span>
            <span className={clsx("composer-state", props.status.className)} title={composerHint(props.thread, props.status, props.attachments.length)}>{composerStateLabel(props.status, draftReady)}</span>
          </div>
          {!!props.attachments.length && <div className="attachment-tray">
            {props.attachments.map((attachment) => (
              <span className={clsx("attachment-pill", attachment.kind)} key={attachment.id}>
                <span className="attachment-pill-icon">
                  {attachment.kind === "image" ? <ImageIcon size={15} /> : <FilePlus2 size={15} />}
                </span>
                <span className="attachment-pill-main">
                  <strong title={attachment.filename}>{attachment.filename}</strong>
                  <small>
                    <span>{attachment.token}</span>
                    <span>{formatBytes(attachment.file.size)}</span>
                  </small>
                </span>
                <button type="button" title="移除附件" aria-label={`移除 ${attachment.filename}`} onClick={() => props.removeAttachment(attachment.id)}><X size={14} /></button>
              </span>
            ))}
          </div>}
          <textarea
            id="composerInput"
            ref={props.composerRef}
            value={props.composerText}
            rows={1}
            placeholder={composerPlaceholder(props.thread, props.attachments.length)}
            onChange={(event) => props.setComposerText(event.target.value)}
            onPaste={handlePaste}
          />
          <div className="composer-actions">
            <div className="composer-tools">
              <label className="tool-btn attach-tool" title="添加上下文" aria-label="添加上下文">
                <input id="fileInput" ref={props.fileInputRef} type="file" multiple onChange={(event) => {
                  props.addSelectedFiles(event.currentTarget.files);
                  event.currentTarget.value = "";
                }} />
                <Paperclip size={16} />
              </label>
              <MentionMenu
                capabilities={props.capabilities}
                insertMention={(token) => {
                  const next = appendComposerToken(props.composerText, token);
                  props.setComposerText(next);
                  requestAnimationFrame(() => {
                    props.composerRef.current?.focus();
                    autoSize(props.composerRef.current);
                  });
                }}
              />
              <ComposerMenuControl label="档位" value={props.selectedLevel} options={levelOptions} onChange={props.setSelectedLevel} />
              <ComposerMenuControl label="策略" value={props.selectedConflict} options={CONFLICT_OPTIONS} onChange={props.setSelectedConflict} />
            </div>
            <div className="composer-submit">
              <button id="sendBtn" type="submit" title="发送" disabled={props.sendBusy}><Send size={15} />{props.sendBusy ? "发送中" : "发送"}</button>
            </div>
          </div>
        </div>
      </form>
    </>
  );
}

function MentionMenu({ capabilities, insertMention }: { capabilities: RemoteCapabilities | null; insertMention: (token: string) => void }) {
  const groups = mentionGroups(capabilities);
  const hasItems = groups.some((group) => group.items.length);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="tool-btn mention-tool" type="button" title="引用上下文" aria-label="引用上下文">
          <AtSign size={16} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="dropdown-panel mention-menu-panel" sideOffset={8} align="start">
          <DropdownMenu.Label className="dropdown-label">引用上下文</DropdownMenu.Label>
          {hasItems ? groups.map((group) => (
            <React.Fragment key={group.key}>
              <DropdownMenu.Label className="mention-menu-group">{group.label}</DropdownMenu.Label>
              {group.items.map((item) => (
                <DropdownMenu.Item
                  className="dropdown-item mention-menu-item"
                  key={`${group.key}-${item.value || item.id || item.description}`}
                  onSelect={() => item.value && insertMention(item.value)}
                >
                  <span className="mention-menu-icon">{group.icon}</span>
                  <span className="mention-menu-main">
                    <strong>{pickerItemTitle(item)}</strong>
                    <small>{item.description || item.meta || item.value}</small>
                  </span>
                </DropdownMenu.Item>
              ))}
            </React.Fragment>
          )) : (
            <DropdownMenu.Item className="dropdown-item mention-menu-item muted">
              <span className="mention-menu-icon"><AtSign size={14} /></span>
              <span className="mention-menu-main">
                <strong>暂无引用源</strong>
                <small>启用 MCP 或 Skills 后会出现在这里</small>
              </span>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className="dropdown-separator" />
          <DropdownMenu.Item className="dropdown-item compact" disabled={!hasItems}>
            {hasItems ? "选择后会插入到输入框" : "状态页可查看服务状态"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ComposerMenuControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const selected = value || SELECT_DEFAULT_VALUE;
  return (
    <Select.Root value={selected} onValueChange={(next) => onChange(next === SELECT_DEFAULT_VALUE ? "" : next)}>
      <Select.Trigger className="composer-menu-control" aria-label={label}>
        <span>{label}</span>
        <Select.Value className="composer-menu-value" />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="select-panel" position="popper" sideOffset={8} align="start">
          <Select.Viewport className="select-viewport">
            {options.map((option) => (
              <Select.Item className="select-item" key={`${label}-${option.value || "default"}`} value={option.value || SELECT_DEFAULT_VALUE}>
                <Select.ItemText>{option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function renderRows(props: React.ComponentProps<typeof ThreadPane>) {
  return groupDisplayItems(collectDisplayItems(props)).map((group) => <TurnGroup key={group.key} group={group} props={props} />);
}

function collectDisplayItems(props: React.ComponentProps<typeof ThreadPane>) {
  const items: DisplayItem[] = [];
  const liveEvents = props.liveEvents.filter((item) => item.thread_id === props.thread?.thread_id);
  const assistantBuffers = new Map<string, DisplayMessage>();
  const flushAssistantBuffers = () => {
    for (const buffered of assistantBuffers.values()) {
      if (buffered.text.trim()) items.push(buffered);
    }
    assistantBuffers.clear();
  };
  const queueAssistantDelta = (event: TimelineEvent, fallback: string) => {
    const text = assistantDeltaText(event);
    if (!text) return false;
    const turnKey = eventTurnKey(event, fallback);
    const previous = assistantBuffers.get(turnKey);
    assistantBuffers.set(turnKey, {
      kind: "message",
      key: previous?.key || `assistant-stream-${turnKey}`,
      role: "assistant",
      label: "回复",
      text: `${previous?.text || ""}${text}`,
      time: eventTimeLabel(event) || previous?.time,
      occurredAt: displayEventTime(event) || previous?.occurredAt,
      forkable: true,
    });
    return true;
  };
  for (const [index, event] of props.events.entries()) {
    if (queueAssistantDelta(event, `stored-${index}`)) continue;
    if (isUserDisplayEvent(event)) flushAssistantBuffers();
    if (isAssistantFinalEvent(event)) assistantBuffers.delete(eventTurnKey(event, `stored-${index}`));
    const item = displayItemForEvent(event, `stored-${index}`);
    if (item) items.push(item);
  }
  for (const [index, event] of liveEvents.entries()) {
    if (queueAssistantDelta(event, `live-${index}`)) continue;
    if (isUserDisplayEvent(event)) flushAssistantBuffers();
    if (isAssistantFinalEvent(event)) assistantBuffers.delete(eventTurnKey(event, `live-${index}`));
    const item = displayItemForEvent(event, `live-${index}`);
    if (item) items.push(item);
  }
  flushAssistantBuffers();
  const visibleTurnIds = new Set(liveEvents.map((event) => String(event.turn_id || "")).filter(Boolean));
  for (const [turnId, text] of props.liveReasoningDrafts) {
    if (visibleTurnIds.size && !visibleTurnIds.has(turnId)) continue;
    items.push({ kind: "message", key: `reasoning-draft-${turnId}`, role: "reasoning", label: "思考", text });
  }
  for (const [turnId, text] of props.liveDrafts) {
    if (visibleTurnIds.size && !visibleTurnIds.has(turnId)) continue;
    items.push({ kind: "message", key: `assistant-draft-${turnId}`, role: "assistant", label: "回复", text, forkable: true });
  }
  return items;
}

function displayItemForEvent(event: TimelineEvent, fallback: string): DisplayItem | null {
  const key = displayEventKey(event, fallback);
  const occurredAt = displayEventTime(event);
  if (isUserDisplayEvent(event)) {
    return { kind: "message", key, role: "user", label: "你", text: userTextForEvent(event), time: eventTimeLabel(event), occurredAt, editable: true };
  }
  if (isAssistantFinalEvent(event)) {
    const text = assistantTextForEvent(event);
    return { kind: "message", key, role: "assistant", label: "回复", text, time: eventTimeLabel(event), occurredAt, forkable: true };
  }
  if (isReasoningEvent(event)) {
    return { kind: "message", key, role: "reasoning", label: "工作过程", text: event.text || event.reasoning_text || "", time: eventTimeLabel(event), occurredAt };
  }
  const directChanges = changeSummaryForEvent(event);
  if (directChanges) return { kind: "change", key, summary: directChanges };
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

function displayEventKey(event: TimelineEvent, fallback: string) {
  const id = event._event_id ?? event.event_id ?? event.sequence ?? fallback;
  return `display-${String(id)}`;
}

function eventTurnKey(event: TimelineEvent, fallback: string) {
  return String(event.turn_id || event.run_id || event.response_id || event.thread_id || fallback);
}

function isUserDisplayEvent(event: TimelineEvent) {
  return event.type === "item.user" || event.type === "turn.submitted";
}

function isAssistantDeltaEvent(event: TimelineEvent) {
  return [
    "response.output_text.delta",
    "assistant.delta",
    "assistant.message.delta",
    "item.assistant_partial",
  ].includes(String(event.type || ""));
}

function isAssistantFinalEvent(event: TimelineEvent) {
  return [
    "item.model_response",
    "item.assistant",
    "assistant.message.completed",
    "assistant.completed",
    "response.output_text.done",
  ].includes(String(event.type || ""));
}

function isReasoningEvent(event: TimelineEvent) {
  return [
    "assistant.reasoning_delta",
    "assistant.reasoning_completed",
    "item.reasoning_partial",
    "item.reasoning",
  ].includes(String(event.type || ""));
}

function groupDisplayItems(items: DisplayItem[]) {
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

function TurnGroup({ group, props }: { group: TurnGroupModel; props: React.ComponentProps<typeof ThreadPane> }) {
  const processItems = group.items.filter(isProcessDisplayItem);
  const contextItems = group.items.filter((item) => item.kind === "message" && item.role === "system");
  const rawResultItems = group.items.filter((item) => !isProcessDisplayItem(item) && !(item.kind === "message" && item.role === "system"));
  const changeSummary = mergeDisplayChangeItems(rawResultItems.filter((item): item is DisplayChange => item.kind === "change"));
  const resultItems = rawResultItems.filter((item) => item.kind !== "change");
  return (
    <motion.section
      layout
      className={clsx("turn-card", !group.user && "standalone")}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {group.user && <TurnUser item={group.user} props={props} />}
      {!!(contextItems.length || resultItems.length || processItems.length || changeSummary) && (
        <motion.div layout className="turn-stack">
          <AnimatePresence initial={false}>
            {contextItems.map((item) => (
              <motion.div
                layout
                className="turn-motion-item"
                key={item.key}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
              >
                {renderDisplayItem(item, props)}
              </motion.div>
            ))}
            {!!processItems.length && (
              <motion.div layout className="turn-motion-item" key={`process-${group.key}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16, ease: "easeOut" }}>
                <ProcessDigest items={processItems} openEvents={() => props.openInfoTab("events")} />
              </motion.div>
            )}
            {changeSummary && (
              <motion.div layout className="turn-motion-item" key={`change-${group.key}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16, ease: "easeOut" }}>
                {renderDisplayItem({ kind: "change", key: `change-${group.key}`, summary: changeSummary }, props)}
              </motion.div>
            )}
            {resultItems.map((item) => (
              <motion.div
                layout
                className="turn-motion-item"
                key={item.key}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
              >
                {renderDisplayItem(item, props)}
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </motion.section>
  );
}

function mergeDisplayChangeItems(items: DisplayChange[]): ChangeSummary | null {
  if (!items.length) return null;
  const seen = new Set<string>();
  const files = new Set<string>();
  let additions = 0;
  let deletions = 0;
  for (const item of items) {
    const summary = item.summary;
    const signature = `${[...summary.files].sort().join("|")}::${summary.additions}::${summary.deletions}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    additions += summary.additions;
    deletions += summary.deletions;
    for (const file of summary.files) files.add(file);
  }
  if (!files.size && additions === 0 && deletions === 0) return null;
  return { files: [...files], filesCount: files.size, additions, deletions };
}

function isProcessDisplayItem(item: DisplayItem) {
  return item.kind === "message" && (item.role === "reasoning" || item.role === "tool");
}

function ProcessDigest({ items, openEvents }: { items: DisplayItem[]; openEvents: () => void }) {
  const toolCount = items.filter((item) => item.kind === "message" && item.role === "tool").length;
  const reasoningCount = items.filter((item) => item.kind === "message" && item.role === "reasoning").length;
  const previewItems = items.filter((item): item is DisplayMessage => item.kind === "message").slice(-5);
  const workLabel = processWorkLabel(previewItems);
  const summary = processDigestSummary(toolCount, reasoningCount);
  return (
    <details className="process-digest">
      <summary>
        <span className="process-digest-icon" aria-hidden="true"><Workflow size={13} /></span>
        <span className="process-digest-main">
          <small>任务进展</small>
          <strong>{summary}</strong>
        </span>
        <span className="process-digest-time">{workLabel}</span>
        <span className="process-digest-arrow" aria-hidden="true" />
      </summary>
      <div className="process-digest-list">
        {previewItems.map((item) => (
          <span className="process-digest-row" key={item.key}>
            <strong>{foldLabel(item)}</strong>
            <small>{previewText(item.text, 120) || "暂无内容"}</small>
          </span>
        ))}
        <button type="button" className="process-digest-more" onClick={openEvents}>查看完整进展</button>
      </div>
    </details>
  );
}

function processDigestSummary(toolCount: number, reasoningCount: number) {
  const parts = [];
  if (reasoningCount) parts.push(`${reasoningCount} 步分析`);
  if (toolCount) parts.push(`${toolCount} 次执行`);
  return parts.length ? parts.join(" · ") : "正在整理";
}

function processWorkLabel(items: DisplayMessage[]) {
  const times = items.map((item) => item.occurredAt || 0).filter(Boolean).sort((a, b) => a - b);
  if (times.length >= 2) {
    const duration = Math.max(0, (times.at(-1) || 0) - times[0]);
    if (duration >= 1000) return `已工作 ${formatShortDuration(duration)}`;
  }
  const latest = items.at(-1)?.time;
  return latest || "已整理";
}

function formatShortDuration(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.max(1, Math.round(minutes / 60))} 小时`;
}

function ThreadRunStrip({
  thread,
  status,
  changes,
  level,
  openEvents,
}: {
  thread: Thread | null;
  status: Status;
  changes: ChangeSummary | null;
  level: string;
  openEvents: () => void;
}) {
  const detail = threadRunDetail(thread, status, changes, level);
  const action = changes ? "查看变更" : "查看活动";
  return (
    <button className={clsx("thread-run-strip", status.className, changes && "has-changes")} type="button" title={action} aria-label={`${threadRunTitle(thread, status, changes)} ${detail}，${action}`} onClick={openEvents}>
      <span className="run-dot" />
      <span className="run-main">
        <strong>{threadRunTitle(thread, status, changes)}</strong>
        <small>{detail}</small>
      </span>
      <span className="run-action" aria-hidden="true">›</span>
    </button>
  );
}

function TurnUser({ item, props }: { item: DisplayMessage; props: React.ComponentProps<typeof ThreadPane> }) {
  const folded = shouldFoldText(item.text, 190, 4);
  const actions = messageActions(item.role, item.text, props.copyText, item.editable ? props.editMessageDraft : undefined);
  if (!folded) {
    return (
      <div className="turn-user">
        <div className="turn-user-head">
          <span>你</span>
          {item.time && <span>{item.time}</span>}
        </div>
        <div className="turn-user-bubble">
          <div className="turn-user-text">{item.text}</div>
          {item.text.trim() && <div className="message-actions">{actions}</div>}
        </div>
      </div>
    );
  }
  return (
    <div className="turn-user">
      <div className="turn-user-head">
        <span>你</span>
        {item.time && <span>{item.time}</span>}
      </div>
      <details className="turn-user-bubble foldable">
        <summary>
          <span className="fold-preview">{textPreview(item.text, 92)}</span>
          <span className="fold-indicator" aria-hidden="true" />
        </summary>
        <div className="turn-user-text">{item.text}</div>
        {item.text.trim() && <div className="message-actions">{actions}</div>}
      </details>
    </div>
  );
}

function renderDisplayItem(item: DisplayItem, props: React.ComponentProps<typeof ThreadPane>) {
  if (item.kind === "change") {
    return <ChangeRow key={item.key} summary={item.summary} openEvents={() => props.openInfoTab("events")} undo={props.prepareChangeUndo} />;
  }
  if (item.role === "system") return <AttachmentLine key={item.key} item={item} />;
  return <FoldBlock key={item.key} item={item} props={props} />;
}

function FoldBlock({ item, props }: { item: DisplayMessage; props: React.ComponentProps<typeof ThreadPane> }) {
  const collapsed = item.role === "tool" || item.role === "reasoning" || shouldFoldText(item.text, item.role === "assistant" ? 1200 : 420, item.role === "assistant" ? 16 : 7);
  const actions = messageActions(item.role, item.text, props.copyText, undefined, item.forkable ? props.forkMessageDraft : undefined);
  return (
    <details className={clsx("fold-block", item.role)} open={!collapsed}>
      <summary>
        <span className="fold-title">{foldLabel(item)}</span>
        <span className="fold-preview">{previewText(item.text, item.role === "assistant" ? 156 : 120) || "暂无内容"}</span>
        <span className="fold-indicator" aria-hidden="true" />
      </summary>
      <div className={clsx("fold-body", item.role === "assistant" && "assistant-body", item.role === "tool" && "tool-body")}>
        {item.role === "assistant" || item.role === "tool" ? <RichText text={item.text} compact={item.role === "tool"} /> : item.text}
      </div>
      {item.text.trim() && <div className="message-actions">{actions}{item.time && <span className="message-time">{item.time}</span>}</div>}
    </details>
  );
}

function RichText({ text, compact = false }: { text: string; compact?: boolean }) {
  const blocks = splitRichBlocks(text);
  return (
    <div className={clsx("rich-text", compact && "compact")}>
      {blocks.map((block, index) => block.kind === "code" ? (
        <figure className="rich-code" key={`code-${index}`}>
          {block.lang && <figcaption>{block.lang}</figcaption>}
          <pre><code>{block.text}</code></pre>
        </figure>
      ) : renderRichTextBlock(block.text, index))}
    </div>
  );
}

type RichBlock = { kind: "text" | "code"; text: string; lang?: string };

function splitRichBlocks(text: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  const pattern = /```([A-Za-z0-9_-]*)\n([\s\S]*?)```/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index || 0;
    const before = text.slice(cursor, start).trim();
    if (before) blocks.push({ kind: "text", text: before });
    blocks.push({ kind: "code", lang: match[1]?.trim(), text: match[2].replace(/\n$/, "") });
    cursor = start + match[0].length;
  }
  const tail = text.slice(cursor).trim();
  if (tail) blocks.push({ kind: "text", text: tail });
  return blocks.length ? blocks : [{ kind: "text", text }];
}

function renderRichTextBlock(text: string, index: number) {
  const nodes: React.ReactNode[] = [];
  const lines = text.split(/\r?\n/);
  let paragraph: string[] = [];
  let list: Array<{ text: string; ordered: boolean }> = [];

  const flushParagraph = () => {
    const value = paragraph.join(" ").trim();
    if (value) nodes.push(<p key={`p-${index}-${nodes.length}`}>{inlineRichText(value)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    const ordered = list.every((item) => item.ordered);
    const Tag = ordered ? "ol" : "ul";
    nodes.push(
      <Tag key={`list-${index}-${nodes.length}`}>
        {list.map((item, itemIndex) => <li key={itemIndex}>{inlineRichText(item.text)}</li>)}
      </Tag>
    );
    list = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      nodes.push(<h3 key={`h-${index}-${nodes.length}`}>{inlineRichText(heading[2])}</h3>);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || ordered) {
      flushParagraph();
      list.push({ text: (bullet?.[1] || ordered?.[1] || "").trim(), ordered: Boolean(ordered) });
      continue;
    }
    if (list.length) flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return <React.Fragment key={`text-${index}`}>{nodes.length ? nodes : <p>{inlineRichText(text)}</p>}</React.Fragment>;
}

function inlineRichText(text: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /`([^`]+)`/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index || 0;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    nodes.push(<code key={`code-${nodes.length}`}>{match[1]}</code>);
    cursor = start + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function AttachmentLine({ item }: { item: DisplayMessage }) {
  const isImage = item.label === "图片";
  return (
    <div className={clsx("context-line", isImage ? "image" : "file")}>
      <span className="context-dot" aria-hidden="true">{isImage ? <ImageIcon size={12} /> : <FilePlus2 size={12} />}</span>
      <span className="context-chip">
        <span>{item.label}</span>
        <strong>{item.text}</strong>
      </span>
      {item.time && <span className="context-time">{item.time}</span>}
    </div>
  );
}

function threadRunTitle(thread: Thread | null, status: Status, changes: ChangeSummary | null) {
  if (!thread) return "准备开始新任务";
  if (changes) return "更改";
  if (status.className === "running") return "运行中";
  if (status.className === "error") return "待处理";
  if (status.label === "已停止") return "已停止";
  return status.className === "done" ? "已完成" : "就绪";
}

function threadRunDetail(thread: Thread | null, status: Status, changes: ChangeSummary | null, level: string) {
  if (!thread) return "输入消息后会创建新的线程";
  const model = thread.active_model || "模型未指定";
  const levelText = level ? levelLabel(level) : "默认档位";
  if (changes) {
    return `+${changes.additions} -${changes.deletions}`;
  }
  if (status.className === "running") return `${model} · ${levelText}`;
  if (status.className === "error") return "打开活动查看原因";
  if (status.label === "已停止") return "可以继续输入";
  const updated = thread.updated_at ? ` · 更新于 ${formatRelativeTime(thread.updated_at)}` : "";
  return `${model}${updated}`;
}

function taskProgressText(thread: Thread | null, status: Status, visibleEventCount: number) {
  if (!thread) return "发送第一条消息后会创建任务";
  if (status.className === "running") return "正在执行，新的回复和变更会自动同步";
  if (status.className === "error") return "需要处理最近一次运行结果";
  if (status.label === "已停止") return "已接管，可以继续输入下一步";
  if (visibleEventCount) return `${visibleEventCount} 条进展已整理`;
  return "等待下一次提交";
}

function runtimeSummary(config: RemoteConfig | null, state: ReturnType<typeof connectionState>) {
  if (!config) return "等待远程服务提供入口";
  if (state.className === "done") return "浏览器会话已连接到远程服务";
  if (state.className === "running") return "正在同步远程服务状态";
  if (state.className === "error") return "连接中断，页面会保留本地缓存";
  return "远程入口已准备";
}

function threadMetaItems(project: ProjectInfo | null, thread: Thread | null, level: string) {
  const items: Array<{ kind: string; label: string; icon?: React.ReactNode }> = [];
  items.push({ kind: "workspace", label: project?.name || "工作区", icon: <Folder size={13} /> });
  if (thread?.active_model) items.push({ kind: "model", label: thread.active_model });
  if (level) items.push({ kind: "level", label: levelLabel(level) });
  if (thread?.turn_count) items.push({ kind: "turns", label: `${thread.turn_count} 轮` });
  if (!thread && level) return items;
  if (!thread) items.push({ kind: "draft", label: "新任务" });
  return items.slice(0, 4);
}

function composerTitle(thread: Thread | null, status: Status) {
  if (!thread) return "新任务";
  if (status.className === "running") return "任务运行中";
  if (status.className === "error") return "继续修复";
  return "继续这条任务线";
}

function composerFocusDetail(thread: Thread | null, level: string, conflict: string) {
  if (!thread) return "发送后创建线程";
  const pieces = [
    thread.active_model || "",
    level ? levelLabel(level) : "",
    conflictLabel(conflict),
  ].filter(Boolean);
  return pieces.join(" · ") || "准备继续";
}

function composerHint(thread: Thread | null, status: Status, attachments: number) {
  if (attachments) return `${attachments} 个素材会随本轮发送`;
  if (!thread) return "发送后会创建线程";
  if (status.className === "running") return "可以排队、询问或接管";
  if (thread.updated_at) return `上次更新 ${formatRelativeTime(thread.updated_at)}`;
  return "输入下一步指令";
}

function composerStateLabel(status: Status, hasDraft: boolean) {
  if (status.className === "running") return "运行中";
  if (hasDraft) return "有草稿";
  if (status.className === "error") return "待处理";
  return "就绪";
}

function composerPlaceholder(thread: Thread | null, attachments: number) {
  if (attachments) return "描述这批素材的处理方式";
  if (!thread) return "初始化任务";
  return "提出后续修改要求";
}

function foldLabel(item: DisplayMessage) {
  if (item.role === "reasoning") return "分析";
  if (item.role === "tool") return "执行";
  if (item.role === "error") return "需要处理";
  return item.label;
}

function shouldFoldText(text: string, maxChars = 520, maxLines = 8) {
  return text.length > maxChars || text.split(/\r?\n/).length > maxLines;
}

function textPreview(text: string, max = 120) {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function previewText(text: string, max = 120) {
  return textPreview(stripMarkdownMarkers(text), max);
}

function stripMarkdownMarkers(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1");
}

function messageActions(role: string, text: string, copyText: (text: string) => Promise<void>, edit?: (text: string) => void, fork?: (text: string) => void) {
  const buttons = [];
  if (role === "user" && edit) buttons.push(<ActionButton key="edit" title="编辑" symbol="✎" onClick={() => edit(text)} icon={<Pencil />} />);
  buttons.push(<ActionButton key="copy" title="复制" symbol="⎘" onClick={() => void copyText(text)} icon={<Copy />} />);
  if (role === "assistant") {
    if (fork) buttons.push(<ActionButton key="fork" title="分支" symbol="↳" onClick={() => fork(text)} icon={<GitFork />} />);
  }
  return buttons;
}

function ActionButton({ title, symbol, icon, onClick }: { title: string; symbol: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="message-action" title={title} data-symbol={symbol} onClick={onClick}>
      <span className="action-icon">{icon}</span>
      <span className="action-label">{title}</span>
    </button>
  );
}

function ChangeRow({ summary, openEvents, undo }: { summary: ChangeSummary; openEvents: () => void; undo: (summary: ChangeSummary) => void }) {
  const fileText = summary.filesCount ? `${summary.filesCount} 个文件已更改` : "文件已更改";
  return (
    <div className="event-row change">
      <div className="change-card">
        <button className="change-main" type="button" onClick={openEvents}>
          <span className="change-icon">›</span>
          <span className="change-title">{fileText}</span>
          <span className="change-stat add">+{summary.additions}</span>
          <span className="change-stat del">-{summary.deletions}</span>
        </button>
        {!!summary.files.length && <div className="change-files">{summary.files.slice(0, 3).join(" · ")}</div>}
        <button className="change-detail" type="button" onClick={() => undo(summary)}>撤销</button>
      </div>
    </div>
  );
}

function InfoPane(props: {
  thread: Thread | null;
  project: ProjectInfo | null;
  config: RemoteConfig | null;
  capabilities: RemoteCapabilities | null;
  events: TimelineEvent[];
  attachments: AttachmentDraft[];
  infoTab: InfoTab;
  setInfoTab: (tab: InfoTab) => void;
  eventFilter: EventFilter;
  setEventFilter: (filter: EventFilter) => void;
  close: () => void;
  cancelSelectedThread: () => Promise<void>;
  db: IDBDatabase | null;
  lastSeq: number;
  connection: string;
  runningCount: number;
  status: Status;
  changes: ChangeSummary | null;
}) {
  const paneTitle = props.thread?.title || props.project?.name || "远程工作区";
  const paneMeta = props.thread?.updated_at ? `更新于 ${formatRelativeTime(props.thread.updated_at)}` : props.project?.path || "选择任务后查看上下文";
  return (
    <aside className="info-pane">
      <header className="info-head">
        <IconButton title="关闭" className="drawer-close" onClick={props.close}><ChevronLeft /></IconButton>
        <div>
          <h2>工作台</h2>
          <p title={paneTitle}>{paneTitle} · {paneMeta}</p>
        </div>
        <div className="info-head-tools">
          <span className={clsx("info-head-state", props.status.className)}>{props.status.label}</span>
          {props.status.className === "running" && (
            <IconButton title="停止当前运行" className="info-stop" onClick={() => void props.cancelSelectedThread()}><CircleStop /></IconButton>
          )}
        </div>
      </header>
      <Tabs.Root className="info-tabs-root" value={props.infoTab} onValueChange={(value) => props.setInfoTab(value as InfoTab)}>
        <Tabs.List className="info-tabs" aria-label="工作台信息">
          {[
            ["overview", "上下文"],
            ["events", "活动"],
            ["attachments", "素材"],
            ["status", "运行"],
          ].map(([tab, label]) => (
            <Tabs.Trigger key={tab} className="info-tab" value={tab}>{label}</Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content className="info-content" value="overview">
          <OverviewPanel {...props} />
        </Tabs.Content>
        <Tabs.Content className="info-content" value="events">
          <EventsPanel events={props.events} eventFilter={props.eventFilter} setEventFilter={props.setEventFilter} />
        </Tabs.Content>
        <Tabs.Content className="info-content" value="attachments">
          <AttachmentsPanel events={props.events} attachments={props.attachments} />
        </Tabs.Content>
        <Tabs.Content className="info-content" value="status">
          <StatusPanel {...props} />
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  );
}

function OverviewPanel({ project, thread, events, attachments, status, changes, connection, setInfoTab, cancelSelectedThread }: React.ComponentProps<typeof InfoPane>) {
  const productEvents = events.filter(isProductEvent);
  const attachmentCount = attachmentEvents(events).length + attachments.length;
  const visibleEventCount = productEvents.length;
  const digest = activityDigest(productEvents);
  const latest = productEvents.length ? activityEntryForEvent(productEvents[productEvents.length - 1], productEvents.length - 1) : null;
  const taskText = thread?.last_text ? compactText(thread.last_text, 150) : status.className === "running" ? "任务正在执行，新的结果会自动追加到详情页。" : "还没有提交内容，可以从底部输入框开始新的任务。";
  const updateText = thread?.updated_at ? formatRelativeTime(thread.updated_at) : "等待活动";
  const modelText = [thread?.active_model || "默认模型", thread?.active_level ? levelLabel(thread.active_level) : ""].filter(Boolean).join(" · ");
  const change = changes || digest.changes;
  const changeText = change ? changeSummaryText(change) : "暂无文件变更";
  const materialText = attachmentCount ? `${attachmentCount} 个素材已绑定` : "输入框上传后自动绑定";
  const progressText = taskProgressText(thread, status, visibleEventCount);
  const connectionText = connectionState(connection).label;
  return (
    <>
      <section className="task-brief workbench-brief">
        <div className="task-brief-head">
          <span className="task-kicker">当前焦点</span>
          <span className={clsx("task-status-chip", status.className)}>{status.label}</span>
        </div>
        <strong className="task-title">{thread?.title || project?.name || "新任务"}</strong>
        <p className="task-body">{taskText}</p>
        <div className="task-focus-list" aria-label="任务焦点">
          <TaskFocusItem icon={<Activity />} title="任务进度" body={progressText} state={status.className} />
          <TaskFocusItem icon={<Paperclip />} title="素材上下文" body={materialText} state={attachmentCount ? "done" : "muted"} />
          <TaskFocusItem icon={<GitFork />} title="文件变化" body={changeText} state={change ? "done" : "muted"} />
        </div>
        <div className="workbench-actions info-actions" aria-label="工作台操作">
          <WorkbenchAction icon={<Activity />} label="看活动" meta={visibleEventCount ? `${visibleEventCount} 条` : "暂无"} onClick={() => setInfoTab("events")} />
          <WorkbenchAction icon={<UploadCloud />} label="素材" meta={attachmentCount ? `${attachmentCount} 个` : "待上传"} onClick={() => setInfoTab("attachments")} />
          <WorkbenchAction icon={<ShieldCheck />} label="运行" meta={connectionText} onClick={() => setInfoTab("status")} state={status.className} />
          {status.className === "running" && (
            <WorkbenchAction icon={<CircleStop />} label="停止" meta="当前任务" onClick={() => void cancelSelectedThread()} state="error" />
          )}
        </div>
      </section>
      <section className="workbench-card">
        <header className="workbench-card-head">
          <span>上下文</span>
          <strong>任务环境</strong>
        </header>
        <div className="workbench-row-list">
          <WorkbenchRow icon={<Folder />} label={project?.name || "当前工作区"} value={project?.path || "等待同步项目路径"} detail={updateText} />
          <WorkbenchRow icon={<Sparkles />} label="模型" value={modelText} detail={thread?.active_level ? "沿用当前任务配置" : "发送时使用默认档位"} />
          <WorkbenchRow icon={<Activity />} label="任务进展" value={progressText} detail={latest?.meta || updateText} tone={status.className} />
          <WorkbenchRow icon={<Paperclip />} label="素材绑定" value={materialText} detail={attachmentCount ? "图片进入上下文，文件作为引用" : "支持图片和文件"} tone={attachmentCount ? "done" : "muted"} />
          <WorkbenchRow icon={<GitFork />} label="文件变更" value={changeText} detail={change ? "可在进展里回看" : "运行后自动整理"} tone={change ? "done" : "muted"} />
        </div>
      </section>
      {latest && (
        <section className="latest-activity">
          <span>最近活动</span>
          <strong>{latest.title}</strong>
          <small>{latest.body || latest.meta}</small>
        </section>
      )}
    </>
  );
}

function EventsPanel({ events, eventFilter, setEventFilter }: { events: TimelineEvent[]; eventFilter: EventFilter; setEventFilter: (filter: EventFilter) => void }) {
  const productEvents = events.filter(isProductEvent);
  const digest = activityDigest(productEvents);
  const filtered = eventFilter === "all" ? productEvents : productEvents.filter((event) => eventCategory(event) === eventFilter);
  const entries = filtered.slice(-24).reverse().map(activityEntryForEvent);
  return (
    <>
      <section className="activity-hero">
        <span>活动</span>
        <strong>{activityDigestTitle(digest)}</strong>
        <p>{activityDigestBody(digest)}</p>
      </section>
      <ActivitySnapshot digest={digest} />
      <div className="event-filter-bar">
        {[
          ["all", "全部"],
          ["message", "对话"],
          ["tool", "执行"],
          ["attachment", "素材"],
          ["system", "运行"],
        ].map(([value, label]) => (
          <button key={value} type="button" className={clsx("event-filter", eventFilter === value && "active")} onClick={() => setEventFilter(value as EventFilter)}>{label}</button>
        ))}
      </div>
      <div className="activity-list">
        {entries.length ? (
          entries.map((entry) => <ActivityItem key={entry.key} entry={entry} />)
        ) : (
          <SideItem title="暂无记录" body={eventFilter === "all" ? "当前任务还没有活动" : "当前筛选没有活动"} />
        )}
      </div>
    </>
  );
}

function AttachmentsPanel({ events, attachments }: { events: TimelineEvent[]; attachments: AttachmentDraft[] }) {
  const items = materialEntries(events, attachments);
  const pendingItems = items.filter((item) => item.pending);
  const committedItems = items.filter((item) => !item.pending);
  const imageCount = items.filter((item) => item.kind === "image").length;
  const fileCount = items.length - imageCount;
  return (
    <>
      <section className="material-summary">
        <span>素材</span>
        <strong>{items.length ? `${items.length} 个素材` : "暂无素材"}</strong>
        <p>{items.length ? materialSummaryText(pendingItems.length, committedItems.length, imageCount, fileCount) : "素材会在发送时上传；输入框 token 决定是否随本轮提交。"}</p>
        {items.length > 0 && (
          <div className="material-stat-grid" aria-label="素材摘要">
            <MaterialStat label="待发送" value={pendingItems.length} />
            <MaterialStat label="已提交" value={committedItems.length} />
            <MaterialStat label="图片" value={imageCount} />
            <MaterialStat label="文件" value={fileCount} />
          </div>
        )}
      </section>
      {items.length ? (
        <div className="material-board">
          <MaterialGroup title="待发送" body="这些素材保存在浏览器本地，点击发送时才会上传。" items={pendingItems} empty="没有等待发送的素材" />
          <MaterialGroup title="已提交" body="这些素材已经随任务同步，可用于回看输入。" items={committedItems} empty="还没有已提交素材" />
          <MaterialGuide />
        </div>
      ) : (
        <div className="material-list">
          <SideItem title="暂无素材" body="当前线程还没有附件" />
        </div>
      )}
    </>
  );
}

function StatusPanel({ config, capabilities, project, connection, runningCount }: React.ComponentProps<typeof InfoPane>) {
  const limits = capabilities?.limits || {};
  const features = capabilities?.tui_features || [];
  const state = connectionState(connection);
  const authLabel = config?.auth_mode === "none" ? "外部鉴权" : "验证码保护";
  const authHint = config?.auth_mode === "none" ? "端口访问保护由用户环境负责" : "浏览器会话已通过验证码进入";
  const uploadText = uploadLimitText(limits);
  const levels = capabilities?.core?.models?.levels || [];
  const pickers = capabilities?.core?.pickers || {};
  const contextSources = pickerTotal(pickers.mcp) + pickerTotal(pickers.skills);
  const modelLabel = levels.length ? `${levels.length} 个档位` : capabilities?.core?.agent_api ? "等待模型配置" : "等待能力摘要";
  return (
    <>
      <section className="env-hero">
        <div className="env-hero-main">
          <span className={clsx("env-pulse", state.className)}><Radio /></span>
          <span className="env-hero-copy">
            <span>运行入口</span>
            <strong>{project?.name || "uv-agent"}</strong>
            <small>{runtimeSummary(config, state)}</small>
          </span>
          <span className={clsx("env-state-pill", state.className)}>{state.label}</span>
        </div>
        <div className="env-signal-grid">
          <EnvironmentSignal label="保护" value={authLabel} hint={authHint} state={config?.auth_mode === "none" ? "muted" : "done"} />
          <EnvironmentSignal label="队列" value={runningCount ? `${runningCount} 个运行中` : "空闲"} hint={runningCount ? "可在进展里跟进" : "可以提交新任务"} state={runningCount ? "running" : "done"} />
          <EnvironmentSignal label="模型" value={modelLabel} hint={levels.length ? "输入框可直接切换" : "使用默认档位提交"} state={levels.length ? "done" : "muted"} />
          <EnvironmentSignal label="提交" value={uploadText} hint="消息与附件会在发送时校验" state="done" />
          <EnvironmentSignal label="上下文" value={contextSources ? `${contextSources} 个入口` : "未索引"} hint="输入框 @ 菜单可插入" state={contextSources ? "done" : "muted"} />
        </div>
      </section>
      <EnvironmentStack capabilities={capabilities} />
      <CapabilityDock features={features} />
      <div className="connection-note">
        <span>{project?.name || "uv-agent"}</span>
        <strong>{project?.path || config?.url || "远程入口"}</strong>
        <small>{state.hint}</small>
      </div>
    </>
  );
}

function EnvironmentSignal({ label, value, hint, state }: { label: string; value: string; hint: string; state: Status["className"] }) {
  return (
    <span className={clsx("env-signal", state)}>
      <small>{label}</small>
      <strong>{value}</strong>
      <em>{hint}</em>
    </span>
  );
}

function EnvironmentStack({ capabilities }: { capabilities: RemoteCapabilities | null }) {
  const core = capabilities?.core;
  const levels = core?.models?.levels || [];
  const pickers = core?.pickers || {};
  return (
    <div className="environment-stack">
      <section className="env-card">
        <header className="env-card-head">
          <span>
            <Sparkles size={15} />
            模型
          </span>
          <strong>{levels.length ? `${levels.length} 个可选` : core?.agent_api ? "暂无档位" : "等待接入"}</strong>
        </header>
        <div className="env-row-list">
          {levels.length ? levels.slice(0, 5).map((level) => <ModelLevelRow key={level.id || level.model || "level"} level={level} defaultLevel={core?.models?.default_level || ""} />) : (
                <EnvironmentEmpty title={core?.agent_api ? "还没有可展示模型" : "能力摘要未接入"} body={core?.agent_api ? "检查配置里的 public levels" : "升级后会显示模型、provider 和上下文窗口"} />
          )}
        </div>
      </section>
      <section className="env-card">
        <header className="env-card-head">
          <span>
            <Workflow size={15} />
            上下文入口
          </span>
          <strong>{toolIndexSummary(pickers)}</strong>
        </header>
        <div className="tool-index">
          <PickerBlock title="MCP" picker={pickers.mcp} empty="没有声明 MCP server" />
          <PickerBlock title="Skills" picker={pickers.skills} empty="没有发现可插入 skill" />
        </div>
      </section>
    </div>
  );
}

function ModelLevelRow({ level, defaultLevel }: { level: ModelLevelSummary; defaultLevel: string }) {
  const id = String(level.id || "");
  const model = String(level.model || level.model_name || "");
  const provider = String(level.provider || "");
  const tags = [
    id === defaultLevel ? "默认" : "",
    level.supports_images ? "图像" : "",
    level.context_window_tokens ? `${Math.round(level.context_window_tokens / 1000)}k` : "",
  ].filter(Boolean);
  return (
    <div className={clsx("env-row", level.status === "error" && "error")}>
      <span className="env-row-icon"><Sparkles size={15} /></span>
      <span className="env-row-main">
        <strong>{levelLabel(id)}</strong>
        <small>{[model, provider].filter(Boolean).join(" · ") || "模型配置待同步"}</small>
      </span>
      <span className="env-row-tags">
        {tags.length ? tags.map((tag) => <em key={tag}>{tag}</em>) : <em>{level.provider_configured ? "可用" : "待确认"}</em>}
      </span>
    </div>
  );
}

function PickerBlock({ title, picker, empty }: { title: string; picker?: PickerSummary; empty: string }) {
  const items = picker?.items || [];
  const count = Number(picker?.total || items.length || 0);
  return (
    <div className={clsx("picker-block", !picker?.available && "muted")}>
      <div className="picker-block-head">
        <strong>{title}</strong>
        <small>{picker?.available ? `${count} 个条目` : "未启用"}</small>
      </div>
      <div className="picker-items">
        {picker?.available && items.length ? items.slice(0, 4).map((item) => (
          <span className="picker-item" key={item.id || item.value || item.description}>
            <strong>{pickerItemTitle(item)}</strong>
            <small>{item.description || item.meta || item.value}</small>
          </span>
        )) : (
          <EnvironmentEmpty title={picker?.available ? empty : `${title} 插入源未注册`} body={picker?.available ? "可以继续正常提交任务" : "启用对应内置插件后会出现在这里"} />
        )}
      </div>
    </div>
  );
}

function EnvironmentEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="env-empty">
      <strong>{title}</strong>
      <small>{body}</small>
    </div>
  );
}

function CapabilityDock({ features }: { features: CapabilityFeature[] }) {
  const rows = features.map(capabilityRow);
  if (!rows.length) return null;
  const stats = capabilityStats(features);
  const readyPercent = stats.total ? Math.round((stats.ready / stats.total) * 100) : 0;
  const highlights = rows
    .filter((row) => row.stateClass !== "muted")
    .concat(rows.filter((row) => row.stateClass === "muted"))
    .slice(0, 7);
  return (
    <section className="capability-board" aria-label="可用能力">
      <header className="capability-board-head">
        <span>可用能力</span>
        <strong>{stats.ready}/{stats.total} 可用</strong>
      </header>
      <div className="capability-meter" aria-hidden="true">
        <span style={{ width: `${readyPercent}%` }} />
      </div>
      <p className="capability-summary">{capabilitySummary(features)}</p>
      <div className="capability-chip-list">
        {highlights.map((row) => (
          <span className={clsx("capability-chip", row.stateClass)} key={row.key} title={row.detail}>
            {capabilityIcon(row.key)}
            <strong>{row.label}</strong>
          </span>
        ))}
      </div>
    </section>
  );
}

function capabilityIcon(id: string) {
  if (id === "attachments") return <Paperclip size={13} />;
  if (id === "transcript") return <Activity size={13} />;
  if (id === "interrupt") return <CircleStop size={13} />;
  if (id === "status" || id === "config") return <Settings size={13} />;
  return <Sparkles size={13} />;
}

function StatusMini({ icon, label, value, hint = "" }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="status-mini">
      <span className="status-mini-icon">{icon}</span>
      <span className="status-mini-main">
        <span>{label}</span>
        <strong>{value || "-"}</strong>
        {hint && <small>{hint}</small>}
      </span>
    </div>
  );
}

function pickerTotal(picker?: PickerSummary) {
  if (!picker?.available) return 0;
  return Number(picker.total || picker.items?.length || 0);
}

function capabilityStats(features: CapabilityFeature[]) {
  const rows = features.map((feature) => capabilityStatus(feature.status));
  return {
    total: rows.length,
    ready: rows.filter((row) => row.className === "done").length,
    partial: rows.filter((row) => row.className === "running").length,
    waiting: rows.filter((row) => row.className === "muted").length,
    error: rows.filter((row) => row.className === "error").length,
  };
}

function TaskFocusItem({ icon, title, body, state }: { icon: React.ReactNode; title: string; body: string; state?: string }) {
  return (
    <div className={clsx("task-focus-item", state)}>
      <span className="task-focus-icon">{icon}</span>
      <span className="task-focus-main">
        <strong>{title}</strong>
        <small>{body || "-"}</small>
      </span>
    </div>
  );
}

function TaskMetric({ label, value, tone = "muted" }: { label: string; value: string; tone?: Status["className"] }) {
  return (
    <span className={clsx("task-metric", tone)}>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function WorkbenchRow({ icon, label, value, detail, tone = "muted" }: { icon: React.ReactNode; label: string; value: string; detail: string; tone?: Status["className"] }) {
  return (
    <div className={clsx("workbench-row", tone)}>
      <span className="workbench-row-icon">{icon}</span>
      <span className="workbench-row-main">
        <small>{label}</small>
        <strong title={value}>{value || "-"}</strong>
        <em>{detail}</em>
      </span>
    </div>
  );
}

function WorkbenchAction({ icon, label, meta, onClick, state = "muted" }: { icon: React.ReactNode; label: string; meta: string; onClick: () => void; state?: Status["className"] }) {
  return (
    <button type="button" className={clsx("workbench-action", state)} onClick={onClick}>
      <span className="workbench-action-icon">{icon}</span>
      <span className="workbench-action-main">
        <strong>{label}</strong>
        <small>{meta}</small>
      </span>
    </button>
  );
}

function SideItem({ title, body, meta = "" }: { title: string; body: string; meta?: string }) {
  return <div className="side-item"><strong>{title}</strong><span>{body || "-"}</span>{meta && <small>{meta}</small>}</div>;
}

function ActivitySnapshot({ digest }: { digest: ActivityDigest }) {
  if (!digest.total) return null;
  const stats = [
    { label: "对话", value: digest.messages, className: "message" },
    { label: "执行", value: digest.executions, className: "tool" },
    { label: "素材", value: digest.materials, className: "attachment" },
    { label: "运行", value: digest.contexts, className: "system" },
  ];
  const changedFiles = digest.changes?.files.slice(0, 4) || [];
  return (
    <section className="activity-snapshot" aria-label="活动摘要">
      <div className="activity-stat-grid">
        {stats.map((stat) => (
          <span key={stat.label} className={clsx("activity-stat", stat.className)}>
            <strong>{stat.value}</strong>
            <small>{stat.label}</small>
          </span>
        ))}
      </div>
      {digest.changes && (
        <div className="activity-change-card">
          <span className="activity-change-main">
            <strong>文件更改</strong>
            <small>{changeSummaryText(digest.changes)}</small>
          </span>
          {changedFiles.length > 0 && (
            <span className="activity-change-files">
              {changedFiles.map((file) => <em key={file}>{file}</em>)}
              {digest.changes.files.length > changedFiles.length && <em>+{digest.changes.files.length - changedFiles.length}</em>}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

function ActivityItem({ entry }: { entry: ActivityEntry }) {
  return (
    <div className={clsx("activity-item", entry.category)}>
      <span className="activity-dot" />
      <span className="activity-main">
        <strong>{entry.title}</strong>
        <span>{entry.body || "-"}</span>
      </span>
      {entry.meta && <small>{entry.meta}</small>}
    </div>
  );
}

function MaterialStat({ label, value }: { label: string; value: number }) {
  return (
    <span className="material-stat">
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

function MaterialGroup({ title, body, items, empty }: { title: string; body: string; items: MaterialEntry[]; empty: string }) {
  return (
    <section className="material-section">
      <div className="material-section-head">
        <span>
          <strong>{title}</strong>
          <small>{body}</small>
        </span>
        <em>{items.length}</em>
      </div>
      <div className="material-list">
        {items.length ? items.map((item) => <MaterialItem key={item.key} item={item} />) : <SideItem title={empty} body="素材会跟随输入框 token 自动联动。" />}
      </div>
    </section>
  );
}

function MaterialGuide() {
  return (
    <section className="material-guide" aria-label="素材规则">
      <div className="material-guide-head">
        <Paperclip />
        <span>
          <strong>提交规则</strong>
          <small>删除输入框 token 会同步移除附件，发送时再校验和上传。</small>
        </span>
      </div>
      <div className="material-rule-list">
        <span className="material-rule image"><ImageIcon /><small>图片使用 [Image #] token，并直接进入模型上下文。</small></span>
        <span className="material-rule file"><FilePlus2 /><small>文件以名称和引用进入任务说明，便于后续处理。</small></span>
      </div>
    </section>
  );
}

function MaterialItem({ item }: { item: MaterialEntry }) {
  return (
    <div className={clsx("material-item", item.kind, item.pending && "pending")}>
      <span className="material-icon">{item.kind === "image" ? <ImageIcon /> : <FilePlus2 />}</span>
      <span className="material-main">
        <strong>{item.name || item.token || "素材"}</strong>
        <span className="material-context">{item.context}</span>
        <span className="material-token">{item.token || item.hint}</span>
        {item.hint && <small>{item.hint}</small>}
      </span>
      <em>{item.state}</em>
    </div>
  );
}

function CommandPalette({
  open,
  query,
  setQuery,
  close,
  threads,
  currentThread,
  status,
  changes,
  composerText,
  attachmentCount,
  startNewThread,
  selectThread,
  openInfoTab,
  setComposerText,
  focusComposer,
  clearComposer,
  cancelSelectedThread,
  startEditingTitle,
  prepareChangeUndo,
}: {
  open: boolean;
  query: string;
  setQuery: (value: string) => void;
  close: () => void;
  threads: Thread[];
  currentThread: Thread | null;
  status: Status;
  changes: ChangeSummary | null;
  composerText: string;
  attachmentCount: number;
  startNewThread: () => void;
  selectThread: (threadId: string) => void;
  openInfoTab: (tab: InfoTab) => void;
  setComposerText: (value: string) => void;
  focusComposer: () => void;
  clearComposer: () => void;
  cancelSelectedThread: () => void;
  startEditingTitle: () => void;
  prepareChangeUndo: (summary: ChangeSummary) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);
  if (!open) return null;
  const run = (action: () => void) => {
    close();
    action();
  };
  const currentTitle = currentThread?.title || "当前任务";
  const commandGroups: PaletteGroup[] = [
    {
      title: "建议动作",
      rows: [
        { title: "新建任务", meta: "Ctrl+N", keywords: "new thread 新建", action: () => run(startNewThread) },
        { title: currentThread ? "继续输入" : "打开输入框", meta: currentThread ? currentTitle : "草稿", keywords: "composer input 输入", action: () => run(focusComposer) },
        composerText || attachmentCount ? { title: "清空输入", meta: attachmentCount ? `${attachmentCount} 个素材` : "草稿", keywords: "clear composer 清空", action: () => run(clearComposer) } : null,
        status.className === "running" ? { title: "停止当前运行", meta: currentTitle, keywords: "cancel stop interrupt 停止 中断", action: () => run(cancelSelectedThread) } : null,
        changes ? { title: "生成撤销草稿", meta: `${changes.filesCount || changes.files.length} 个文件`, keywords: "undo revert 撤销", action: () => run(() => prepareChangeUndo(changes)) } : null,
      ],
    },
    {
      title: "任务面板",
      rows: [
        currentThread ? { title: "重命名任务", meta: currentTitle, keywords: "rename title 重命名", action: () => run(startEditingTitle) } : null,
        { title: "查看活动", meta: "消息、工具、素材", keywords: "events activity 活动", action: () => run(() => openInfoTab("events")) },
        { title: "查看素材", meta: "附件与待发送文件", keywords: "attachments files image 素材 附件", action: () => run(() => openInfoTab("attachments")) },
        { title: "查看运行", meta: "远程入口", keywords: "status connection auth 连接 运行", action: () => run(() => openInfoTab("status")) },
      ],
    },
    {
      title: "最近线程",
      rows: threads.slice(0, 12).map((thread) => ({
        title: thread.title || "New thread",
        meta: threadCardMeta(thread, [], statusForThread(thread, new Map(), [])) || formatRelativeTime(thread.updated_at) || "线程",
        keywords: `${thread.title || ""} ${thread.last_text || ""} ${thread.thread_id || ""}`,
        action: () => run(() => selectThread(thread.thread_id)),
      })),
    },
  ];
  const groups = filterPaletteGroups(commandGroups, query);
  if (query && !groups.some((group) => group.rows.length)) {
    groups.unshift({
      title: "建议动作",
      rows: [{ title: "用搜索内容创建任务", meta: "Enter", keywords: query, action: () => { run(() => { startNewThread(); setComposerText(query); }); } }],
    });
  }
  const firstRow = groups.flatMap((group) => group.rows)[0];
  return (
    <div className="palette-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="palette-panel" role="dialog" aria-modal="true">
        <header className="palette-head">
          <div>
            <h2>命令面板</h2>
            <p>搜索任务或执行当前工作区命令</p>
          </div>
          <IconButton title="关闭" onClick={close}><X /></IconButton>
        </header>
        <input
          ref={inputRef}
          className="palette-input"
          type="search"
          placeholder="搜索任务、线程或命令"
          value={query}
          onChange={(event) => setQuery(event.target.value.trim())}
          onKeyDown={(event) => {
            if (event.key === "Enter" && firstRow) {
              event.preventDefault();
              firstRow.action();
            }
          }}
        />
        <div className="palette-results">
          {groups.map((group) => (
            <section className="palette-group" key={group.title}>
              <h3>{group.title}</h3>
              {group.rows.map((row) => <button key={`${group.title}-${row.title}-${row.meta}`} type="button" className="palette-row" onClick={row.action}><span>{row.title}</span><small>{row.meta}</small></button>)}
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}

type PaletteRow = {
  title: string;
  meta: string;
  keywords: string;
  action: () => void;
};

type PaletteGroup = {
  title: string;
  rows: Array<PaletteRow | null>;
};

function filterPaletteGroups(groups: PaletteGroup[], query: string): Array<{ title: string; rows: PaletteRow[] }> {
  const value = query.trim().toLowerCase();
  return groups
    .map((group) => ({
      title: group.title,
      rows: group.rows
        .filter((row): row is PaletteRow => Boolean(row))
        .filter((row) => {
          if (!value) return true;
          const haystack = `${row.title} ${row.meta} ${row.keywords}`.toLowerCase();
          return haystack.includes(value);
        }),
    }))
    .filter((group) => group.rows.length > 0);
}

type SessionStep = {
  label: string;
  value: string;
  state: Status["className"];
};

function SessionOverview({ props, compact = false }: { props: ShellProps; compact?: boolean }) {
  const selected = focusThreadForInbox(props);
  const state = connectionState(props.connection);
  const updated = projectUpdatedAt(props.threads);
  const selectedStatus = selected ? statusForThread(selected, new Map(), props.liveEvents) : null;
  const title = compact ? selected?.title || "继续任务" : props.project?.name || "uv-agent";
  const copy = compact
    ? props.project?.name || "当前工作区"
    : props.project?.path || connectionText(props.connection);
  const pills = [
    { label: state.label, state: state.className },
    { label: props.runningCount ? `${props.runningCount} 个运行中` : "空闲", state: props.runningCount ? "running" : "done" },
    { label: props.threads.length ? `${props.threads.length} 个任务` : "暂无任务", state: props.threads.length ? "done" : "muted" },
    { label: updated ? formatRelativeTime(updated) : "未开始", state: "muted" as Status["className"] },
  ];
  return (
    <section className={clsx("session-card", compact && "compact")} aria-label="工作台状态">
      <div className="session-card-head">
        <span className={clsx("session-state-dot", compact ? selectedStatus?.className || state.className : state.className)} />
        <div>
          <h2>{title}</h2>
          <p>{copy}</p>
        </div>
      </div>
      <div className="inbox-strip" aria-label="工作台摘要">
        {pills.map((pill) => (
          <span className={clsx("inbox-pill", pill.state)} key={pill.label}>{pill.label}</span>
        ))}
      </div>
      <div className="session-card-actions">
        <button className="session-card-action primary" type="button" onClick={() => selected ? void props.selectThread(selected.thread_id) : props.startNewThread()}>
          {selected ? "继续最近任务" : "新建任务"}
        </button>
        <button className="session-card-action" type="button" onClick={props.openSearch}>搜索</button>
      </div>
    </section>
  );
}

function SessionStepList({ steps }: { steps: SessionStep[] }) {
  return (
    <div className="session-step-list">
      {steps.map((step, index) => (
        <div className={clsx("session-step", step.state)} key={`${step.label}-${index}`}>
          <span className="session-step-index">{index + 1}.</span>
          <span className="session-step-label">{step.label}</span>
          <span className="session-step-value">{step.value}</span>
        </div>
      ))}
    </div>
  );
}

function ThreadFilterBar({ filter, counts, setFilter, compact = false }: { filter: ThreadFilter; counts: Record<ThreadFilter, number>; setFilter: (filter: ThreadFilter) => void; compact?: boolean }) {
  return (
    <div className={clsx("thread-filter-strip", compact && "compact")} aria-label="任务筛选">
      {THREAD_FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          className={clsx(filter === option.value && "active")}
          type="button"
          onClick={() => setFilter(option.value)}
        >
          <span>{option.label}</span>
          <small>{counts[option.value]}</small>
        </button>
      ))}
    </div>
  );
}

function focusThreadForInbox(props: ShellProps) {
  const liveRunning = props.threads.find((thread) => statusForThread(thread, new Map(), props.liveEvents).className === "running");
  return liveRunning || props.threads.find((thread) => thread.thread_id === props.selectedThreadId) || props.threads[0] || null;
}

function workspaceOverviewText(props: ShellProps) {
  const workspaceCount = props.project || props.config ? 1 : 0;
  const taskText = props.threads.length ? `${props.threads.length} 个任务` : "暂无任务";
  return `${workspaceCount || 1} 个工作区 · ${taskText}`;
}

function workspaceModeLabel(config: RemoteConfig | null) {
  if (!config) return "同步中";
  if (config.auth_mode === "none") return "本地";
  if (config.auth_mode === "auth-code") return "受保护";
  return "远程";
}

function remoteSurfaceState(props: ShellProps): Status & { title: string; note: string } {
  const hasWorkspace = Boolean(props.project || props.config || props.threads.length);
  if (hasWorkspace) {
    return {
      label: "已连接",
      title: "已连接到当前桌面窗口",
      note: "本次连接可以查看当前设备上已打开的项目、任务和会话；二维码失效后需要回到桌面端重新连接。",
      className: "done",
    };
  }
  if (props.connection === "error") {
    return {
      label: "恢复中",
      title: "正在恢复桌面连接",
      note: "连接暂不可用，页面会保留本地缓存的任务入口，并在服务恢复后自动同步。",
      className: "running",
    };
  }
  return {
    label: "连接中",
    title: "正在同步当前桌面窗口",
    note: "正在同步远程服务端的工作区和任务，完成后会自动展开入口。",
    className: "running",
  };
}

function ThreadEmptyState({ search, start, hasThreads = false, compact = false }: { search: () => void; start: () => void; hasThreads?: boolean; compact?: boolean }) {
  return (
    <div className={clsx("thread-empty-card", compact && "compact")}>
      <strong>{hasThreads ? "没有匹配任务" : "还没有任务"}</strong>
      <span>{hasThreads ? "换一个筛选或搜索词，任务会留在同一个收件箱里。" : "从这里开始新的远程会话，历史任务会自动出现在收件箱。"}</span>
      <div>
        <button type="button" onClick={start}>新建</button>
        <button type="button" onClick={search}>搜索</button>
      </div>
    </div>
  );
}

function DesktopThreadButton({ thread, selected, events, liveEvents, onClick }: { thread: Thread; selected: boolean; events: TimelineEvent[]; liveEvents: TimelineEvent[]; onClick: () => void }) {
  const status = statusForThread(thread, new Map([[thread.thread_id, events]]), liveEvents);
  return (
    <button type="button" className={clsx("thread-card", selected && "active")} onClick={onClick}>
      <span className={clsx("thread-status-dot", status.className)}></span>
      <span className="thread-card-main">
        <h3>{thread.title || "New thread"}</h3>
        <small>{threadCardMeta(thread, events, status)}</small>
      </span>
      <p>{formatRelativeTime(thread.updated_at) || status.label}</p>
    </button>
  );
}

function MobileThreadButton({ thread, selected, liveEvents, onClick }: { thread: Thread; selected: boolean; liveEvents: TimelineEvent[]; onClick: () => void }) {
  const status = statusForThread(thread, new Map(), liveEvents);
  return (
    <button type="button" className={clsx("mobile-thread-card", selected && "active")} onClick={onClick}>
      <span className={clsx("thread-status-dot", status.className)}></span>
      <span className="thread-card-main">
        <h3>{thread.title || "New thread"}</h3>
        <p>{threadCardMeta(thread, [], status)}</p>
      </span>
      <span className="mobile-thread-tail">
        <span className={clsx("status-badge", status.className)}>{status.label}</span>
        <small>{formatRelativeTime(thread.updated_at)}</small>
      </span>
    </button>
  );
}

function IconButton({ title, onClick, className, children }: { title: string; onClick?: () => void; className?: string; children: React.ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button type="button" className={clsx("icon-btn subtle", className)} aria-label={title} onClick={onClick}>
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip-content" sideOffset={7}>
          {title}
          <Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function CommandButton({ icon, label, meta, onClick }: { icon: React.ReactNode; label: string; meta?: string; onClick: () => void }) {
  return (
    <button className="command-row" type="button" onClick={onClick}>
      <span className="cmd-icon">{icon}</span>
      <span>{label}</span>
      {meta && <kbd>{meta}</kbd>}
    </button>
  );
}

function CapabilityMenu({ capabilities, openStatus }: { capabilities: RemoteCapabilities | null; openStatus: () => void }) {
  const rows = capabilities?.tui_features?.map(capabilityRow) || [];
  const available = rows.filter((row) => row.stateClass !== "muted").length;
  const label = rows.length ? `${available}/${rows.length}` : "同步中";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="command-row capability-menu-trigger" type="button">
          <span className="cmd-icon"><Sparkles size={15} /></span>
          <span>能力</span>
          <kbd>{label}</kbd>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="dropdown-panel capability-menu-panel" sideOffset={8} align="start">
          <DropdownMenu.Label className="dropdown-label">当前工作台能力</DropdownMenu.Label>
          {rows.length ? rows.slice(0, 8).map((row) => (
            <DropdownMenu.Item className="dropdown-item capability-menu-item" key={row.key} onSelect={openStatus}>
              <span className={clsx("capability-menu-icon", row.stateClass)}>{capabilityIcon(row.key)}</span>
              <span className="capability-menu-main">
                <strong>{row.label}</strong>
                <small>{row.detail}</small>
              </span>
              <em>{row.status}</em>
            </DropdownMenu.Item>
          )) : (
            <DropdownMenu.Item className="dropdown-item capability-menu-item muted" onSelect={openStatus}>
              <span className="capability-menu-icon muted"><Sparkles size={13} /></span>
              <span className="capability-menu-main">
                <strong>能力同步中</strong>
                <small>打开状态页查看远程服务状态</small>
              </span>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className="dropdown-separator" />
          <DropdownMenu.Item className="dropdown-item compact" onSelect={openStatus}>查看状态详情</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

type ChangeSummary = {
  files: string[];
  filesCount: number;
  additions: number;
  deletions: number;
};

type ActivityDigest = {
  total: number;
  messages: number;
  executions: number;
  materials: number;
  contexts: number;
  changes: ChangeSummary | null;
};

type ActivityEntry = {
  key: string;
  category: EventFilter | "change";
  title: string;
  body: string;
  meta: string;
};

type MaterialEntry = {
  key: string;
  kind: "image" | "file";
  name: string;
  token: string;
  state: "待发送" | "已提交";
  context: string;
  hint: string;
  pending: boolean;
};

async function api<T = Json>(path: string, options: { method?: string; body?: unknown; form?: FormData; auth?: boolean } = {}): Promise<T> {
  const init: RequestInit = { method: options.method || "GET", credentials: "same-origin", headers: {} };
  if (options.form) {
    init.body = options.form;
  } else if (options.body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok || data.ok === false) throw new Error(data.error || data.reason || response.statusText);
  return data as T;
}

function useLocalString(key: string, fallback: string) {
  const [value, setValue] = useState(() => localStorage.getItem(key) || fallback);
  const save = (next: string) => {
    setValue(next);
    localStorage.setItem(key, next);
  };
  return [value, save] as const;
}

function useLocalNumber(key: string, fallback: number) {
  const [value, setValue] = useState(() => Number(localStorage.getItem(key) || String(fallback)));
  const save = (next: number) => {
    setValue(next);
    localStorage.setItem(key, String(next));
  };
  return [value, save] as const;
}

function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const listener = () => setMatches(media.matches);
    listener();
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);
  return matches;
}

function mergeEventsMap(previous: Map<string, TimelineEvent[]>, threadId: string, events: TimelineEvent[]) {
  if (!events.length) return previous;
  const next = new Map(previous);
  const byId = new Map((next.get(threadId) || []).map((event) => [event._event_id, event]));
  for (const event of events) byId.set(event._event_id, event);
  next.set(threadId, [...byId.values()].sort((a, b) => Number(a._event_id || 0) - Number(b._event_id || 0)));
  return next;
}

function isLiveTimelineEvent(event: TimelineEvent) {
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

function normalizeThreadFilter(value: string): ThreadFilter {
  return THREAD_FILTER_OPTIONS.some((option) => option.value === value) ? value as ThreadFilter : "all";
}

function countThreadsByFilter(threads: Thread[], eventsByThread: Map<string, TimelineEvent[]>, liveEvents: TimelineEvent[]): Record<ThreadFilter, number> {
  const counts: Record<ThreadFilter, number> = { all: threads.length, running: 0, done: 0, attention: 0 };
  for (const thread of threads) {
    const status = statusForThread(thread, eventsByThread, liveEvents);
    if (threadMatchesFilter(thread, status, "running")) counts.running += 1;
    if (threadMatchesFilter(thread, status, "done")) counts.done += 1;
    if (threadMatchesFilter(thread, status, "attention")) counts.attention += 1;
  }
  return counts;
}

function filterThreads(threads: Thread[], query: string, filter: ThreadFilter, eventsByThread: Map<string, TimelineEvent[]>, liveEvents: TimelineEvent[]) {
  const value = query.toLowerCase();
  return threads.filter((thread) => {
    const haystack = `${thread.title || ""} ${thread.last_text || ""} ${thread.thread_id || ""}`.toLowerCase();
    const status = statusForThread(thread, eventsByThread, liveEvents);
    return (!value || haystack.includes(value)) && threadMatchesFilter(thread, status, filter);
  });
}

function threadMatchesFilter(_thread: Thread, status: Status, filter: ThreadFilter) {
  if (filter === "all") return true;
  if (filter === "running") return status.className === "running";
  if (filter === "done") return status.className === "done";
  if (filter === "attention") return status.className === "error" || status.label === "已停止";
  return true;
}

function compareThreads(a: Thread, b: Thread) {
  return dateValue(b.updated_at) - dateValue(a.updated_at);
}

function projectUpdatedAt(threads: Thread[]) {
  const latest = threads.reduce((max, thread) => Math.max(max, dateValue(thread.updated_at)), 0);
  return latest ? new Date(latest).toISOString() : "";
}

function statusForThread(thread: Thread | null, eventsByThread: Map<string, TimelineEvent[]>, liveEvents: TimelineEvent[]): Status {
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

function threadCardMeta(thread: Thread, events: TimelineEvent[], status: Status) {
  const parts = [];
  if (thread.active_model) parts.push(thread.active_model);
  if (thread.active_level) parts.push(levelLabel(thread.active_level));
  if (thread.turn_count) parts.push(`${thread.turn_count} 轮`);
  const changes = summarizeThreadChanges(events);
  if (changes) parts.push(`${changes.filesCount || changes.files.length} 文件`);
  if (!parts.length && thread.last_text) parts.push(thread.last_text);
  if (!parts.length) parts.push(status.label);
  return parts.join(" · ");
}

function activityDigest(events: TimelineEvent[]): ActivityDigest {
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
    changes: summarizeThreadChanges(events),
  };
}

function activityDigestTitle(digest: ActivityDigest) {
  if (!digest.total) return "等待任务活动";
  if (digest.changes) return "已有文件更改";
  if (digest.executions) return "执行步骤已同步";
  if (digest.messages > 1) return "对话已更新";
  return "任务已有记录";
}

function activityDigestBody(digest: ActivityDigest) {
  if (!digest.total) return "提交消息后，这里会按时间整理消息、执行、素材和上下文活动。";
  const parts = [`${digest.total} 条活动`];
  if (digest.messages) parts.push(`${digest.messages} 条对话`);
  if (digest.executions) parts.push(`${digest.executions} 次执行`);
  if (digest.materials) parts.push(`${digest.materials} 个素材`);
  if (digest.contexts) parts.push(`${digest.contexts} 条运行更新`);
  if (digest.changes) parts.push(changeSummaryText(digest.changes));
  return parts.join(" · ");
}

function materialSummaryText(pending: number, committed: number, images: number, files: number) {
  const parts = [];
  if (pending) parts.push(`${pending} 个待发送`);
  if (committed) parts.push(`${committed} 个已提交`);
  if (images) parts.push(`${images} 张图片`);
  if (files) parts.push(`${files} 个文件`);
  return parts.length ? `${parts.join(" · ")}。` : "素材会在发送时上传；输入框 token 是唯一绑定入口。";
}

function activityEntryForEvent(event: TimelineEvent, index: number): ActivityEntry {
  const category = eventCategory(event);
  const change = changeSummaryForEvent(event);
  const key = String(event._event_id ?? `${event.type || "event"}-${event.created_at || event.timestamp || index}`);
  if (change) {
    const files = change.files.slice(0, 2).join("、");
    const fileText = files ? `${files}${change.files.length > 2 ? " 等" : ""}` : "文件";
    return {
      key,
      category: "change",
      title: "文件更改",
      body: `${fileText} · ${changeSummaryText(change)}`,
      meta: eventTimeLabel(event),
    };
  }
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

function materialEntries(events: TimelineEvent[], attachments: AttachmentDraft[]): MaterialEntry[] {
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

function attachmentEvents(events: TimelineEvent[]): Array<{ kind: "image" | "file"; token: string; filename: string }> {
  return events
    .filter((event) => event.type === "item.image_attachment" || event.type === "item.file_attachment")
    .map((event) => ({
      kind: event.type === "item.image_attachment" ? "image" : "file",
      token: event.attachment?.token || event.attachment?.canonical_token || "",
      filename: event.attachment?.filename || "",
    }));
}

function summarizeThreadChanges(events: TimelineEvent[]) {
  const files = new Set<string>();
  const seen = new Set<string>();
  let additions = 0;
  let deletions = 0;
  for (const event of events) {
    const summary = changeSummaryForEvent(event);
    if (!summary) continue;
    const signature = `${[...summary.files].sort().join("|")}::${summary.additions}::${summary.deletions}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    additions += summary.additions;
    deletions += summary.deletions;
    for (const file of summary.files) files.add(file);
  }
  if (!files.size && additions === 0 && deletions === 0) return null;
  return { files: [...files], filesCount: files.size, additions, deletions };
}

function changeSummaryText(summary: ChangeSummary) {
  const fileText = summary.filesCount || summary.files.length ? `${summary.filesCount || summary.files.length} 个文件` : "文件已更新";
  const statText = summary.additions || summary.deletions ? `+${summary.additions} -${summary.deletions}` : "内容已更新";
  return `${fileText} · ${statText}`;
}

function changeSummaryForEvent(event: TimelineEvent): ChangeSummary | null {
  const rawFiles = Array.isArray(event.files) ? event.files : Array.isArray(event.changed_files) ? event.changed_files : [];
  const files = rawFiles.map((item) => (typeof item === "string" ? item : String((item as Json)?.path || (item as Json)?.file || (item as Json)?.name || ""))).filter(Boolean);
  let additions = numberValue(event.additions ?? event.added ?? event.insertions);
  let deletions = numberValue(event.deletions ?? event.deleted ?? event.removals);
  const text = toolOutputText(event);
  const stat = text.match(/\+(\d+)\s+-\s*(\d+)/);
  if (stat) {
    additions ||= Number(stat[1]);
    deletions ||= Number(stat[2]);
  }
  const likelyChangeEvent = /(?:diff|patch|change|changed|apply_patch|file)/i.test(String(event.type || "")) || /(?:changed|modified|files? changed|已更改|修改)/i.test(text);
  const hasChangeSignal = likelyChangeEvent || rawFiles.length > 0 || additions > 0 || deletions > 0 || Boolean(stat);
  if (!hasChangeSignal) return null;
  for (const file of extractChangedFiles(text)) {
    if (!files.includes(file)) files.push(file);
  }
  if (!files.length && additions === 0 && deletions === 0) return null;
  return { files, filesCount: files.length, additions, deletions };
}

function extractChangedFiles(text: string) {
  const matches = new Set<string>();
  const pattern = /(?:^|[\s"'`])([A-Za-z0-9_.\\/-]+\.(?:py|js|ts|tsx|jsx|css|html|md|json|toml|yaml|yml|lock|txt|rs|go|java|kt|swift|c|h|cpp|hpp|sql|sh|ps1))(?:\b|$)/gm;
  for (const match of text.matchAll(pattern)) matches.add(match[1].replaceAll("\\", "/"));
  return [...matches];
}

function numberValue(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function eventCategory(event: TimelineEvent): EventFilter {
  if (event.type === "item.image_attachment" || event.type === "item.file_attachment") return "attachment";
  if (isUserDisplayEvent(event) || isAssistantFinalEvent(event)) return "message";
  if (event.type?.startsWith("tool.") || event.type === "item.tool_output") return "tool";
  return "system";
}

function isProductEvent(event: TimelineEvent) {
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

function eventSummary(event: TimelineEvent) {
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

function eventLabel(event: TimelineEvent) {
  if (isUserDisplayEvent(event)) return "用户消息";
  if (isAssistantFinalEvent(event)) return "回复已更新";
  if (isReasoningEvent(event)) return "思考过程";
  if (event.type === "tool.started") return "工具准备";
  if (event.type === "tool.output" || event.type === "item.tool_output" || event.type === "tool.partial") return changeSummaryForEvent(event) ? "文件变更" : "执行结果";
  if (event.type === "item.image_attachment" || event.type === "item.file_attachment") return "素材";
  if (event.type?.startsWith("compaction.") || event.type === "item.compaction") return "上下文";
  if (event.type === "turn.error") return "运行失败";
  if (event.type?.startsWith("turn.")) return "运行状态";
  if (event.type === "model.stream_retry") return "模型连接";
  if (event.type?.startsWith("thread.")) return "线程更新";
  return "活动";
}

function eventTimeLabel(event: TimelineEvent) {
  const time = formatRelativeTime(event.created_at || event.timestamp || "");
  return time;
}

function displayEventTime(event: TimelineEvent) {
  return dateValue(event.created_at || event.timestamp || "");
}

function compactText(value: string, max = 160) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function itemText(item: unknown) {
  const value = item as Json | undefined;
  if (typeof value?.text === "string") return value.text;
  if (typeof value?.content === "string") return value.content;
  const content = Array.isArray(value?.content) ? value.content as Json[] : [];
  return content.filter((part) => ["input_text", "output_text", "text", "refusal"].includes(String(part.type || ""))).map((part) => String(part.text || "")).join("\n");
}

function firstTextValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function userTextForEvent(event: TimelineEvent) {
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

function assistantTextForEvent(event: TimelineEvent) {
  if (event.type === "item.model_response") {
    const output = (event.output || []) as Json[];
    const text = modelOutputText(output) || String(event.text || event.message || "");
    return [text, modelToolSummary(output)].filter(Boolean).join("\n\n");
  }
  const output = Array.isArray(event.output) ? modelOutputText(event.output as Json[]) : "";
  const item = event.item as Json | undefined;
  return String(event.text || event.message || event.delta || output || itemText(item) || "");
}

function assistantDeltaText(event: TimelineEvent) {
  if (!isAssistantDeltaEvent(event)) return "";
  return String(event.delta || event.text || event.message || "");
}

function modelOutputText(output: Json[]) {
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

function modelToolSummary(output: Json[]) {
  const calls = output.filter((item) => item.type === "function_call");
  return calls.map((call) => `工具调用 · ${String(call.name || call.call_id || "run")}`).join("\n");
}

function toolOutputText(event: TimelineEvent) {
  const item = event.item || {};
  const raw = event.output ?? item.output ?? event.text ?? "";
  if (typeof raw === "string") return raw.slice(0, 4000);
  try {
    return JSON.stringify(raw, null, 2).slice(0, 4000);
  } catch {
    return String(raw).slice(0, 4000);
  }
}

function uniqueFileToken(filename: string, text: string, attachments: AttachmentDraft[]) {
  const base = `[File ${filename}]`;
  const existing = new Set(attachments.map((attachment) => attachment.token));
  if (!existing.has(base) && countUnquotedToken(text, base) === 0) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `[File ${filename} #${index}]`;
    if (!existing.has(candidate) && countUnquotedToken(text, candidate) === 0) return candidate;
  }
  return `[File ${filename} #${crypto.randomUUID().slice(0, 8)}]`;
}

function countUnquotedToken(text: string, token: string) {
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

function isImmediatelyQuoted(text: string, start: number, end: number) {
  const pairs = new Set(['""', "''", "“”", "‘’"]);
  if (start <= 0 || end >= text.length) return false;
  return pairs.has(`${text[start - 1]}${text[end]}`);
}

function removeFirstToken(text: string, token: string) {
  const index = text.indexOf(token);
  if (index < 0) return text;
  return `${text.slice(0, index)}${text.slice(index + token.length)}`.replace(/[ \t]{2,}/g, " ").trimStart();
}

function needsSpaceBefore(value: string) {
  return value.length > 0 && !/\s$/.test(value);
}

function dragCarriesFiles(event: React.DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types || []).includes("Files");
}

function positiveNumber(value?: number) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function connectionText(connection: string) {
  if (connection === "open") return "工作台已连接";
  if (connection === "error") return "正在恢复连接";
  return "正在打开工作台";
}

function connectionState(connection: string): Status & { hint: string } {
  if (connection === "open") return { label: "在线", hint: "变更会自动同步", className: "done" };
  if (connection === "error") return { label: "恢复中", hint: "页面会自动接回", className: "running" };
  return { label: "连接中", hint: "正在打开远程工作台", className: "running" };
}

function levelLabel(value?: string) {
  return value ? LEVEL_LABELS[value] || value : "默认";
}

function modelLevelOptions(capabilities: RemoteCapabilities | null, currentValue = "") {
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

function mentionGroups(capabilities: RemoteCapabilities | null): Array<{ key: string; label: string; icon: React.ReactNode; items: PickerItemSummary[] }> {
  const pickers = capabilities?.core?.pickers || {};
  const mcpItems = mentionItems(pickers.mcp);
  const skillItems = mentionItems(pickers.skills);
  return [
    { key: "mcp", label: "MCP", icon: <Workflow size={14} />, items: mcpItems },
    { key: "skills", label: "Skills", icon: <Sparkles size={14} />, items: skillItems },
  ].filter((group) => group.items.length || group.key === "mcp" || group.key === "skills");
}

function mentionItems(picker?: PickerSummary) {
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

function appendComposerToken(text: string, token: string) {
  const cleanToken = token.trim();
  if (!cleanToken) return text;
  const prefix = needsSpaceBefore(text) ? `${text} ` : text;
  return `${prefix}${cleanToken} `;
}

function toolIndexSummary(pickers: Record<string, PickerSummary> = {}) {
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

function pickerItemTitle(item: PickerItemSummary) {
  const value = String(item.value || item.id || "").replace(/^@/, "");
  if (!value) return item.kind || "条目";
  const parts = value.split(/[/:]+/).filter(Boolean);
  return parts.at(-1) || value;
}

function conflictLabel(value?: string) {
  return value ? CONFLICT_LABELS[value] || value : CONFLICT_LABELS.queue;
}

function capabilityRow(feature: CapabilityFeature, index: number) {
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

function capabilityLabel(id: string) {
  const labels: Record<string, string> = {
    threads: "线程",
    transcript: "转录",
    composer: "输入框",
    attachments: "附件",
    status: "状态",
    interrupt: "停止",
    config: "配置",
    models: "模型",
    mcp: "MCP",
    skills: "技能",
  };
  return labels[id] || "能力";
}

function capabilityStatus(status?: string): { label: string; className: Status["className"] } {
  if (status === "available") return { label: "可用", className: "done" };
  if (status === "partial") return { label: "部分可用", className: "running" };
  if (status === "unavailable") return { label: "不可用", className: "muted" };
  if (status === "needs_core_api") return { label: "待接入", className: "muted" };
  return { label: "规划中", className: "muted" };
}

function capabilityDetail(id: string, detail = "") {
  if (["models", "mcp", "skills"].includes(id) && detail) {
    return sanitizeCapabilityDetail(detail);
  }
  const details: Record<string, string> = {
    threads: "任务入口、历史记录和标题管理",
    transcript: "消息、工具结果、素材和文件变更",
    composer: "多行输入、档位和提交策略",
    attachments: "图片上下文和文件素材",
    status: "连接状态、会话保护和远程入口",
    interrupt: "运行中任务可停止",
    config: "显示远程控制配置",
    models: "模型和档位摘要",
    mcp: "MCP 插入源",
    skills: "技能索引",
  };
  return details[id] || sanitizeCapabilityDetail(detail) || "按服务能力显示";
}

function sanitizeCapabilityDetail(detail: string) {
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

function capabilitySummary(features: CapabilityFeature[]) {
  const available = features.filter((feature) => feature.status === "available").length;
  const partial = features.filter((feature) => feature.status === "partial").length;
  const waiting = features.filter((feature) => feature.status === "needs_core_api").length;
  const unavailable = features.length - available - partial - waiting;
  const parts = [
    available ? `${available} 项可用` : "",
    partial ? `${partial} 项部分可用` : "",
    waiting ? `${waiting} 项待接入` : "",
    unavailable > 0 ? `${unavailable} 项待补齐` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "按服务能力显示";
}

function uploadLimitText(limits: RemoteCapabilities["limits"] = {}) {
  const parts = [
    limits.max_attachments ? `${limits.max_attachments} 个附件` : "",
    limits.max_message_bytes ? `${formatBytes(limits.max_message_bytes)} 消息` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "按服务配置";
}

function dateValue(value?: string) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatRelativeTime(value?: string) {
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

function formatBytes(value?: number) {
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "");
}

function autoSize(input: HTMLTextAreaElement | null) {
  if (!input) return;
  input.style.height = "auto";
  input.style.height = `${Math.min(168, input.scrollHeight)}px`;
}

function openCache(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (!("indexedDB" in window)) {
      resolve(null);
      return;
    }
    const request = indexedDB.open(CACHE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      const events = database.createObjectStore("events", { keyPath: "key" });
      events.createIndex("thread", "thread_id", { unique: false });
      events.createIndex("stored", "stored_at", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function cachePutEvents(db: IDBDatabase, threadId: string, events: TimelineEvent[]) {
  if (!events.length) return;
  const tx = db.transaction("events", "readwrite");
  const store = tx.objectStore("events");
  const now = Date.now();
  for (const event of events) {
    if (!event._event_id) continue;
    const payload = JSON.stringify(event);
    store.put({ key: `${threadId}:${event._event_id}`, thread_id: threadId, event_id: event._event_id, stored_at: now, bytes: payload.length, event });
  }
  await txDone(tx);
  pruneCache(db).catch(() => undefined);
}

async function cacheGetEvents(db: IDBDatabase, threadId: string) {
  const tx = db.transaction("events", "readonly");
  const index = tx.objectStore("events").index("thread");
  const rows = await getAll(index, IDBKeyRange.only(threadId));
  return rows.map((row) => row.event as TimelineEvent).sort((a, b) => Number(a._event_id || 0) - Number(b._event_id || 0));
}

async function pruneCache(db: IDBDatabase) {
  const tx = db.transaction("events", "readwrite");
  const store = tx.objectStore("events");
  const rows = await getAll(store);
  rows.sort((a, b) => Number(a.stored_at || 0) - Number(b.stored_at || 0));
  let bytes = rows.reduce((sum, row) => sum + Number(row.bytes || 0), 0);
  while ((rows.length > 2500 || bytes > 8 * 1024 * 1024) && rows.length) {
    const row = rows.shift();
    if (!row) break;
    bytes -= Number(row.bytes || 0);
    store.delete(row.key as IDBValidKey);
  }
  await txDone(tx);
}

function getAll(source: IDBObjectStore | IDBIndex, query?: IDBValidKey | IDBKeyRange): Promise<Json[]> {
  return new Promise((resolve, reject) => {
    const request = source.getAll(query);
    request.onsuccess = () => resolve(request.result as Json[]);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
