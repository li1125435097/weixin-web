<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { listRooms, me } from '../api';
import WxIcon from './WxIcon.vue';

withDefaults(defineProps<{ mode: 'list' | 'chat' | 'me'; showSessions?: boolean }>(), {
  showSessions: true,
});

const route = useRoute();
const router = useRouter();
const wide = ref(window.matchMedia('(min-width: 900px)').matches);
let timer = 0;

function onResize(): void {
  wide.value = window.matchMedia('(min-width: 900px)').matches;
}

async function watchIncoming(): Promise<void> {
  try {
    const { rooms } = await listRooms();
    const hit = rooms.find((room) => room.status === 'ringing' && room.callFrom === 'guest');
    if (!hit) return;
    if (route.name === 'call' && String(route.params.roomId) === hit.id) return;
    await router.push(`/call/${hit.id}`);
  } catch {
    window.clearInterval(timer);
  }
}

function openChats(): void {
  if (route.name === 'me') void router.push('/');
}

function openMe(): void {
  if (route.name !== 'me') void router.push('/me');
}

onMounted(async () => {
  window.addEventListener('resize', onResize);
  try {
    await me();
  } catch {
    return;
  }
  void watchIncoming();
  timer = window.setInterval(() => void watchIncoming(), 3000);
});

onUnmounted(() => {
  window.removeEventListener('resize', onResize);
  window.clearInterval(timer);
});
</script>

<template>
  <div class="wx-app" :class="[`mode-${mode}`, { wide, 'no-sessions': !showSessions }]">
    <div class="wx-body">
      <nav v-if="wide && showSessions" class="wx-rail">
        <button type="button" :class="{ on: route.name !== 'me' }" @click="openChats">
          <WxIcon name="chat" />
        </button>
        <button type="button" :class="{ on: route.name === 'me' }" @click="openMe">
          <WxIcon name="me" />
        </button>
      </nav>
      <aside v-if="showSessions" class="wx-sessions">
        <slot name="sessions" />
      </aside>
      <section class="wx-stage">
        <slot />
      </section>
    </div>
    <nav v-if="!wide && mode !== 'chat'" class="wx-tabs">
      <button type="button" :class="{ on: route.name === 'home' }" @click="router.push('/')">
        <WxIcon name="chat" />
        <span>微信</span>
      </button>
      <button type="button" :class="{ on: route.name === 'me' }" @click="router.push('/me')">
        <WxIcon name="me" />
        <span>我</span>
      </button>
    </nav>
  </div>
</template>
