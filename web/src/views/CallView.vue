<template>
  <WxFrame mode="chat">
    <template #sessions>
      <SessionList :active-id="conversationId" :live-text="liveText" :live-at="liveAt" />
    </template>

    <section v-if="phase === 'boot'" class="wx-ended"><p>正在连接</p></section>
    <section v-else-if="phase === 'ended'" class="wx-ended">
      <template v-if="!hideReplaced">
        <p>{{ endedReason }}</p>
        <button type="button" @click="router.push('/')">返回消息</button>
      </template>
    </section>
    <section v-else class="wx-chat">
      <header class="wx-nav">
        <button class="wx-back" type="button" aria-label="返回" @click="leaveChat">
          <WxIcon name="back" />
        </button>
        <h1>{{ peerName || (invitePath ? '等待对方加入' : '聊天') }}</h1>
        <span class="wx-nav-actions">
          <button type="button" aria-label="视频通话" @click="onVideo">
            <WxIcon name="video" />
          </button>
          <button type="button" aria-label="更多" @click.stop="menuOpen = !menuOpen">
            <WxIcon name="more" />
          </button>
        </span>
      </header>
      <div v-if="menuOpen" class="wx-pop-mask" @click="menuOpen = false"></div>
      <div v-if="menuOpen" class="wx-pop">
        <button type="button" @click="askClear">清空聊天记录</button>
        <button v-if="invitePath" type="button" @click="copyLink">复制邀请链接</button>
        <button v-if="invitePath" class="danger" type="button" @click="closeChat">结束聊天</button>
      </div>
      <p v-if="peerReconnecting" class="wx-banner">对方正在重连</p>
      <div ref="scroller" class="wx-msgs">
        <p v-if="messages.length === 0" class="wx-system">可以发消息、语音，或点右上角视频通话</p>
        <section v-if="invitePath && !peerJoined" class="wx-invite">
          <p>把链接发给对方，打开就能聊天、发语音、打视频。对方不在线也能收到消息。</p>
          <p class="wx-url">{{ link }}</p>
          <button type="button" @click="copyLink">复制邀请链接</button>
        </section>
        <template v-for="(message, index) in messages" :key="message.id">
          <p v-if="showTime(index)" class="wx-time">{{ formatStamp(message.createdAt) }}</p>
          <p v-if="message.type === 'system'" class="wx-system">{{ message.content }}</p>
          <div v-else class="wx-row" :class="{ mine: message.senderId === selfId }">
            <span class="wx-avatar" :style="{ background: avatarColor(avatarName(message)) }">{{ initial(avatarName(message)) }}</span>
            <div class="wx-msg-col">
              <button
                v-if="message.type === 'voice'"
                type="button"
                class="wx-voice"
                :style="{ width: voiceWidth(message) }"
                @click="playVoice(message)"
              >
                <i :class="{ playing: playingId === message.id }"></i>
                <span>{{ voiceSeconds(message) }}"</span>
              </button>
              <p v-else class="wx-bubble">{{ message.content }}</p>
              <em v-if="message.senderId === selfId" class="wx-read" :class="{ on: message.read }">{{ message.read ? '已读' : '未读' }}</em>
            </div>
          </div>
        </template>
      </div>
      <form class="wx-compose" :class="{ safe: !emojiOpen }" @submit.prevent="send">
        <button class="wx-icon-btn" type="button" :aria-label="voiceMode ? '键盘' : '语音'" @click="toggleVoice">
          <WxIcon :name="voiceMode ? 'keyboard' : 'mic'" />
        </button>
        <button
          v-if="voiceMode"
          class="wx-hold"
          :class="{ holding, cancel: canceling }"
          type="button"
          @pointerdown="holdStart"
          @pointermove="holdMove"
          @pointerup="holdEnd"
          @pointercancel="holdEnd"
          @contextmenu.prevent
        >
          {{ holding ? '松开 结束' : '按住 说话' }}
        </button>
        <textarea
          v-else
          ref="inputRef"
          v-model="draft"
          rows="1"
          enterkeyhint="send"
          placeholder=""
          @focus="emojiOpen = false"
          @keydown="onDraftKey"
          @input="fitDraft"
        />
        <button class="wx-icon-btn" type="button" aria-label="表情" @click="toggleEmoji">
          <WxIcon :name="emojiOpen ? 'keyboard' : 'emoji'" />
        </button>
        <button v-if="draft.trim()" class="wx-send" type="submit">发送</button>
      </form>
      <EmojiPanel v-if="emojiOpen" @pick="insertEmoji" @backspace="backspace" />
    </section>

    <div v-if="inCall" class="wx-call" :class="phase">
      <video v-show="phase === 'active'" ref="remoteVideo" class="wx-remote" autoplay playsinline />
      <video ref="localVideo" class="wx-local" :class="{ show: showLocal }" autoplay playsinline muted />
      <header v-if="phase === 'active'" class="wx-call-top">
        <strong>{{ peerName || '对方' }}</strong>
        <p>{{ durationText }}</p>
        <p v-if="deviceLine" class="wx-devices">{{ deviceLine }}</p>
        <button v-if="camState === 'ready'" type="button" @click="flipCam">翻转</button>
      </header>
      <div v-if="phase !== 'active' || !hasRemoteVideo" class="wx-peer">
        <span class="wx-avatar xl" :style="{ background: avatarColor(peerName || '对方') }">{{ initial(peerName || '对方') }}</span>
        <template v-if="phase !== 'active'">
          <h2>{{ peerName || '对方' }}</h2>
          <p>{{ phase === 'incoming' ? '邀请你视频通话' : '等待对方接受邀请' }}</p>
          <p v-if="deviceLine" class="wx-devices">{{ deviceLine }}</p>
        </template>
      </div>
      <div class="wx-call-actions">
        <template v-if="phase === 'incoming'">
          <button class="wx-round reject" type="button" :disabled="busy" @click="reject">
            <span class="face"><WxIcon name="phone" /></span>
            <small>拒绝</small>
          </button>
          <button class="wx-round accept" type="button" :disabled="busy" @click="accept">
            <span class="face"><WxIcon name="video" /></span>
            <small>接听</small>
          </button>
        </template>
        <button v-else-if="phase === 'outgoing'" class="wx-round hang" type="button" @click="hangup">
          <span class="face"><WxIcon name="phone" /></span>
          <small>取消</small>
        </button>
        <template v-else>
          <button class="wx-round" :class="deviceClass(micState, micOn)" type="button" @click="toggleMic">
            <span class="face"><WxIcon name="mic" /></span>
            <small>{{ deviceLabel(micState, micOn, '麦克风') }}</small>
          </button>
          <button class="wx-round hang" type="button" @click="hangup">
            <span class="face"><WxIcon name="phone" /></span>
            <small>挂断</small>
          </button>
          <button class="wx-round" :class="deviceClass(camState, camOn)" type="button" @click="toggleCam">
            <span class="face"><WxIcon name="cam" /></span>
            <small>{{ deviceLabel(camState, camOn, '摄像头') }}</small>
          </button>
        </template>
      </div>
    </div>

    <div v-if="holding" class="wx-record" :class="{ cancel: canceling }">
      <strong>{{ canceling ? '松开手指，取消发送' : '手指上滑，取消发送' }}</strong>
    </div>
    <p v-if="toast" class="wx-toast">{{ toast }}</p>

    <div v-if="shareOpen || clearAsk" class="wx-mask" @click.self="closeSheets">
      <div class="wx-sheet">
        <template v-if="shareOpen">
          <h3>对方还没进来</h3>
          <p class="wx-url">{{ link }}</p>
          <button class="wx-green" type="button" @click="copyLink">复制邀请链接</button>
        </template>
        <template v-else>
          <h3>清空服务器聊天记录</h3>
          <p>只删除服务器上这条聊天的记录，本机记录仍会保留并继续显示。</p>
          <button class="danger" type="button" :disabled="clearing" @click="confirmClear">清空</button>
        </template>
        <button type="button" @click="closeSheets">取消</button>
      </div>
    </div>
  </WxFrame>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import EmojiPanel from '../components/EmojiPanel.vue';
