<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { createRoom, ensureUser, listConversations } from '../api';
import { loadArchive } from '../chat-archive';
import { avatarColor, formatClock, initial } from '../ui';
import type { ChatMessage, ConversationSummary } from '../types';
import WxIcon from './WxIcon.vue';

const props = defineProps<{ activeId?: string; liveText?: string; liveAt?: number }>();
const router = useRouter();
const conversations = ref<ConversationSummary[]>([]);
const keyword = ref('');
const menuOpen = ref(false);
const error = ref('');
let timer = 0;
let userId = '';

const shown = computed(() => {
  const key = keyword.value.trim();
  return conversations.value.filter((item) => item.title.includes(key)).slice().sort((a, b) => activity(b) - activity(a));
});

function localTail(id: string): ChatMessage | undefined {
  if (!userId) return undefined;
  const rows = loadArchive(userId, id);
  return rows[rows.length - 1];
}

function activity(item: ConversationSummary): number {
  const localAt = localTail(item.id)?.createdAt || 0;
  if (props.activeId === item.id && props.liveAt) return Math.max(props.liveAt, localAt);
  return Math.max(item.updatedAt, localAt);
}

function preview(item: ConversationSummary): string {
  if (item.roomStatus === 'ringing') return '[视频通话]';
  if (item.roomStatus === 'active') return '[通话中]';
  if (props.activeId === item.id && props.liveText) return props.liveText;
  const tail = localTail(item.id);
  const localText = !tail ? '' : tail.type === 'voice' ? '[语音]' : tail.content.replace(/[\r\n]+/g, ' ');
  const placeholder = item.preview === '点击开始聊天' || item.preview === '邀请对方加入';
  if (localText && (placeholder || (tail && tail.createdAt > item.updatedAt))) return localText;
  return item.preview;
}

async function refresh(): Promise<void> {
  try {
    const user = await ensureUser();
    userId = user.id;
    conversations.value = (await listConversations()).conversations;
  } catch {
    window.clearInterval(timer);
  }
}

async function create(): Promise<void> {
  menuOpen.value = false;
  error.value = '';
  const user = await ensureUser();
  if (user.kind !== 'formal') {
    await router.push('/login?next=/');
    return;
  }
  try {
    const room = await createRoom();
    await router.push(`/chat/${room.conversationId}`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : '创建失败';
  }
}

async function addFriend(): Promise<void> {
  menuOpen.value = false;
  const user = await ensureUser();
  if (user.kind !== 'formal') {
    await router.push('/login?next=/contacts');
    return;
  }
  await router.push('/contacts?add=1');
}

onMounted(() => {
  void refresh();
  timer = window.setInterval(() => void refresh(), 5000);
});

onUnmounted(() => {
  window.clearInterval(timer);
});
</script>

<template>
  <div class="wx-sessions-inner">
    <header class="wx-nav">
      <span></span>
      <h1>微信</h1>
      <button type="button" aria-label="更多" @click="menuOpen = !menuOpen">
        <WxIcon name="plus" />
      </button>
    </header>
    <div v-if="menuOpen" class="wx-pop-mask" @click="menuOpen = false"></div>
    <div v-if="menuOpen" class="wx-pop">
      <button type="button" @click="create">发起聊天</button>
      <button type="button" @click="addFriend">添加好友</button>
    </div>
    <div class="wx-search">
      <input v-model="keyword" placeholder="搜索" />
    </div>
    <div class="wx-cells">
      <button
        v-for="item in shown"
        :key="item.id"
        type="button"
        class="wx-cell"
        :class="{ active: item.id === activeId, ringing: item.roomStatus === 'ringing' }"
        @click="router.push(`/chat/${item.id}`)"
      >
        <span class="wx-avatar" :style="{ background: avatarColor(item.title) }">{{ initial(item.title) }}</span>
        <span class="wx-cell-main">
          <span class="wx-cell-top">
            <strong>{{ item.title }}</strong>
            <em>{{ formatClock(activity(item)) }}</em>
          </span>
          <p>{{ preview(item) }}</p>
        </span>
        <em v-if="item.unread > 0" class="wx-badge">{{ item.unread > 99 ? '99+' : item.unread }}</em>
      </button>
      <p v-if="shown.length === 0" class="wx-empty-line">还没有聊天</p>
      <p v-if="error" class="wx-error">{{ error }}</p>
    </div>
  </div>
</template>
