<script setup lang="ts">
defineProps<{ name: string }>();
</script>

<template>
  <svg class="wx-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path v-if="name === 'back'" d="M15 5 8 12l7 7" />
    <template v-else-if="name === 'video'">
      <rect x="3" y="7" width="11" height="10" rx="2" />
      <path d="m14 11 6-3v8l-6-3z" />
    </template>
    <template v-else-if="name === 'emoji'">
      <circle cx="12" cy="12" r="8" />
      <path d="M8.5 14.2c.8 1.2 2 1.8 3.5 1.8s2.7-.6 3.5-1.8" />
      <path d="M9 10h.01M15 10h.01" />
    </template>
    <template v-else-if="name === 'keyboard'">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 10h.01M12 10h.01M17 10h.01M7 14h10" />
    </template>
    <template v-else-if="name === 'mic'">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v3" />
    </template>
    <template v-else-if="name === 'more'">
      <circle cx="6" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'chat'">
      <path d="M6 17.5 4 20V7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v7A2.5 2.5 0 0 1 17.5 17H8z" />
    </template>
    <template v-else-if="name === 'me'">
      <circle cx="12" cy="9" r="3" />
      <path d="M6.5 19c.8-2.4 2.8-3.6 5.5-3.6s4.7 1.2 5.5 3.6" />
    </template>
    <template v-else-if="name === 'contacts'">
      <circle cx="9" cy="9" r="2.4" />
      <circle cx="16" cy="10" r="1.8" />
      <path d="M4.6 18.2c.6-2.3 2.3-3.4 4.4-3.4s3.8 1.1 4.4 3.4" />
      <path d="M13.2 18c.4-1.6 1.5-2.5 3-2.5 1.3 0 2.3.7 2.8 2" />
    </template>
    <template v-else-if="name === 'phone'">
      <path d="M8 4h2l1.2 3-1.6 1a12 12 0 0 0 6.4 6.4l1-1.6 3 1.2v2A2 2 0 0 1 18 18 14 14 0 0 1 6 6a2 2 0 0 1 2-2z" />
    </template>
    <template v-else-if="name === 'cam'">
      <rect x="4" y="7" width="10" height="10" rx="2" />
      <path d="m14 11 5-3v8l-5-3z" />
    </template>
    <path v-else-if="name === 'plus'" d="M12 6v12M6 12h12" />
    <template v-else-if="name === 'image'">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.4" fill="currentColor" stroke="none" />
      <path d="m5 16 4.2-4 2.6 2.4L15 11l4 5" />
    </template>
    <template v-else-if="name === 'file'">
      <path d="M7 4h6l4 4v12H7z" />
      <path d="M13 4v4h4M9 13h6M9 16h6" />
    </template>
  </svg>
</template>
