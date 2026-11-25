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
import SessionList from '../components/SessionList.vue';
import WxFrame from '../components/WxFrame.vue';
</script>
