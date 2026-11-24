const PALETTE = ['#07c160', '#1485ee', '#fa9d3b', '#e75e58', '#6467f0', '#10aeff'];

export function initial(name: string): string {
  const text = name.trim();
  return text ? [...text][0] : '友';
}

export function avatarColor(name: string): string {
  let hash = 0;
  for (const ch of name || '友') hash = (hash + ch.charCodeAt(0)) % PALETTE.length;
  return PALETTE[hash];
}

export function formatClock(value: number): string {
  if (!value) return '';
  const date = new Date(value);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function formatStamp(value: number): string {
  if (!value) return '';
  const date = new Date(value);
  const time = formatClock(value);
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}