import SessionList from '../components/SessionList.vue';
import WxFrame from '../components/WxFrame.vue';
import WxIcon from '../components/WxIcon.vue';
import { clearMessages } from '../api';
import { useCall, type DeviceState } from '../composables/useCall';
import type { ChatMessage } from '../types';
import { avatarColor, formatStamp, initial } from '../ui';

const route = useRoute();
const router = useRouter();
const conversationId = String(route.params.conversationId);
const localVideo = ref<HTMLVideoElement | null>(null);
const remoteVideo = ref<HTMLVideoElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null);
const draft = ref('');
const emojiOpen = ref(false);
const voiceMode = ref(false);
const shareOpen = ref(false);
const menuOpen = ref(false);
const clearAsk = ref(false);
const clearing = ref(false);
const holding = ref(false);
const canceling = ref(false);
const pressed = ref(false);
const toast = ref('');
const playingId = ref<string | null>(null);
const now = ref(Date.now());
const audio = new Audio();
const urls = new Map<string, string>();
let clockTimer = 0;
let maxTimer = 0;
let recorder: MediaRecorder | null = null;
let recordStream: MediaStream | null = null;
let chunks: Blob[] = [];
let recordStarted = 0;
let startY = 0;
let holdGen = 0;

const {
  phase,
  selfId,
  selfName,
  peerName,
  peerJoined,
  invitePath,
  messages,
  error,
  notice,
  endedReason,
  endedCode,
  micOn,
  camOn,
  micState,
  camState,
  hasRemoteVideo,
  connectedAt,
  peerReconnecting,
  busy,
  inviteCall,
  accept,
  reject,
  hangup,
  closeRoom,
  toggleMic,
  toggleCam,
  flipCam,
  sendChat,
  sendVoice,
} = useCall(conversationId, { local: localVideo, remote: remoteVideo });

