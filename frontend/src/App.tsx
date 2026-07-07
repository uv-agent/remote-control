import React, { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Select from "@radix-ui/react-select";
import * as Tooltip from "@radix-ui/react-tooltip";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FilePlus2,
  Folder,
  Info,
  Image as ImageIcon,
  Moon,
  PanelLeftClose,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  SunMoon,
  Workflow,
  X,
} from "lucide-react";
import "./styles.css";
import { api } from "./api";
import { cacheGetEvents, cachePutEvents, openCache } from "./cache";
import { CONFLICT_OPTIONS, SELECT_DEFAULT_VALUE, SUPPORTED_IMAGE_TYPES, THREAD_FILTER_OPTIONS } from "./constants";
import { useLocalNumber, useLocalString, useMedia } from "./hooks";
import { InfoPane } from "./components/InfoPane";
import type {
  AttachmentDraft,
  CommandItemSummary,
  DisplayItem,
  DisplayMessage,
  EventFilter,
  InfoTab,
  Json,
  ProjectInfo,
  RemoteCapabilities,
  RemoteConfig,
  Status,
  ThemeName,
  Thread,
  ThreadFilter,
  TimelineEvent,
  TurnGroupModel,
} from "./types";
import {
  appendComposerToken,
  assistantDeltaText,
  assistantTextForEvent,
  autoSize,
  attachmentEvents,
  compareThreads,
  compactText,
  conflictLabel,
  connectionState,
  connectionText,
  countThreadsByFilter,
  countUnquotedToken,
  displayEventKey,
  displayEventTime,
  displayItemForEvent,
  errorMessage,
  eventTimeLabel,
  eventTurnKey,
  filterThreads,
  formatBytes,
  formatRelativeTime,
  groupDisplayItems,
  isAssistantDeltaEvent,
  isAssistantFinalEvent,
  isLiveTimelineEvent,
  isProcessDisplayItem,
  isProductEvent,
  isUserDisplayEvent,
  levelLabel,
  mergeEventsMap,
  modelLevelDisplayLabel,
  modelLevelOptions,
  normalizeThreadFilter,
  needsSpaceBefore,
  positiveNumber,
  previewText,
  processDigestSummary,
  processWorkLabel,
  projectUpdatedAt,
  reasoningTextForEvent,
  removeFirstToken,
  shouldFoldText,
  statusForThread,
  stripMarkdownMarkers,
  taskProgressText,
  textPreview,
  threadCardMeta,
  threadRunDetail,
  threadRunTitle,
  toolOutputText,
  uniqueFileToken,
  userTextForEvent,
  composerFocusDetail,
  composerHint,
  composerPlaceholder,
  composerStateLabel,
  composerTitle,
  commandInsertText,
  foldLabel,
} from "./view-model";

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
  const [infoTab, setInfoTab] = useState<InfoTab>("details");
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
  const selectedLiveEvents = selectedThreadId ? liveEvents.filter((event) => event.thread_id === selectedThreadId) : [];
  const pluginCommands = capabilities?.core?.commands?.commands || [];
  const filteredThreads = useMemo(() => filterThreads(threads, searchQuery, normalizedThreadFilter, eventsByThread, liveEvents), [threads, searchQuery, normalizedThreadFilter, eventsByThread, liveEvents]);
  const threadFilterCounts = useMemo(() => countThreadsByFilter(threads, eventsByThread, liveEvents), [threads, eventsByThread, liveEvents]);
  const runningCount = threads.filter((thread) => statusForThread(thread, eventsByThread, liveEvents).className === "running").length;
  const currentStatus = statusForThread(currentThread, eventsByThread, liveEvents);

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
    const turnId = eventTurnKey(event, "");
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
    if (["turn.completed", "turn.interrupted", "turn.error", "model.response", "item.model_response", "item.assistant", "assistant.message.completed", "assistant.completed", "response.output_text.done"].includes(String(event.type || ""))) {
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
        composerText={composerText}
        attachmentCount={attachments.length}
        commands={pluginCommands}
        startNewThread={startNewThread}
        selectThread={(threadId) => void selectThread(threadId)}
        openInfoTab={openInfoTab}
        setComposerText={setComposerText}
        focusComposer={focusComposer}
        clearComposer={clearComposer}
        startEditingTitle={startEditingCurrentTitle}
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
              backToList={() => setView("list")}
              openSearch={() => setSearchOpen(true)}
              openInfo={() => toggleInfoPane()}
              openInfoTab={openInfoTab}
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
            liveEvents={selectedLiveEvents}
            attachments={attachments}
            infoTab={infoTab}
            setInfoTab={openInfoTab}
            eventFilter={eventFilter}
            setEventFilter={setEventFilter}
            close={closeInfoPane}
            db={db}
            lastSeq={lastSeq}
            connection={connection}
            runningCount={runningCount}
            status={currentStatus}
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
          <IconButton title="详情" onClick={() => props.openInfoTab("details")}>
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
        <CommandButton icon={<Plus size={15} />} label="新建任务" onClick={props.startNewThread} />
        <CommandButton icon={<Search size={15} />} label="命令" onClick={props.openSearch} />
        <CommandButton icon={<Settings size={15} />} label="详情" onClick={() => props.openInfoTab("details")} />
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
        <IconButton title="详情" onClick={() => props.openInfoTab("details")}><Settings /></IconButton>
      </footer>
    </section>
  );
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

