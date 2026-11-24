<template>
  <main class="wx-auth form">
    <header class="wx-nav">
      <router-link class="wx-back" to="/login" aria-label="返回">
        <WxIcon name="back" />
      </router-link>
      <h1>注册</h1>
      <span></span>
    </header>
    <form @submit.prevent="submit">
      <label>
        <span>昵称</span>
        <input v-model="nickname" maxlength="20" placeholder="填写昵称" />
      </label>
      <label>
        <span>账号</span>
        <input v-model="username" autocomplete="username" placeholder="填写账号" />
      </label>
      <label>
        <span>密码</span>
        <input v-model="password" type="password" autocomplete="new-password" placeholder="填写密码" />
      </label>
      <p class="wx-error">{{ error }}</p>
      <button class="wx-green" type="submit">注册</button>
    </form>
    <p class="wx-switch">已有账号？<router-link to="/login">登录</router-link></p>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import WxIcon from '../components/WxIcon.vue';
import { register } from '../api';

const router = useRouter();
const username = ref('');
const nickname = ref('');
const password = ref('');
const error = ref('');

async function submit() {
  error.value = '';
  try {
    await register(username.value, password.value, nickname.value);
    await router.push('/');
  } catch (err) {
    error.value = err instanceof Error ? err.message : '注册失败';
  }
}
</script>
