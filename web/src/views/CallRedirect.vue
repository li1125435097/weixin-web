<template>
  <main class="wx-auth">
    <p class="wx-muted">正在打开聊天</p>
  </main>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { roomDetail } from '../api';

const route = useRoute();
const router = useRouter();

onMounted(async () => {
  try {
    const room = await roomDetail(String(route.params.roomId));
    await router.replace(room.conversationId ? `/chat/${room.conversationId}` : '/');
  } catch {
    await router.replace('/');
  }
});
</script>
