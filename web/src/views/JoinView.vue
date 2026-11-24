<template>
  <main class="wx-auth">
    <header class="wx-nav flat">
      <span></span>
      <h1>加入聊天</h1>
      <span></span>
    </header>
    <div v-if="!missing && room" class="wx-join-hero">
      <span class="wx-avatar xl" :style="{ background: avatarColor(room.ownerNickname || '友') }">{{ initial(room.ownerNickname || '友') }}</span>
      <h2>{{ title }}</h2>
      <p>加入后就可以发消息、语音和视频通话。</p>
    </div>
    <h2 v-else-if="missing">链接无效</h2>
    <p v-else class="wx-muted">正在确认房间。</p>
    <form v-if="room?.joinable" @submit.prevent="submit">
      <input id="nickname" v-model="nickname" maxlength="20" placeholder="你的名字" />
      <p class="wx-error">{{ error }}</p>
      <button class="wx-green" type="submit">加入</button>
    </form>
    <div v-else-if="room" class="wx-auth-actions">
      <button v-if="room.viewer === 'owner' || room.viewer === 'guest'" class="wx-green" type="button" @click="goCall">进入聊天</button>
      <p v-else class="wx-muted">这个链接现在不能加入。</p>
    </div>
    <p v-if="missing" class="wx-muted">房间不存在、已结束，或服务器刚刚重启。</p>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { joinRoom, roomDetail } from '../api';
import type { RoomDetail } from '../types';
import { avatarColor, initial } from '../ui';

const route = useRoute();
const router = useRouter();
const roomId = String(route.params.roomId);
const room = ref<RoomDetail | null>(null);
const nickname = ref('');
const error = ref('');
const missing = ref(false);

const title = computed(() => (missing.value ? '链接无效' : `${room.value?.ownerNickname || '对方'} 邀请你聊天`));

onMounted(async () => {
  try {
    room.value = await roomDetail(roomId);
  } catch {
    missing.value = true;
  }
});

function goCall() {
  void router.push(`/call/${roomId}`);
}

async function submit() {
  error.value = '';
  try {
    await joinRoom(roomId, nickname.value);
    await router.push(`/call/${roomId}`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加入失败';
  }
}
</script>
