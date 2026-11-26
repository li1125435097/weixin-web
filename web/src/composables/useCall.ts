import { onScopeDispose, ref, watch, type Ref } from 'vue';
import { io, type Socket } from 'socket.io-client';
import { ensureUser, fetchTurn, listMessages } from '../api';
import { loadArchive, mergeArchives, saveArchive } from '../chat-archive';
import type { ChatMessage } from '../types';

export type Phase = 'boot' | 'chat' | 'outgoing' | 'incoming' | 'active' | 'ended';
export type DeviceState = 'unknown' | 'ready' | 'missing' | 'denied' | 'unavailable';
type Role = 'owner' | 'guest';
type RoomStatus = 'waiting' | 'ringing' | 'active';

interface JoinState {
  role: Role;
  status: RoomStatus;
  reconnected: boolean;
  selfName: string;
  peerName: string;
  peerOnline: boolean;
  expiresAt: number;
  callFrom: Role | null;
}

interface Ack {
  ok: boolean;
  message?: string;
}

export function useCall(
  conversationId: string,
  video: { local: Ref<HTMLVideoElement | null>; remote: Ref<HTMLVideoElement | null> },
) {
  const phase = ref<Phase>('boot');
  const role = ref<Role | null>(null);
  const status = ref<RoomStatus>('waiting');
  const selfId = ref('');
  const selfName = ref('');
  const peerName = ref('');
  const peerOnline = ref(false);
  const peerJoined = ref(false);
  const invitePath = ref<string | null>(null);
  const expiresAt = ref(0);
  const messages = ref<ChatMessage[]>([]);
  let activeRoomId = '';
  const error = ref('');
  const notice = ref('');
  const endedReason = ref('');
  const endedCode = ref('');
  const micOn = ref(true);
  const camOn = ref(true);
  const micState = ref<DeviceState>('unknown');
  const camState = ref<DeviceState>('unknown');
  const hasRemote = ref(false);
  const hasRemoteVideo = ref(false);
  const connectionState = ref('new');
  const connectedAt = ref(0);
  const peerReconnecting = ref(false);
  const busy = ref(false);

  let localStream: MediaStream | null = null;
  let remoteStream: MediaStream | null = null;
  let pc: RTCPeerConnection | null = null;
  let opening: Promise<MediaStream> | null = null;
  const pendingIce: RTCIceCandidateInit[] = [];
  let queue: Promise<void> = Promise.resolve();
  let offerAttempts = 0;
  let activeBoot = false;
  let facing: 'user' | 'environment' = 'user';
  let archiveUserId = '';

  const socket: Socket = io({
    path: `${import.meta.env.BASE_URL.replace(/\/$/, '')}/socket.io`,
    withCredentials: true,
    autoConnect: false,
  });

  watch(video.local, (element) => {
    if (element && localStream) element.srcObject = localStream;
  });
  watch(video.remote, (element) => {
    if (element && remoteStream) {
      element.srcObject = remoteStream;
      void element.play().catch(() => undefined);
    }
  });

  function lock<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function emitAck<T>(event: string, payload?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      socket.timeout(8000).emit(event, payload ?? {}, (err: Error | null, response: T) => {
        if (err) reject(new Error('服务器没有响应'));
        else resolve(response);
      });
    });
  }

  function note(text: string): void {
    if (!text) return;
    messages.value = [
      ...messages.value,
      {
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        senderId: 'system',
        senderName: '',
        type: 'system',
        content: text,
        createdAt: Date.now(),
      },
    ];
  }

  function persistArchive(): void {
    if (!archiveUserId) return;
    saveArchive(archiveUserId, conversationId, messages.value);
  }

  function showHistory(server: ChatMessage[], extras: ChatMessage[] = []): void {
    const local = loadArchive(archiveUserId, conversationId);
    const merged = mergeArchives(server, local);
    const notes = extras.filter((item) => item.type === 'system' && !merged.some((message) => message.id === item.id));
    messages.value = [...merged, ...notes];
    persistArchive();
  }

  function rememberMessage(message: ChatMessage): void {
    const index = messages.value.findIndex((item) => item.id === message.id);
    if (index >= 0) {
      const next = messages.value.slice();
      next[index] = { ...next[index], ...message };
      messages.value = next;
    } else {
      messages.value = [...messages.value, message];
    }
    if (message.type !== 'system') persistArchive();
  }

  function inCall(): boolean {
    return phase.value === 'active' || phase.value === 'outgoing' || phase.value === 'incoming';
  }

  async function takeTrack(stream: MediaStream, constraints: MediaStreamConstraints): Promise<DeviceState> {
    try {
      const got = await navigator.mediaDevices.getUserMedia(constraints);
      got.getTracks().forEach((track) => stream.addTrack(track));
      return 'ready';
    } catch (err) {
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) return 'denied';
      if (err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError')) return 'missing';
      return 'unavailable';
    }
  }

  async function openMedia(): Promise<MediaStream> {
    const stream = new MediaStream();
    if (!navigator.mediaDevices?.getUserMedia) {
      micState.value = 'missing';
      camState.value = 'missing';
    } else {
      micState.value = await takeTrack(stream, { audio: true });
      camState.value = await takeTrack(stream, { video: { facingMode: facing } });
    }
    micOn.value = micState.value === 'ready';
    camOn.value = camState.value === 'ready';
    stream.getAudioTracks().forEach((track) => {
      track.enabled = micOn.value;
    });
    stream.getVideoTracks().forEach((track) => {
      track.enabled = camOn.value;
    });
    if (phase.value !== 'outgoing' && phase.value !== 'incoming' && phase.value !== 'active') {
      stream.getTracks().forEach((track) => track.stop());
      return stream;
    }
    localStream = stream;
    if (video.local.value) video.local.value.srcObject = stream;
    return stream;
  }

  function ensureMedia(): Promise<MediaStream> {
    if (localStream) return Promise.resolve(localStream);
    if (!opening) {
      opening = openMedia().finally(() => {
        opening = null;
      });
    }
    return opening;
  }

  function stopMedia(): void {
    localStream?.getTracks().forEach((track) => track.stop());
    localStream = null;
    micState.value = 'unknown';
    camState.value = 'unknown';
    if (video.local.value) video.local.value.srcObject = null;
  }

  function resetPc(): void {
    const previous = pc;
    pc = null;
    previous?.close();
    pendingIce.length = 0;
    remoteStream = null;
    hasRemote.value = false;
    hasRemoteVideo.value = false;
    if (video.remote.value) video.remote.value.srcObject = null;
    connectionState.value = 'new';
  }

  function bindLocal(connection: RTCPeerConnection, stream: MediaStream, offering: boolean): void {
    const audio = stream.getAudioTracks()[0] ?? null;
    const videoTrack = stream.getVideoTracks()[0] ?? null;
    if (offering) {
      if (audio) connection.addTrack(audio, stream);
      else connection.addTransceiver('audio', { direction: 'recvonly' });
      if (videoTrack) connection.addTrack(videoTrack, stream);
      else connection.addTransceiver('video', { direction: 'recvonly' });
      return;
    }
    for (const transceiver of connection.getTransceivers()) {
      const kind = transceiver.receiver.track?.kind;
      if (kind !== 'audio' && kind !== 'video') continue;
      const local = kind === 'audio' ? audio : videoTrack;
      if (local) {
        void transceiver.sender.replaceTrack(local);
        transceiver.direction = 'sendrecv';
      } else {
        transceiver.direction = 'recvonly';
      }
    }
  }

  function wire(connection: RTCPeerConnection): void {
    connection.ontrack = (event) => {
      if (!remoteStream) remoteStream = new MediaStream();
      if (!remoteStream.getTracks().some((track) => track.id === event.track.id)) remoteStream.addTrack(event.track);
      if (event.track.kind === 'video') {
        const paint = () => {
          hasRemoteVideo.value = event.track.readyState === 'live' && !event.track.muted;
        };
        paint();
        event.track.onunmute = paint;
        event.track.onmute = paint;
      }
      hasRemote.value = remoteStream.getTracks().length > 0;
      if (video.remote.value) {
        video.remote.value.srcObject = remoteStream;
        void video.remote.value.play().catch(() => undefined);
      }
    };
    connection.onicecandidate = (event) => {
      if (event.candidate) socket.emit('webrtc:ice', { candidate: event.candidate.toJSON() });
    };
    connection.onconnectionstatechange = () => {
      if (pc !== connection) return;
      connectionState.value = connection.connectionState;
      if (connection.connectionState === 'connected') {
        offerAttempts = 0;
        if (!connectedAt.value) connectedAt.value = Date.now();
      }
      if (connection.connectionState === 'failed' && role.value === 'guest' && offerAttempts < 2) {
        offerAttempts += 1;
        void lock(() => createOffer());
      }
    };
  }

  async function flushIce(connection: RTCPeerConnection): Promise<void> {
    const queued = pendingIce.splice(0);
    for (const candidate of queued) {
      await connection.addIceCandidate(candidate).catch(() => undefined);
    }
  }

  async function createOffer(): Promise<void> {
    resetPc();
    if (!activeRoomId) throw new Error('通话还没开始');
    const turn = await fetchTurn(activeRoomId);
    const connection = new RTCPeerConnection({ iceServers: turn.iceServers });
    pc = connection;
    wire(connection);
    const stream = await ensureMedia();
    bindLocal(connection, stream, true);
    const offer = await connection.createOffer({ iceRestart: true });
    await connection.setLocalDescription(offer);
    socket.emit('webrtc:offer', { sdp: connection.localDescription });
  }

  async function applyOffer(sdp: RTCSessionDescriptionInit): Promise<void> {
    const stream = await ensureMedia();
    resetPc();
    if (!activeRoomId) throw new Error('通话还没开始');
    const turn = await fetchTurn(activeRoomId);
    const connection = new RTCPeerConnection({ iceServers: turn.iceServers });
    pc = connection;
    wire(connection);
    await connection.setRemoteDescription(sdp);
    bindLocal(connection, stream, false);
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    socket.emit('webrtc:answer', { sdp: connection.localDescription });
    await flushIce(connection);
  }

  function beginActive(): void {
    status.value = 'active';
    phase.value = 'active';
    if (activeBoot) return;
    activeBoot = true;
    void lock(async () => {
      try {
        await ensureMedia();
        if (phase.value !== 'active') return;
        if (role.value === 'guest') await createOffer();
      } catch (err) {
        error.value = err instanceof Error ? err.message : '通话连接失败';
      }
    });
  }

  function leaveCall(text: string, forceNote = false): void {
    const was = inCall();
    activeBoot = false;
    connectedAt.value = 0;
    resetPc();
    stopMedia();
    status.value = 'waiting';
    if (phase.value !== 'ended') phase.value = 'chat';
    if ((was || forceNote) && text) note(text);
  }

  function finish(reason?: string): void {
    activeBoot = false;
    connectedAt.value = 0;
    resetPc();
    stopMedia();
    endedCode.value = reason || '';
    endedReason.value = reasonText(reason);
    phase.value = 'ended';
  }

  function applyJoin(data: JoinState): void {
    role.value = data.role;
    status.value = data.status;
    selfName.value = data.selfName;
    peerName.value = data.peerName || '';
    peerOnline.value = data.peerOnline;
    expiresAt.value = data.expiresAt;
    error.value = '';
    if (data.status === 'ringing') {
      phase.value = data.callFrom === data.role ? 'outgoing' : 'incoming';
      if (data.callFrom === data.role) void ensureMedia();
      return;
    }
    if (data.status === 'active') {
      beginActive();
      return;
    }
    phase.value = 'chat';
  }

  async function joinConversation(): Promise<void> {
    try {
      const result = await emitAck<Ack>('conversation:join', { conversationId });
      if (!result.ok) {
        endedReason.value = result.message || '无法进入聊天';
        phase.value = 'ended';
        return;
      }
      try {
        const fresh = await listMessages(conversationId);
        const extras = messages.value.filter((item) => item.type === 'system');
        showHistory(fresh.messages, extras);
      } catch {
        /* 已有的历史先留在页面上 */
      }
    } catch (err) {
      endedReason.value = err instanceof Error ? err.message : '无法进入聊天';
      phase.value = 'ended';
    }
  }

  socket.on('conversation:state', (data: ConversationState) => {
    selfId.value = data.selfId;
    selfName.value = data.selfName || selfName.value;
    if (data.peerName) peerName.value = data.peerName;
    peerJoined.value = data.peerJoined;
    peerOnline.value = data.peerOnline;
    invitePath.value = data.invitePath;
    if (data.roomId) activeRoomId = data.roomId;
    if (data.role === 'owner' || data.role === 'guest') role.value = data.role;
    if (data.status === 'ringing' || data.status === 'active') {
      applyJoin({
        role: data.role || role.value || 'guest',
        status: data.status,
        reconnected: Boolean(data.reconnected),
        selfName: data.selfName,
        peerName: data.peerName || peerName.value,
        peerOnline: data.peerOnline,
        expiresAt: data.expiresAt || 0,
        callFrom: data.callFrom,
      });
      return;
    }
    if (phase.value === 'boot') phase.value = 'chat';
  });
  socket.on('room:joined', (data: JoinState & { roomId?: string }) => {
    if (data.roomId) {
      activeRoomId = data.roomId;
      if (data.role === 'owner') invitePath.value = `/join/${data.roomId}`;
    }
    applyJoin(data);
  });
  socket.on('call:incoming', (payload: { callerName?: string; roomId?: string }) => {
    if (payload?.roomId) activeRoomId = payload.roomId;
    if (payload?.callerName) peerName.value = payload.callerName;
    peerOnline.value = true;
    peerJoined.value = true;
    peerReconnecting.value = false;
    status.value = 'ringing';
    phase.value = 'incoming';
  });
  socket.on('call:outgoing', (payload?: { roomId?: string }) => {
    if (payload?.roomId) activeRoomId = payload.roomId;
    if (phase.value === 'incoming') return;
    status.value = 'ringing';
    phase.value = 'outgoing';
    void ensureMedia();
  });
  socket.on('call:accept', () => beginActive());
  socket.on('call:reject', (payload: { by?: string }) => {
    const by = payload?.by;
    let text = '通话已取消';
    if (by === 'timeout') text = phase.value === 'outgoing' ? '对方无应答' : '未接听';
    else if (by === role.value && phase.value === 'outgoing') text = '已取消';
    else if (by === role.value) text = '已拒绝';
    else if (phase.value === 'incoming') text = '对方已取消';
    else text = '对方已拒绝';
    leaveCall(text);
  });
  socket.on('call:end', (payload: { reason?: string }) => {
    const reason = payload?.reason;
    if (reason === 'replaced') {
      finish('replaced');
      return;
    }
    if (reason === 'peer-left') {
      peerOnline.value = false;
      peerReconnecting.value = false;
      leaveCall('对方已离开', true);
      return;
    }
    leaveCall(reason === 'call-ended' ? '通话结束' : '通话结束');
  });
  socket.on('room:ended', () => {
    activeRoomId = '';
    peerReconnecting.value = false;
    if (inCall()) leaveCall('通话已结束');
  });
  socket.on('conversation:gone', () => {
    finish('closed');
  });
  socket.on('peer:reconnecting', () => {
    peerReconnecting.value = true;
    notice.value = '对方网络不稳定，正在等待重连';
  });
  socket.on('peer:online', (payload: { name?: string }) => {
    peerReconnecting.value = false;
    peerOnline.value = true;
    peerJoined.value = true;
    if (payload?.name && !peerName.value) peerName.value = payload.name;
    if (role.value === 'guest' && status.value === 'active') void lock(() => createOffer());
  });
  socket.on('peer:offline', () => {
    peerOnline.value = false;
  });
  socket.on('webrtc:offer', (payload: { sdp?: RTCSessionDescriptionInit }) => {
    if (payload?.sdp) {
      void lock(async () => {
        try {
          await applyOffer(payload.sdp as RTCSessionDescriptionInit);
        } catch (err) {
          error.value = err instanceof Error ? err.message : '通话连接失败';
        }
      });
    }
  });
  socket.on('webrtc:answer', (payload: { sdp?: RTCSessionDescriptionInit }) => {
    if (!payload?.sdp) return;
    void lock(async () => {
      if (!pc) return;
      await pc.setRemoteDescription(payload.sdp as RTCSessionDescriptionInit);
      await flushIce(pc);
    });
  });
  socket.on('webrtc:ice', (payload: { candidate?: RTCIceCandidateInit }) => {
    if (!payload?.candidate) return;
    if (!pc || !pc.remoteDescription) pendingIce.push(payload.candidate);
    else void pc.addIceCandidate(payload.candidate).catch(() => undefined);
  });
  socket.on('chat:new', (message: ChatMessage) => {
    if (message.conversationId && message.conversationId !== conversationId) return;
    rememberMessage(message);
  });
  socket.on('chat:read', (payload: { conversationId?: string; readAt?: number }) => {
    if (payload?.conversationId && payload.conversationId !== conversationId) return;
    const readAt = payload?.readAt || 0;
    messages.value = messages.value.map((item) => (item.senderId === selfId.value && item.createdAt <= readAt ? { ...item, read: true } : item));
    persistArchive();
  });
  socket.on('chat:trim', (payload: { ids?: string[] }) => {
    const ids = new Set(payload?.ids || []);
    if (ids.size === 0) return;
    const next = messages.value.filter((item) => !ids.has(item.id));
    if (next.length === messages.value.length) return;
    messages.value = next;
    persistArchive();
  });
  socket.on('connect', () => {
    void joinConversation();
  });
  socket.on('disconnect', () => {
    activeBoot = false;
    resetPc();
  });
  socket.on('connect_error', () => {
    error.value = '连接服务器失败';
  });

  async function inviteCall(): Promise<void> {
    if (busy.value || inCall()) return;
    busy.value = true;
    try {
      const result = await emitAck<Ack>('call:invite');
      if (!result.ok) throw new Error(result.message || '无法发起通话');
      if (phase.value !== 'incoming') {
        phase.value = 'outgoing';
        status.value = 'ringing';
        void ensureMedia();
      }
    } catch (err) {
      if (phase.value !== 'incoming') error.value = err instanceof Error ? err.message : '无法发起通话';
    } finally {
      busy.value = false;
    }
  }

  async function accept(): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    void video.remote.value?.play().catch(() => undefined);
    try {
      const result = await emitAck<Ack>('call:accept');
      if (!result.ok) throw new Error(result.message || '接听失败');
      beginActive();
    } catch (err) {
      error.value = err instanceof Error ? err.message : '接听失败';
    } finally {
      busy.value = false;
    }
  }

  async function reject(): Promise<void> {
    await emitAck<Ack>('call:reject').catch(() => undefined);
  }

  async function hangup(): Promise<void> {
    const was = phase.value;
    await emitAck<Ack>('call:end').catch(() => undefined);
    if (phase.value === was) leaveCall(was === 'outgoing' ? '已取消' : was === 'active' ? '通话结束' : '');
  }

  async function closeRoom(): Promise<boolean> {
    try {
      const result = await emitAck<Ack>('room:close');
      if (!result.ok) {
        error.value = result.message || '结束失败';
        return false;
      }
      finish('closed');
      return true;
    } catch (err) {
      error.value = err instanceof Error ? err.message : '结束失败';
      return false;
    }
  }

  function toggleMic(): void {
    if (micState.value !== 'ready') return;
    micOn.value = !micOn.value;
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = micOn.value;
    });
  }

  function toggleCam(): void {
    if (camState.value !== 'ready') return;
    camOn.value = !camOn.value;
    localStream?.getVideoTracks().forEach((track) => {
      track.enabled = camOn.value;
    });
  }

  async function flipCam(): Promise<void> {
    if (camState.value !== 'ready' || !localStream || !navigator.mediaDevices?.getUserMedia) return;
    const nextFacing = facing === 'user' ? 'environment' : 'user';
    try {
      const got = await navigator.mediaDevices.getUserMedia({ video: { facingMode: nextFacing } });
      const track = got.getVideoTracks()[0];
      if (!track) return;
      const previous = localStream.getVideoTracks()[0];
      if (previous) {
        localStream.removeTrack(previous);
        previous.stop();
      }
      track.enabled = camOn.value;
      localStream.addTrack(track);
      const sender = pc?.getSenders().find((item) => item.track?.kind === 'video');
      if (sender) await sender.replaceTrack(track);
      facing = nextFacing;
      if (video.local.value) video.local.value.srcObject = localStream;
    } catch {
      error.value = '无法切换摄像头';
    }
  }

  async function sendChat(content: string): Promise<boolean> {
    const text = content.trim();
    if (!text) return false;
    try {
      const result = await emitAck<Ack>('chat:send', { content: text });
      if (!result.ok) {
        error.value = result.message || '发送失败';
        return false;
      }
      return true;
    } catch (err) {
      error.value = err instanceof Error ? err.message : '发送失败';
      return false;
    }
  }

  async function sendVoice(content: string, durationMs: number, mime: string): Promise<boolean> {
    if (content.length > 400_000) {
      error.value = '语音太长';
      return false;
    }
    try {
      const result = await emitAck<Ack>('chat:send', {
        type: 'voice',
        content,
        durationMs,
        mime,
      });
      if (!result.ok) {
        error.value = result.message || '发送失败';
        return false;
      }
      return true;
    } catch (err) {
      error.value = err instanceof Error ? err.message : '发送失败';
      return false;
    }
  }

  onScopeDispose(() => {
    socket.disconnect();
    resetPc();
    stopMedia();
  });

  void (async () => {
    try {
      const user = await ensureUser();
      archiveUserId = user.id;
      try {
        const serverMessages = (await listMessages(conversationId)).messages;
        showHistory(serverMessages);
      } catch {
        messages.value = loadArchive(archiveUserId, conversationId);
      }
    } catch {
      /* 历史记录会在进入会话后补上 */
    }
    socket.connect();
  })();

  return {
    phase,
    role,
    selfId,
    selfName,
    peerName,
    peerOnline,
    peerJoined,
    invitePath,
    expiresAt,
    messages,
    error,
    notice,
    endedReason,
    endedCode,
    micOn,
    camOn,
    micState,
    camState,
    hasRemote,
    hasRemoteVideo,
    connectionState,
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
  };
}

interface ConversationState extends JoinState {
  selfId: string;
  peerJoined: boolean;
  invitePath: string | null;
  roomId?: string;
}

function reasonText(reason?: string): string {
  if (reason === 'rejected') return '对方拒绝了通话';
  if (reason === 'expired') return '房间已过期';
  if (reason === 'replaced') return '这个聊天已在其他页面打开';
  if (reason === 'peer-left') return '对方已断开';
  if (reason === 'closed') return '聊天已结束';
  return '聊天已结束';
}
