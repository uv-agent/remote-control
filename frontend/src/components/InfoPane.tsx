import React from "react";
import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import clsx from "clsx";
import {
  Activity,
  ChevronLeft,
  FilePlus2,
  Folder,
  Image as ImageIcon,
  Paperclip,
  Radio,
  Settings,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Workflow,
} from "lucide-react";
import type {
  ActivityDigest,
  ActivityEntry,
  AttachmentDraft,
  CapabilityFeature,
  EventFilter,
  InfoTab,
  MaterialEntry,
  ModelLevelSummary,
  PickerSummary,
  ProjectInfo,
  RemoteCapabilities,
  RemoteConfig,
  Status,
  Thread,
  TimelineEvent,
} from "../types";
import {
  activityDigest,
  activityDigestBody,
  activityDigestTitle,
  activityEntryForEvent,
  attachmentEvents,
  capabilityRow,
  capabilityStatus,
  capabilitySummary,
  compactText,
  connectionState,
  eventCategory,
  formatRelativeTime,
  isProductEvent,
  levelLabel,
  materialEntries,
  materialSummaryText,
  pickerItemTitle,
  runtimeSummary,
  taskProgressText,
  toolIndexSummary,
  uploadLimitText,
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
  const paneMeta = props.thread?.updated_at ? `更新于 ${formatRelativeTime(props.thread.updated_at)}` : props.project?.path || "选择任务后查看上下文";
  return (
    <aside className="info-pane">
      <header className="info-head">
        <PanelIconButton title="关闭" className="drawer-close" onClick={props.close}><ChevronLeft /></PanelIconButton>
        <div>
          <h2>工作台</h2>
          <p title={paneTitle}>{paneTitle} · {paneMeta}</p>
        </div>
        <div className="info-head-tools">
          <span className={clsx("info-head-state", props.status.className)}>{props.status.label}</span>
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

function OverviewPanel({ project, thread, events, attachments, status, connection, setInfoTab }: React.ComponentProps<typeof InfoPane>) {
  const productEvents = events.filter(isProductEvent);
  const attachmentCount = attachmentEvents(events).length + attachments.length;
  const visibleEventCount = productEvents.length;
  const digest = activityDigest(productEvents);
  const latest = productEvents.length ? activityEntryForEvent(productEvents[productEvents.length - 1], productEvents.length - 1) : null;
  const taskText = thread?.last_text ? compactText(thread.last_text, 150) : status.className === "running" ? "任务正在执行，新的结果会自动追加到详情页。" : "还没有提交内容，可以从底部输入框开始新的任务。";
  const updateText = thread?.updated_at ? formatRelativeTime(thread.updated_at) : "等待活动";
  const modelText = [thread?.active_model || "默认模型", thread?.active_level ? levelLabel(thread.active_level) : ""].filter(Boolean).join(" · ");
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
        </div>
        <div className="workbench-actions info-actions" aria-label="工作台操作">
          <WorkbenchAction icon={<Activity />} label="看活动" meta={visibleEventCount ? `${visibleEventCount} 条` : "暂无"} onClick={() => setInfoTab("events")} />
          <WorkbenchAction icon={<UploadCloud />} label="素材" meta={attachmentCount ? `${attachmentCount} 个` : "待上传"} onClick={() => setInfoTab("attachments")} />
          <WorkbenchAction icon={<ShieldCheck />} label="运行" meta={connectionText} onClick={() => setInfoTab("status")} state={status.className} />
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
          <strong>{levels.length ? `${levels.length} 个可选` : core?.agent_api ? "暂无档位" : "未提供"}</strong>
        </header>
        <div className="env-row-list">
          {levels.length ? levels.slice(0, 5).map((level) => <ModelLevelRow key={level.id || level.model || "level"} level={level} defaultLevel={core?.models?.default_level || ""} />) : (
                <EnvironmentEmpty title={core?.agent_api ? "还没有可展示模型" : "模型摘要未提供"} body={core?.agent_api ? "检查配置里的 public levels" : "当前 core 未提供模型、provider 和上下文窗口摘要"} />
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
  if (id === "status") return <Settings size={13} />;
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
