<template>
  <WxFrame mode="me">
    <template #sessions>
      <SessionList />
    </template>
    <main class="wx-me">
      <header class="wx-nav">
        <span></span>
        <h1>联系人</h1>
        <button v-if="user?.kind === 'formal'" type="button" aria-label="添加好友" @click="toggleAdd">
          <WxIcon name="plus" />
        </button>
        <button v-else type="button" aria-label="登录后添加好友" @click="router.push('/login?next=/contacts')">
          <WxIcon name="plus" />
        </button>
      </header>
      <form v-if="adding && user?.kind === 'formal'" class="wx-add-friend" @submit.prevent="search">
        <input v-model="username" maxlength="20" placeholder="对方的用户名" />
        <button class="wx-green" type="submit" :disabled="looking || !username.trim()">查找</button>
      </form>
      <p v-if="error && !found" class="wx-error">{{ error }}</p>
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
    <div v-if="found" class="wx-mask mid" @click.self="closeFound">
      <div class="wx-find" role="dialog" aria-modal="true" aria-labelledby="wx-find-name">
        <button class="wx-find-close" type="button" aria-label="关闭" @click="closeFound">×</button>
        <span class="wx-avatar xl" :style="{ background: avatarColor(found.displayName) }">{{ initial(found.displayName) }}</span>
        <strong id="wx-find-name">{{ found.displayName }}</strong>
        <p>{{ found.username }}</p>
        <button class="wx-green" type="button" :disabled="sending || found.relation === 'friend' || found.relation === 'outgoing'" @click="submit">
          {{ addLabel }}
        </button>
        <p v-if="error" class="wx-error">{{ error }}</p>
      </div>
    </div>
  </WxFrame>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { acceptFriend, ensureUser, listFriends, lookupFriend, openDirect, rejectFriend, requestFriend } from '../api';
import SessionList from '../components/SessionList.vue';
import WxFrame from '../components/WxFrame.vue';
import WxIcon from '../components/WxIcon.vue';
import type { FriendCard, FriendLookup, FriendRequestCard, PublicUser } from '../types';
import { avatarColor, initial } from '../ui';

const route = useRoute();
const router = useRouter();
const user = ref<PublicUser | null>(null);
const friends = ref<FriendCard[]>([]);
const incoming = ref<FriendRequestCard[]>([]);
const adding = ref(false);
const username = ref('');
const found = ref<FriendLookup | null>(null);
const looking = ref(false);
const sending = ref(false);
const error = ref('');
const notice = ref('');
const addLabel = computed(() => {
  if (found.value?.relation === 'friend') return '已经是好友';
  if (found.value?.relation === 'outgoing') return '申请已发送';
  return '添加好友';
});

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeFound();
}

onMounted(async () => {
  window.addEventListener('keydown', onKey);
  user.value = await ensureUser();
  adding.value = route.query.add === '1' && user.value.kind === 'formal';
  await refresh();
});

onUnmounted(() => window.removeEventListener('keydown', onKey));

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

function toggleAdd(): void {
  adding.value = !adding.value;
  if (!adding.value) closeFound();
}

function closeFound(): void {
  found.value = null;
  error.value = '';
}

async function search(): Promise<void> {
  error.value = '';
  notice.value = '';
  found.value = null;
  looking.value = true;
  try {
    found.value = await lookupFriend(username.value.trim());
  } catch (err) {
    error.value = err instanceof Error ? err.message : '没有找到这个用户';
  } finally {
    looking.value = false;
  }
}

async function submit(): Promise<void> {
  const target = found.value;
  if (!target || sending.value) return;
  error.value = '';
  notice.value = '';
  sending.value = true;
  try {
    await requestFriend(target.username);
    const added = target.relation === 'incoming';
    username.value = '';
    found.value = null;
    adding.value = false;
    notice.value = added ? '已添加好友' : '申请已发送';
    await refresh();
  } catch (err) {
    const message = err instanceof Error ? err.message : '添加失败';
    if (message === '已经是好友' && found.value) {
      found.value = { ...found.value, relation: 'friend' };
      return;
    }
    if (message === '申请已发送' && found.value) {
      found.value = { ...found.value, relation: 'outgoing' };
      return;
    }
    error.value = message;
  } finally {
    sending.value = false;
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
