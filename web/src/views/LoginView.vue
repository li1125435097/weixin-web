<template>
  <main class="wx-auth">
    <div class="wx-logo" aria-hidden="true">
      <svg viewBox="0 0 64 64">
        <rect width="64" height="64" rx="14" fill="#07c160" />
        <path fill="#fff" d="M16 18h22a8 8 0 0 1 8 8v6a8 8 0 0 1-8 8H28l-7 6v-6h-5a8 8 0 0 1-8-8v-6a8 8 0 0 1 8-8z" />
      </svg>
    </div>
    <h1>登录</h1>
    <form @submit.prevent="submit">
      <input id="username" v-model="username" autocomplete="username" placeholder="用户名" />
      <input id="password" v-model="password" type="password" autocomplete="current-password" placeholder="密码" />
      <p class="wx-error">{{ error }}</p>
      <button class="wx-green" type="submit" :disabled="!username.trim() || !password">登录</button>
    </form>
    <p class="wx-switch">没有账号？<router-link to="/register">注册</router-link></p>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { login } from '../api';

const route = useRoute();
const router = useRouter();
const username = ref('');
const password = ref('');
const error = ref('');

async function submit() {
  error.value = '';
  try {
    await login(username.value, password.value);
    const next = typeof route.query.next === 'string' ? route.query.next : '/';
    await router.push(next);
  } catch (err) {
    error.value = err instanceof Error ? err.message : '登录失败';
  }
}
</script>
