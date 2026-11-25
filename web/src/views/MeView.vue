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
        <span class="wx-avatar xl" :style="{ background: avatarColor(user.displayName) }">{{ initial(user.displayName) }}</span>
        <span>
          <strong>{{ user.displayName }}</strong>
          <em v-if="user.kind === 'formal'">账号：{{ user.username }}</em>
          <em v-else>登录后可以添加好友，聊天记录会保留</em>
        </span>
      </button>
      <template v-if="user?.kind === 'temp'">
        <button class="wx-me-row link" type="button" @click="router.push('/login')">登录</button>
        <button class="wx-me-row link" type="button" @click="router.push('/register')">注册</button>
      </template>
      <button v-else-if="user" class="wx-me-row" type="button" @click="exit">退出登录</button>
    </main>
  </WxFrame>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ensureUser, logout } from '../api';
import SessionList from '../components/SessionList.vue';
import WxFrame from '../components/WxFrame.vue';
import type { PublicUser } from '../types';
import { avatarColor, initial } from '../ui';

const router = useRouter();
const user = ref<PublicUser | null>(null);

onMounted(async () => {
  user.value = await ensureUser();
});

async function exit() {
  await logout();
  await router.push('/login');
}
</script>
