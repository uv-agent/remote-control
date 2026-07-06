import type { ThreadFilter } from "./types";

export const LEVEL_OPTIONS = [
  { value: "", label: "默认" },
  { value: "small", label: "快速" },
  { value: "medium", label: "标准" },
  { value: "large", label: "深度" },
];

export const CONFLICT_OPTIONS = [
  { value: "queue", label: "排队" },
  { value: "guide", label: "询问" },
  { value: "interrupt", label: "接管" },
  { value: "reject", label: "空闲" },
];

export const SELECT_DEFAULT_VALUE = "__default__";

export const THREAD_FILTER_OPTIONS: Array<{ value: ThreadFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "running", label: "运行" },
  { value: "done", label: "完成" },
  { value: "attention", label: "待处理" },
];

export const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
export const CACHE_DB_NAME = "uv-agent-remote-control";

export const LEVEL_LABELS: Record<string, string> = {
  low: "快速",
  small: "快速",
  medium: "标准",
  high: "深度",
  deep: "深度",
  large: "深度",
};

export const CONFLICT_LABELS: Record<string, string> = {
  queue: "排队运行",
  guide: "先询问",
  interrupt: "停止后运行",
  reject: "忙时不提交",
};