function ThreadPane(props: {
  thread: Thread | null;
  project: ProjectInfo | null;
  events: TimelineEvent[];
  liveEvents: TimelineEvent[];
  liveDrafts: Map<string, string>;
  liveReasoningDrafts: Map<string, string>;
  status: Status;
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
  backToList: () => void;
  openSearch: () => void;
  openInfo: () => void;
  openInfoTab: (tab: InfoTab) => void;
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
  const draftReady = Boolean(props.composerText.trim() || props.attachments.length);
  const metaItems = threadMetaItems(props.project, props.thread, level);
  const showRunStrip = props.status.className === "running" || props.status.className === "error";
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
          <div className="thread-meta-trail" aria-label="任务信息">
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
        </div>
      </header>
      {showRunStrip && (
        <>
          <div className="thread-floating-status" aria-hidden="false">
            <ThreadRunStrip thread={props.thread} status={props.status} level={level} openEvents={() => props.openInfoTab("details")} />
          </div>
          <div className="mobile-status-ribbon">
            <ThreadRunStrip thread={props.thread} status={props.status} level={level} openEvents={() => props.openInfoTab("details")} />
          </div>
        </>
      )}
      <section id="timeline" className="timeline">
        {rows.length ? rows : <div className="timeline-empty">{props.thread ? "暂无记录" : "暂无任务"}</div>}
      </section>
      <form className="composer" onSubmit={props.submitComposer}>
        <div
          className={clsx("composer-box", draftReady && "has-draft", dragActive && "dragging")}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dragActive && <div className="composer-drop-hint">松开添加到本轮附件</div>}
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
              <input id="fileInput" ref={props.fileInputRef} type="file" multiple onChange={(event) => {
                props.addSelectedFiles(event.currentTarget.files);
                event.currentTarget.value = "";
              }} />
              <ComposerActionMenu
                capabilities={props.capabilities}
                selectedLevel={props.selectedLevel}
                setSelectedLevel={props.setSelectedLevel}
                addAttachment={() => props.fileInputRef.current?.click()}
                openCommands={props.openSearch}
              />
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

function ComposerActionMenu({
  capabilities,
  selectedLevel,
  setSelectedLevel,
  addAttachment,
  openCommands,
}: {
  capabilities: RemoteCapabilities | null;
  selectedLevel: string;
  setSelectedLevel: (value: string) => void;
  addAttachment: () => void;
  openCommands: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"main" | "models">("main");
  const levelOptions = modelLevelOptions(capabilities, selectedLevel);
  const selected = selectedLevel || SELECT_DEFAULT_VALUE;
  const selectedLabel = modelLevelDisplayLabel(selectedLevel || capabilities?.core?.models?.default_level || "");
  return (
    <DropdownMenu.Root open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next) setPanel("main");
    }}>
      <DropdownMenu.Trigger asChild>
        <button className="tool-btn plus-tool" type="button" title="添加功能" aria-label="添加功能">
          <Plus size={17} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="dropdown-panel composer-action-panel" sideOffset={8} align="start">
          {panel === "main" ? (
            <>
              <DropdownMenu.Item className="dropdown-item composer-action-item" onSelect={addAttachment}>
                <span className="composer-action-icon"><Paperclip size={15} /></span>
                <span className="composer-action-main">
                  <strong>附件</strong>
                  <small>添加图片或文件</small>
                </span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="dropdown-item composer-action-item" onSelect={openCommands}>
                <span className="composer-action-icon"><Search size={15} /></span>
                <span className="composer-action-main">
                  <strong>命令</strong>
                  <small>打开命令面板</small>
                </span>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="dropdown-item composer-action-item"
                onSelect={(event) => {
                  event.preventDefault();
                  setPanel("models");
                }}
              >
              <span className="composer-action-icon"><Sparkles size={15} /></span>
              <span className="composer-action-main">
                <strong>模型/档位</strong>
                <small>{selectedLabel}</small>
              </span>
              <span className="composer-action-arrow" aria-hidden="true">›</span>
              </DropdownMenu.Item>
            </>
          ) : (
            <>
              <DropdownMenu.Item
                className="dropdown-item composer-action-item compact-back"
                onSelect={(event) => {
                  event.preventDefault();
                  setPanel("main");
                }}
              >
                <span className="composer-action-icon"><ChevronLeft size={15} /></span>
                <span className="composer-action-main">
                  <strong>模型/档位</strong>
                  <small>选择本轮使用的档位</small>
                </span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="dropdown-separator" />
              {levelOptions.map((option) => {
                const optionValue = option.value || SELECT_DEFAULT_VALUE;
                const checked = optionValue === selected;
                return (
                  <DropdownMenu.Item
                    className="dropdown-item model-menu-item"
                    key={`level-${optionValue}`}
                    onSelect={() => {
                      setSelectedLevel(option.value);
                      setOpen(false);
                      setPanel("main");
                    }}
                  >
                    <span className="model-menu-check">{checked && <Check size={14} />}</span>
                    <span className="model-menu-main">{option.label}</span>
                  </DropdownMenu.Item>
                );
              })}
            </>
          )}
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
    });
    return true;
  };
  for (const [index, event] of props.events.entries()) {
    if (queueAssistantDelta(event, `stored-${index}`)) continue;
    if (isUserDisplayEvent(event)) flushAssistantBuffers();
    const reasoningText = reasoningTextForEvent(event);
    if (isAssistantFinalEvent(event) && reasoningText.trim()) {
      items.push({ kind: "message", key: `reasoning-${displayEventKey(event, `stored-${index}`)}`, role: "reasoning", label: "工作过程", text: reasoningText, time: eventTimeLabel(event), occurredAt: displayEventTime(event) });
    }
    if (isAssistantFinalEvent(event)) assistantBuffers.delete(eventTurnKey(event, `stored-${index}`));
    const item = displayItemForEvent(event, `stored-${index}`);
    if (item) items.push(item);
  }
  for (const [index, event] of liveEvents.entries()) {
    if (queueAssistantDelta(event, `live-${index}`)) continue;
    if (isUserDisplayEvent(event)) flushAssistantBuffers();
    const reasoningText = reasoningTextForEvent(event);
    if (isAssistantFinalEvent(event) && reasoningText.trim()) {
      items.push({ kind: "message", key: `reasoning-${displayEventKey(event, `live-${index}`)}`, role: "reasoning", label: "工作过程", text: reasoningText, time: eventTimeLabel(event), occurredAt: displayEventTime(event) });
    }
    if (isAssistantFinalEvent(event)) assistantBuffers.delete(eventTurnKey(event, `live-${index}`));
    const item = displayItemForEvent(event, `live-${index}`);
    if (item) items.push(item);
  }
  flushAssistantBuffers();
  const visibleTurnIds = new Set(liveEvents.map((event, index) => eventTurnKey(event, `live-${index}`)).filter(Boolean));
  for (const [turnId, text] of props.liveReasoningDrafts) {
    if (visibleTurnIds.size && !visibleTurnIds.has(turnId)) continue;
    items.push({ kind: "message", key: `reasoning-draft-${turnId}`, role: "reasoning", label: "思考", text });
  }
  for (const [turnId, text] of props.liveDrafts) {
    if (visibleTurnIds.size && !visibleTurnIds.has(turnId)) continue;
    items.push({ kind: "message", key: `assistant-draft-${turnId}`, role: "assistant", label: "回复", text });
  }
  return items;
}function TurnGroup({ group, props }: { group: TurnGroupModel; props: React.ComponentProps<typeof ThreadPane> }) {
  const processItems = group.items.filter(isProcessDisplayItem);
  const contextItems = group.items.filter((item) => item.kind === "message" && item.role === "system");
  const rawResultItems = group.items.filter((item) => !isProcessDisplayItem(item) && !(item.kind === "message" && item.role === "system"));
  const resultItems = rawResultItems;
  return (
    <motion.section
      layout
      className={clsx("turn-card", !group.user && "standalone")}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {group.user && <TurnUser item={group.user} props={props} />}
      {!!(contextItems.length || resultItems.length || processItems.length) && (
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
                <ProcessDigest items={processItems} openEvents={() => props.openInfoTab("details")} />
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
}function ProcessDigest({ items, openEvents }: { items: DisplayItem[]; openEvents: () => void }) {
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
}function ThreadRunStrip({
  thread,
  status,
  level,
  openEvents,
}: {
  thread: Thread | null;
  status: Status;
  level: string;
  openEvents: () => void;
}) {
  const detail = threadRunDetail(thread, status, level);
  const action = "查看详情";
  return (
    <button className={clsx("thread-run-strip", status.className)} type="button" title={action} aria-label={`${threadRunTitle(thread, status)} ${detail}，${action}`} onClick={openEvents}>
      <span className="run-dot" />
      <span className="run-main">
        <strong>{threadRunTitle(thread, status)}</strong>
        <small>{detail}</small>
      </span>
      <span className="run-action" aria-hidden="true">›</span>
    </button>
  );
}

function TurnUser({ item, props }: { item: DisplayMessage; props: React.ComponentProps<typeof ThreadPane> }) {
  const folded = shouldFoldText(item.text, 190, 4);
  const actions = messageActions(item.text, props.copyText);
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
  if (item.role === "system") return <AttachmentLine key={item.key} item={item} />;
  return <FoldBlock key={item.key} item={item} props={props} />;
}

function FoldBlock({ item, props }: { item: DisplayMessage; props: React.ComponentProps<typeof ThreadPane> }) {
  const collapsed = item.role === "tool" || item.role === "reasoning" || shouldFoldText(item.text, item.role === "assistant" ? 1200 : 420, item.role === "assistant" ? 16 : 7);
  const actions = messageActions(item.text, props.copyText);
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
}function messageActions(text: string, copyText: (text: string) => Promise<void>) {
  return [<ActionButton key="copy" title="复制" symbol="⎘" onClick={() => void copyText(text)} icon={<Copy />} />];
}

function ActionButton({ title, symbol, icon, onClick }: { title: string; symbol: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="message-action" title={title} data-symbol={symbol} onClick={onClick}>
      <span className="action-icon">{icon}</span>
      <span className="action-label">{title}</span>
    </button>
  );
}

function CommandPalette({
  open,
  query,
  setQuery,
  close,
  threads,
  currentThread,
  composerText,
  attachmentCount,
  commands,
  startNewThread,
  selectThread,
  openInfoTab,
  setComposerText,
  focusComposer,
  clearComposer,
  startEditingTitle,
}: {
  open: boolean;
  query: string;
  setQuery: (value: string) => void;
  close: () => void;
  threads: Thread[];
  currentThread: Thread | null;
  composerText: string;
  attachmentCount: number;
  commands: CommandItemSummary[];
  startNewThread: () => void;
  selectThread: (threadId: string) => void;
  openInfoTab: (tab: InfoTab) => void;
  setComposerText: (value: string) => void;
  focusComposer: () => void;
  clearComposer: () => void;
  startEditingTitle: () => void;
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
  const insertCommand = (command: CommandItemSummary) => {
    const token = commandInsertText(command);
    if (!token) return;
    run(() => {
      setComposerText(appendComposerToken(composerText, token));
      focusComposer();
    });
  };
  const commandGroups: PaletteGroup[] = [
    {
      title: "建议动作",
      rows: [
        { title: "新建任务", meta: "创建线程", keywords: "new thread 新建", action: () => run(startNewThread) },
        { title: currentThread ? "继续输入" : "打开输入框", meta: currentThread ? currentTitle : "草稿", keywords: "composer input 输入", action: () => run(focusComposer) },
        composerText || attachmentCount ? { title: "清空输入", meta: attachmentCount ? `${attachmentCount} 个素材` : "草稿", keywords: "clear composer 清空", action: () => run(clearComposer) } : null,
      ],
    },
    {
      title: "任务面板",
      rows: [
        currentThread ? { title: "重命名任务", meta: currentTitle, keywords: "rename title 重命名", action: () => run(startEditingTitle) } : null,
        { title: "查看详情", meta: "运行与附件", keywords: "details events activity status attachments 详情 运行 附件", action: () => run(() => openInfoTab("details")) },
      ],
    },
    {
      title: "插件命令",
      rows: commands.map((command) => ({
        title: command.name || "命令",
        meta: command.plugin || command.description || "插入到输入框",
        keywords: `${command.name || ""} ${command.plugin || ""} ${command.description || ""} ${(command.aliases || []).join(" ")}`,
        action: () => insertCommand(command),
      })),
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
      rows: [{ title: "把搜索内容放入输入框", meta: "草稿", keywords: query, action: () => { run(() => { startNewThread(); setComposerText(query); }); } }],
    });
  }
  const firstRow = groups.flatMap((group) => group.rows)[0];
  return (
    <div className="palette-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="palette-panel" role="dialog" aria-modal="true">
        <header className="palette-head">
          <div>
            <h2>命令面板</h2>
            <p>搜索任务，或把插件命令插入输入框</p>
          </div>
          <IconButton title="关闭" onClick={close}><X /></IconButton>
        </header>
        <input
          ref={inputRef}
          className="palette-input"
          type="search"
          placeholder="搜索任务或命令"
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

function dragCarriesFiles(event: React.DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types || []).includes("Files");
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
