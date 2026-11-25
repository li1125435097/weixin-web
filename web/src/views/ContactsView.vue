<template>
  <WxFrame mode="me">
    <template #sessions>
      <SessionList />
    </template>
    <main class="wx-me">
      <header class="wx-nav">
        <span></span>
        <h1>联系人</h1>
        <button v-if="user?.kind === 'formal'" type="button" aria-label="添加好友" @click="adding = !adding">
          <WxIcon name="plus" />
        </button>
        <button v-else type="button" aria-label="登录后添加好友" @click="router.push('/login?next=/contacts')">
          <WxIcon name="plus" />
        </button>
      </header>
      <form v-if="adding && user?.kind === 'formal'" class="wx-add-friend" @submit.prevent="submit">
        <input v-model="username" maxlength="20" placeholder="对方的用户名" />
        <button class="wx-green" type="submit">发送申请</button>
      </form>
      <p v-if="error" class="wx-error">{{ error }}</p>
      <p v-if="notice" class="wx-empty-line">{{ notice }}</p>
      <div v-if="incoming.length" class="wx-cells">
        <div v-for="item in incoming" :key="item.id" class="wx-cell static">
          <span class="wx-avatar" :style="{ background: avatarColor(item.displayName) }">{{ initial(item.displayName) }}</span>
          <span class="wx-cell-main">
            <span class="wx-cell-top"><strong>{{ item.displayName }}</strong></span>
            <p>请求添加你为好友</p>
          </span>
          <button class="wx-mini" type="button" @click="accept(item.id)">同意</button>
          <button class="wx-mini ghost" type="button" @click="decline(item.id)">拒绝</button>
        </div>
      </div>
      <div class="wx-cells">
        <button v-for="friend in friends" :key="friend.id" type="button" class="wx-cell" @click="open(friend.id)">
          <span class="wx-avatar" :style="{ background: avatarColor(friend.displayName) }">{{ initial(friend.displayName) }}</span>
          <span class="wx-cell-main">
            <span class="wx-cell-top"><strong>{{ friend.displayName }}</strong></span>
            <p v-if="friend.username">{{ friend.username }}</p>
          </span>
        </button>
        <p v-if="friends.length === 0" class="wx-empty-line">还没有联系人</p>
      </div>
    </main>
  </WxFrame>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { acceptFriend, ensureUser, listFriends, openDirect, rejectFriend, requestFriend } from '../api';
import SessionList from '../components/SessionList.vue';
import WxFrame from '../components/WxFrame.vue';
import WxIcon from '../components/WxIcon.vue';
import type { FriendCard, FriendRequestCard, PublicUser } from '../types';
import { avatarColor, initial } from '../ui';

const route = useRoute();
const router = useRouter();
const user = ref<PublicUser | null>(null);
const friends = ref<FriendCard[]>([]);
const incoming = ref<FriendRequestCard[]>([]);
const adding = ref(false);
const username = ref('');
const error = ref('');
const notice = ref('');

onMounted(async () => {
  user.value = await ensureUser();
  adding.value = route.query.add === '1' && user.value.kind === 'formal';
  await refresh();
});

watch(
  () => route.query.add,
  (value) => {
    if (value === '1' && user.value?.kind === 'formal') adding.value = true;
  },
);

async function refresh(): Promise<void> {
  const data = await listFriends();
  friends.value = data.friends;
  incoming.value = data.incoming;
}

async function submit(): Promise<void> {
  error.value = '';
  notice.value = '';
  try {
    await requestFriend(username.value);
    username.value = '';
    adding.value = false;
    notice.value = '申请已发送';
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '添加失败';
  }
}

async function accept(id: string): Promise<void> {
  error.value = '';
  await acceptFriend(id);
  await refresh();
}

async function decline(id: string): Promise<void> {
  await rejectFriend(id);
  await refresh();
}

async function open(userId: string): Promise<void> {
  if (user.value?.kind !== 'formal') {
    await router.push('/login?next=/contacts');
    return;
  }
  try {
    const conversation = await openDirect(userId);
    await router.push(`/chat/${conversation.id}`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : '无法打开聊天';
  }
}
</script>
