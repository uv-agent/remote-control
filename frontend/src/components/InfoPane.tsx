import React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import clsx from "clsx";
import {
  ChevronLeft,
  FilePlus2,
  Image as ImageIcon,
  Paperclip,
  Settings,
  Sparkles,
  TerminalSquare,
  Workflow,
} from "lucide-react";
import type {
  ActivityEntry,
  AttachmentDraft,
  EventFilter,
  InfoTab,
  MaterialEntry,
  ProjectInfo,
  RemoteCapabilities,
  RemoteConfig,
  Status,
  Thread,
  TimelineEvent,
} from "../types";
import {
  activityDigest,
  activityEntryForEvent,
  attachmentEvents,
  availablePickerGroups,
  compactText,
  eventSummary,
  eventTimeLabel,
  formatRelativeTime,
  isProductEvent,
  levelLabel,
  materialEntries,
  materialSummaryText,
  modelLevelById,
  pickerItemTitle,
  pickerTitle,
  previewText,
  taskProgressText,
  toolOutputText,
} from "../view-model";

function PanelIconButton({ title, onClick, className, children }: { title: string; onClick?: () => void; className?: string; children: React.ReactNode }) {
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

export function InfoPane(props: {
  thread: Thread | null;
  project: ProjectInfo | null;
  config: RemoteConfig | null;
  capabilities: RemoteCapabilities | null;
  events: TimelineEvent[];
  liveEvents: TimelineEvent[];
  attachments: AttachmentDraft[];
  infoTab: InfoTab;
  setInfoTab: (tab: InfoTab) => void;
  eventFilter: EventFilter;
  setEventFilter: (filter: EventFilter) => void;
  close: () => void;
  db: IDBDatabase | null;
  lastSeq: number;
  connection: string;
  runningCount: number;
  status: Status;
}) {
  const paneTitle = props.thread?.title || props.project?.name || "远程工作区";
  const paneMeta = props.thread?.updated_at ? `更新于 ${formatRelativeTime(props.thread.updated_at)}` : props.project?.name || "当前任务";
  const combinedEvents = [...props.events, ...props.liveEvents];
  return (
    <aside className="info-pane">
      <header className="info-head">
        <PanelIconButton title="关闭" className="drawer-close" onClick={props.close}><ChevronLeft /></PanelIconButton>
        <div>
          <h2>详情</h2>
          <p title={paneTitle}>{paneTitle} · {paneMeta}</p>
        </div>
        <div className="info-head-tools">
          <span className={clsx("info-head-state", props.status.className)}>{props.status.label}</span>
        </div>
      </header>
      <div className="info-content detail-content">
        <ThreadSummary {...props} events={combinedEvents} />
        <ModelContextSection thread={props.thread} capabilities={props.capabilities} />
        <RunRecordSection events={combinedEvents} status={props.status} />
        <AttachmentsSection events={props.events} attachments={props.attachments} />
        <PluginEntriesSection capabilities={props.capabilities} />
      </div>
    </aside>
  );
}

function ThreadSummary({ project, thread, events, attachments, status }: React.ComponentProps<typeof InfoPane> & { events: TimelineEvent[] }) {
  const productEvents = events.filter(isProductEvent);
  const digest = activityDigest(productEvents);
  const attachmentCount = attachmentEvents(events).length + attachments.length;
  const progressText = taskProgressText(thread, status, productEvents.length);
  const taskText = thread?.last_text
    ? compactText(thread.last_text, 150)
    : status.className === "running"
      ? "任务正在运行，运行记录会继续同步。"
      : "还没有提交内容，可以从底部输入框开始新的任务。";
  const modelText = [thread?.active_level ? levelLabel(thread.active_level) : "", thread?.active_model || ""].filter(Boolean).join(" · ") || "默认档位";
  return (
    <section className="task-brief workbench-brief detail-brief">
      <div className="task-brief-head">
        <span className="task-kicker">当前线程</span>
        <span className={clsx("task-status-chip", status.className)}>{status.label}</span>
      </div>
      <strong className="task-title">{thread?.title || project?.name || "新任务"}</strong>
      <p className="task-body">{taskText}</p>
      <div className="detail-summary-grid">
        <DetailMetric label="运行" value={progressText} tone={status.className} />
        <DetailMetric label="模型" value={modelText} />
        <DetailMetric label="轮次" value={thread?.turn_count ? `${thread.turn_count} 轮` : digest.messages ? `${digest.messages} 条消息` : "待开始"} />
        <DetailMetric label="附件" value={attachmentCount ? `${attachmentCount} 个` : "无"} />
      </div>
    </section>
  );
}

function ModelContextSection({ thread, capabilities }: { thread: Thread | null; capabilities: RemoteCapabilities | null }) {
  const defaultLevel = capabilities?.core?.models?.default_level || "";
  const activeLevelId = thread?.active_level || defaultLevel || "";
  const activeLevel = modelLevelById(capabilities, activeLevelId);
  const rows = [
    activeLevelId ? { label: "档位", value: levelLabel(activeLevelId), detail: activeLevelId === defaultLevel ? "默认档位" : activeLevelId } : null,
    activeLevel?.model || activeLevel?.model_name || thread?.active_model
      ? {
          label: "模型",
          value: [activeLevel?.model_name, activeLevel?.model || thread?.active_model].filter(Boolean).join(" -> "),
          detail: activeLevel?.provider || activeLevel?.api || "当前线程",
        }
      : null,
    activeLevel?.context_window_tokens
      ? {
          label: "上下文窗口",
          value: `${Math.round(activeLevel.context_window_tokens / 1000)}k tokens`,
          detail: "用量和 judge 当前未由插件 API 暴露",
        }
      : null,
  ].filter((row): row is { label: string; value: string; detail: string } => Boolean(row?.value));
  if (!rows.length) return null;
  return (
    <DetailSection title="模型与上下文" icon={<Sparkles />} count={`${rows.length} 项`}>
      <div className="detail-row-list">
        {rows.map((row) => <DetailRow key={row.label} {...row} />)}
      </div>
    </DetailSection>
  );
}

function RunRecordSection({ events, status }: { events: TimelineEvent[]; status: Status }) {
  const entries = runEntries(events);
  if (!entries.length && status.className !== "running" && status.className !== "error") return null;
  return (
    <DetailSection title="运行记录" icon={<TerminalSquare />} count={entries.length ? `${entries.length} 条` : status.label}>
      {entries.length ? (
        <div className="detail-event-list">
          {entries.map((entry) => <RunEntry key={entry.key} entry={entry} />)}
        </div>
      ) : (
        <SideItem title={status.label} body="等待远程服务推送新的运行记录。" />
      )}
    </DetailSection>
  );
}

function AttachmentsSection({ events, attachments }: { events: TimelineEvent[]; attachments: AttachmentDraft[] }) {
  const items = materialEntries(events, attachments);
  if (!items.length) return null;
  const pendingItems = items.filter((item) => item.pending);
  const committedItems = items.filter((item) => !item.pending);
  const imageCount = items.filter((item) => item.kind === "image").length;
  const fileCount = items.length - imageCount;
  return (
    <DetailSection title="附件" icon={<Paperclip />} count={`${items.length} 个`}>
      <div className="material-summary compact">
        <strong>{materialSummaryText(pendingItems.length, committedItems.length, imageCount, fileCount)}</strong>
      </div>
      <div className="material-list">
        {items.map((item) => <MaterialItem key={item.key} item={item} />)}
      </div>
    </DetailSection>
  );
}

function PluginEntriesSection({ capabilities }: { capabilities: RemoteCapabilities | null }) {
  const groups = availablePickerGroups(capabilities?.core?.pickers || {});
  if (!groups.length) return null;
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  return (
    <DetailSection title="插件入口" icon={<Workflow />} count={`${total} 个`}>
      <div className="plugin-entry-list">
        {groups.map((group) => (
          <section className="plugin-entry-group" key={group.key}>
            <header>
              <strong>{pickerTitle(group.picker, group.key)}</strong>
              <small>{group.items.length} 个条目</small>
            </header>
            <div>
              {group.items.slice(0, 8).map((item) => (
                <span className="picker-item" key={item.id || item.value || item.description}>
                  <strong>{pickerItemTitle(item)}</strong>
                  <small>{item.description || item.meta || item.value}</small>
                </span>
              ))}
            </div>
          </section>
        ))}
      </div>
    </DetailSection>
  );
}

function DetailSection({ title, icon, count, children }: { title: string; icon: React.ReactNode; count: string; children: React.ReactNode }) {
  return (
    <details className="detail-section">
      <summary>
        <span className="detail-section-icon">{icon}</span>
        <span className="detail-section-main">
          <strong>{title}</strong>
          <small>{count}</small>
        </span>
        <span className="detail-section-arrow" aria-hidden="true" />
      </summary>
      <div className="detail-section-body">{children}</div>
    </details>
  );
}

function DetailMetric({ label, value, tone = "muted" }: { label: string; value: string; tone?: Status["className"] }) {
  return (
    <span className={clsx("task-metric", tone)}>
      <small>{label}</small>
      <strong>{value || "-"}</strong>
    </span>
  );
}

function DetailRow({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="workbench-row">
      <span className="workbench-row-icon"><Settings /></span>
      <span className="workbench-row-main">
        <small>{label}</small>
        <strong title={value}>{value}</strong>
        <em>{detail}</em>
      </span>
    </div>
  );
}

function RunEntry({ entry }: { entry: ActivityEntry }) {
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

function MaterialItem({ item }: { item: MaterialEntry }) {
  return (
    <div className={clsx("material-item", item.kind, item.pending && "pending")}>
      <span className="material-icon">{item.kind === "image" ? <ImageIcon /> : <FilePlus2 />}</span>
      <span className="material-main">
        <strong>{item.name || item.token || "附件"}</strong>
        <span className="material-context">{item.context}</span>
        <span className="material-token">{item.token || item.hint}</span>
        {item.hint && <small>{item.hint}</small>}
      </span>
      <em>{item.state}</em>
    </div>
  );
}

function SideItem({ title, body, meta = "" }: { title: string; body: string; meta?: string }) {
  return <div className="side-item"><strong>{title}</strong><span>{body || "-"}</span>{meta && <small>{meta}</small>}</div>;
}

function runEntries(events: TimelineEvent[]) {
  return events
    .filter((event) => {
      const type = String(event.type || "");
      return (
        type.startsWith("tool.") ||
        type === "item.tool_output" ||
        type === "turn.started" ||
        type === "turn.completed" ||
        type === "turn.interrupted" ||
        type === "turn.error" ||
        type === "model.stream_retry" ||
        type === "assistant.reasoning_completed" ||
        type === "item.reasoning"
      );
    })
    .slice(-12)
    .reverse()
    .map((event, index) => runEntryForEvent(event, index));
}

function runEntryForEvent(event: TimelineEvent, index: number): ActivityEntry {
  const key = String(event._event_id ?? `${event.type || "event"}-${event.created_at || event.timestamp || index}`);
  const type = String(event.type || "");
  if (type === "turn.started") {
    return { key, category: "system", title: "开始运行", body: "任务已进入运行队列", meta: eventTimeLabel(event) };
  }
  if (type === "turn.completed") {
    return { key, category: "system", title: "运行完成", body: "本轮任务已经完成", meta: eventTimeLabel(event) };
  }
  if (type === "turn.interrupted") {
    return { key, category: "system", title: "运行已停止", body: "本轮任务被中断", meta: eventTimeLabel(event) };
  }
  if (type === "turn.error") {
    return { key, category: "system", title: "运行失败", body: compactText(String(event.message || eventSummary(event) || "操作失败"), 140), meta: eventTimeLabel(event) };
  }
  if (type.startsWith("tool.") || type === "item.tool_output") {
    const name = String(event.name || event.tool_name || "python");
    return { key, category: "tool", title: `${name} 执行`, body: previewText(toolOutputText(event), 160) || "执行记录已同步", meta: eventTimeLabel(event) };
  }
  if (type === "model.stream_retry") {
    return { key, category: "system", title: "模型连接重试", body: compactText(String(event.message || eventSummary(event)), 140), meta: eventTimeLabel(event) };
  }
  if (type === "assistant.reasoning_completed" || type === "item.reasoning") {
    return { key, category: "system", title: "工作过程", body: compactText(String(event.text || event.reasoning_text || eventSummary(event)), 140), meta: eventTimeLabel(event) };
  }
  return activityEntryForEvent(event, index);
}
