<template>
  <WxFrame mode="list">
    <template #sessions>
      <SessionList />
    </template>
    <div class="wx-blank">
      <p>未选择聊天</p>
    </div>
  </WxFrame>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import SessionList from '../components/SessionList.vue';
import WxFrame from '../components/WxFrame.vue';
import { me } from '../api';

const router = useRouter();

onMounted(async () => {
  try {
    await me();
  } catch {
    await router.replace('/login');
  }
});
</script>
