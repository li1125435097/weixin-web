<template>
  <WxFrame mode="me">
    <template #sessions>
      <SessionList />
    </template>
    <main class="wx-me">
      <header class="wx-nav">
        <span></span>
        <h1>我</h1>
        <span></span>
      </header>
      <button v-if="user" type="button" class="wx-profile">
        <span class="wx-avatar xl" :style="{ background: avatarColor(user.nickname || user.username) }">{{ initial(user.nickname || user.username) }}</span>
        <span>
          <strong>{{ user.nickname || user.username }}</strong>
          <em>账号：{{ user.username }}</em>
        </span>
      </button>
      <button class="wx-me-row" type="button" @click="exit">退出登录</button>
    </main>
  </WxFrame>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { logout, me } from '../api';
import SessionList from '../components/SessionList.vue';
import WxFrame from '../components/WxFrame.vue';
import type { PublicUser } from '../types';
import { avatarColor, initial } from '../ui';

const router = useRouter();
const user = ref<PublicUser | null>(null);

onMounted(async () => {
  try {
    user.value = await me();
  } catch {
    await router.replace('/login');
  }
});

async function exit() {
  await logout();
  await router.push('/login');
}
</script>
