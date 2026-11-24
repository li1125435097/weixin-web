<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { createRoom, listRooms } from '../api';
import { lastMessage } from '../chatStorage';
import { avatarColor, formatClock, initial } from '../ui';
import type { RoomSummary } from '../types';
import WxIcon from './WxIcon.vue';

const props = defineProps<{ activeId?: string; liveText?: string; liveAt?: number }>();
const router = useRouter();
const rooms = ref<RoomSummary[]>([]);
const keyword = ref('');
const menuOpen = ref(false);
const error = ref('');
const tick = ref(0);
let timer = 0;

const shown = computed(() => {
  tick.value;
  const key = keyword.value.trim();
  return rooms.value
    .filter((room) => (room.guestName || '等待对方加入').includes(key))
    .slice()
    .sort((a, b) => activity(b) - activity(a));
});

function activity(room: RoomSummary): number {
  if (props.activeId === room.id && props.liveAt) return props.liveAt;
  return lastMessage(room.id)?.createdAt || room.createdAt;
}

function titleOf(room: RoomSummary): string {
  return room.guestName || '等待对方加入';
}

function preview(room: RoomSummary): string {
  if (room.status === 'ringing') return '[视频通话]';
  if (room.status === 'active') return '[通话中]';
  if (props.activeId === room.id && props.liveText) return props.liveText;
  const last = lastMessage(room.id);
  if (!last) return room.guestName ? '点击开始聊天' : '邀请对方加入';
  if (last.type === 'voice') return '[语音]';
  return last.content;
}

function when(room: RoomSummary): string {
  return formatClock(activity(room));
}

async function refresh(): Promise<void> {
  try {
    rooms.value = (await listRooms()).rooms;
  } catch {
    window.clearInterval(timer);
  }
}

async function create(): Promise<void> {
  menuOpen.value = false;
  error.value = '';
  try {
    const room = await createRoom();
    await router.push(`/call/${room.id}`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : '创建失败';
  }
}

function onMessages(): void {
  tick.value += 1;
}

onMounted(() => {
  void refresh();
  timer = window.setInterval(() => void refresh(), 5000);
  window.addEventListener('webcall-messages', onMessages);
});

onUnmounted(() => {
  window.clearInterval(timer);
  window.removeEventListener('webcall-messages', onMessages);
});
</script>

<template>
  <div class="wx-sessions-inner">
    <header class="wx-nav">
      <span></span>
      <h1>微信</h1>
      <button type="button" aria-label="发起聊天" @click="menuOpen = !menuOpen">
        <WxIcon name="plus" />
      </button>
    </header>
    <div v-if="menuOpen" class="wx-pop-mask" @click="menuOpen = false"></div>
    <div v-if="menuOpen" class="wx-pop">
      <button type="button" @click="create">发起聊天</button>
    </div>
    <div class="wx-search">
      <input v-model="keyword" placeholder="搜索" />
    </div>
    <div class="wx-cells">
      <button
        v-for="room in shown"
        :key="room.id"
        type="button"
        class="wx-cell"
        :class="{ active: room.id === activeId, ringing: room.status === 'ringing' }"
        @click="router.push(`/call/${room.id}`)"
      >
        <span class="wx-avatar" :style="{ background: avatarColor(titleOf(room)) }">{{ initial(titleOf(room)) }}</span>
        <span class="wx-cell-main">
          <span class="wx-cell-top">
            <strong>{{ titleOf(room) }}</strong>
            <em>{{ when(room) }}</em>
          </span>
          <p>{{ preview(room) }}</p>
        </span>
      </button>
      <p v-if="shown.length === 0" class="wx-empty-line">还没有聊天</p>
      <p v-if="error" class="wx-error">{{ error }}</p>
    </div>
  </div>
</template>
