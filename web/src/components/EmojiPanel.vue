<script setup lang="ts">
import { emojis } from '../emojis';

const emit = defineEmits<{ pick: [value: string]; backspace: [] }>();
</script>

<template>
  <div class="wx-emoji">
    <div class="wx-emoji-grid">
      <button v-for="emoji in emojis" :key="emoji" type="button" @click="emit('pick', emoji)">{{ emoji }}</button>
    </div>
    <div class="wx-emoji-bar">
      <span>表情</span>
      <button type="button" @click="emit('backspace')">删除</button>
    </div>
  </div>
</template>