const mobileQuery = window.matchMedia('(max-width: 899px), (hover: none) and (pointer: coarse)');
const narrow = ref(mobileQuery.matches);
const hideReplaced = computed(() => narrow.value && endedCode.value === 'replaced');
const inCall = computed(() => phase.value === 'outgoing' || phase.value === 'incoming' || phase.value === 'active');
const showLocal = computed(() => camState.value === 'ready' && camOn.value && (phase.value === 'active' || phase.value === 'outgoing'));
const link = computed(() => {
  if (!invitePath.value) return '';
  const prefix = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${location.origin}${prefix}${invitePath.value}`;
});
const liveText = computed(() => {
  const last = messages.value[messages.value.length - 1];
  if (!last) return '';
  if (last.type === 'voice') return '[语音]';
  return last.content.replace(/[\r\n]+/g, ' ');
});
const liveAt = computed(() => messages.value[messages.value.length - 1]?.createdAt || 0);
const durationText = computed(() => {
  if (!connectedAt.value) return '接通中';
  const total = Math.max(0, Math.floor((now.value - connectedAt.value) / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
});
const deviceLine = computed(() => {
  const parts = [devicePhrase('摄像头', camState.value), devicePhrase('麦克风', micState.value)].filter(Boolean);
  return parts.join(' · ');
});

watch(draft, () => {
  void nextTick(fitDraft);
});

watch(
  () => messages.value.length,
  async () => {
    await nextTick();
    scroller.value?.scrollTo({ top: scroller.value.scrollHeight });
  },
);

watch([notice, error], () => {
  const text = error.value || notice.value;
  if (!text) return;
  toast.value = text;
  window.setTimeout(() => {
    if (toast.value === text) toast.value = '';
    if (error.value === text) error.value = '';
    if (notice.value === text) notice.value = '';
  }, text.length > 16 ? 5000 : 2200);
});

function onResize(): void {
  narrow.value = mobileQuery.matches;
}

watch(hideReplaced, (hide) => {
  if (hide) void router.replace('/');
});

onMounted(() => {
  window.addEventListener('resize', onResize);
  clockTimer = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
  audio.onended = () => {
    playingId.value = null;
  };
});

onUnmounted(() => {
  window.removeEventListener('resize', onResize);
  window.clearInterval(clockTimer);
  window.clearTimeout(maxTimer);
  audio.pause();
  urls.forEach((url) => URL.revokeObjectURL(url));
  recordStream?.getTracks().forEach((track) => track.stop());
});

onBeforeRouteLeave(async () => {
  if (phase.value === 'incoming') await reject();
  else if (phase.value === 'active' || phase.value === 'outgoing') await hangup();
});

function avatarName(message: ChatMessage): string {
  if (message.senderId === selfId.value) return selfName.value || '我';
  return message.senderName || peerName.value || '对方';
}

function showTime(index: number): boolean {
  const current = messages.value[index];
  if (!current || current.type === 'system') return false;
  const prev = messages.value
    .slice(0, index)
    .reverse()
    .find((item) => item.type !== 'system');
  if (!prev) return true;
  return current.createdAt - prev.createdAt > 5 * 60 * 1000;
}

function devicePhrase(name: string, state: DeviceState): string {
  if (state === 'missing') return `${name}未找到`;
  if (state === 'denied') return `${name}未授权`;
  if (state === 'unavailable') return `${name}不可用`;
  return '';
}

function deviceLabel(state: DeviceState, on: boolean, name: string): string {
  if (state === 'missing') return '未找到';
  if (state === 'denied') return '未授权';
  if (state === 'unavailable') return '不可用';
  if (state !== 'ready') return '检测中';
  return on ? name : '已关闭';
}

function deviceClass(state: DeviceState, on: boolean): Record<string, boolean> {
  return {
    bad: state === 'missing' || state === 'denied' || state === 'unavailable',
    off: state === 'ready' && !on,
  };
}

function leaveChat(): void {
  void router.push('/');
}

function onVideo(): void {
  if (!peerJoined.value) {
    shareOpen.value = true;
    return;
  }
  void inviteCall();
}

function toggleVoice(): void {
  voiceMode.value = !voiceMode.value;
  emojiOpen.value = false;
}

function toggleEmoji(): void {
  emojiOpen.value = !emojiOpen.value;
  if (emojiOpen.value) {
    voiceMode.value = false;
    inputRef.value?.blur();
  }
}

function onDraftKey(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  void send();
}

function fitDraft(): void {
  const el = inputRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
}

function insertEmoji(emoji: string): void {
  const el = inputRef.value;
  const start = el?.selectionStart ?? draft.value.length;
  const end = el?.selectionEnd ?? start;
  draft.value = `${draft.value.slice(0, start)}${emoji}${draft.value.slice(end)}`;
  void nextTick(() => {
    const pos = start + emoji.length;
    el?.focus();
    el?.setSelectionRange(pos, pos);
  });
}

function backspace(): void {
  draft.value = [...draft.value].slice(0, -1).join('');
}

async function send(): Promise<void> {
  const text = draft.value;
  if (await sendChat(text)) {
    draft.value = '';
    void nextTick(fitDraft);
  }
}

async function copyLink(): Promise<void> {
  const text = link.value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', 'true');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  notice.value = '邀请链接已复制';
  shareOpen.value = false;
  menuOpen.value = false;
}

function closeSheets(): void {
  shareOpen.value = false;
  clearAsk.value = false;
}

function askClear(): void {
  menuOpen.value = false;
  clearAsk.value = true;
}

async function confirmClear(): Promise<void> {
  if (clearing.value) return;
  clearing.value = true;
  try {
    await clearMessages(conversationId);
    clearAsk.value = false;
    notice.value = '已清空服务器聊天记录';
  } catch (err) {
    error.value = err instanceof Error ? err.message : '清空失败';
  } finally {
    clearing.value = false;
  }
}

async function closeChat(): Promise<void> {
  menuOpen.value = false;
  const ok = await closeRoom();
  if (ok) await router.push('/');
}

function voiceSeconds(message: ChatMessage): number {
  return Math.max(1, Math.round((message.durationMs || 1000) / 1000));
}

function voiceWidth(message: ChatMessage): string {
  return `${Math.min(220, 72 + voiceSeconds(message) * 4)}px`;
}

function voiceSrc(message: ChatMessage): string {
  const cached = urls.get(message.id);
  if (cached) return cached;
  const binary = atob(message.content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: message.mime || 'audio/webm' });
  const url = URL.createObjectURL(blob);
  urls.set(message.id, url);
  return url;
}

function playVoice(message: ChatMessage): void {
  if (message.type !== 'voice') return;
  if (playingId.value === message.id) {
    audio.pause();
    playingId.value = null;
    return;
  }
  audio.src = voiceSrc(message);
  void audio.play();
  playingId.value = message.id;
}

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac'];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

async function holdStart(event: PointerEvent): Promise<void> {
  if (pressed.value) return;
  pressed.value = true;
  canceling.value = false;
  startY = event.clientY;
  const target = event.currentTarget as HTMLElement;
  try {
    target.setPointerCapture(event.pointerId);
  } catch {
    /* pointer capture is optional */
  }
  if (typeof MediaRecorder === 'undefined') {
    pressed.value = false;
    notice.value = '当前浏览器不能发送语音';
    return;
  }
  const gen = ++holdGen;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    pressed.value = false;
    notice.value = err instanceof DOMException && err.name === 'NotAllowedError' ? '未授权使用麦克风' : '没有找到麦克风';
    return;
  }
  if (!pressed.value || gen !== holdGen) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }
  const mime = pickMime();
  chunks = [];
  recordStream = stream;
  recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  recorder.ondataavailable = (ev) => {
    if (ev.data.size) chunks.push(ev.data);
  };
  recorder.start();
  recordStarted = Date.now();
  holding.value = true;
  navigator.vibrate?.(15);
  window.clearTimeout(maxTimer);
  maxTimer = window.setTimeout(() => void holdEnd(), 60_000);
}

function holdMove(event: PointerEvent): void {
  if (!holding.value) return;
  canceling.value = startY - event.clientY > 70;
}

async function holdEnd(): Promise<void> {
  pressed.value = false;
  window.clearTimeout(maxTimer);
  if (!holding.value) return;
  holding.value = false;
  const rec = recorder;
  const cancel = canceling.value;
  const elapsed = Date.now() - recordStarted;
  recorder = null;
  canceling.value = false;
  if (rec && rec.state !== 'inactive') {
    await new Promise<void>((resolve) => {
      rec.addEventListener('stop', () => resolve(), { once: true });
      rec.stop();
    });
  }
  recordStream?.getTracks().forEach((track) => track.stop());
  recordStream = null;
  if (cancel) return;
  if (elapsed < 800) {
    notice.value = '说话时间太短';
    return;
  }
  const blob = new Blob(chunks, { type: rec?.mimeType || 'audio/webm' });
  const content = await blobToBase64(blob);
  await sendVoice(content, Math.round(elapsed), blob.type || 'audio/webm');
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      resolve(text.slice(text.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
</script>
